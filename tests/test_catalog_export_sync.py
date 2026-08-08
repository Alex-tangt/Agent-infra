import importlib.util
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_export_module():
    script_path = REPO_ROOT / "scripts" / "export_catalog.py"
    spec = importlib.util.spec_from_file_location("export_catalog", script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_committed_catalog():
    with (REPO_ROOT / "contracts" / "component-catalog.json").open(encoding="utf-8") as f:
        return json.load(f)


def test_committed_catalog_matches_registry_export():
    """组件契约漂移即失败：注册表改了而 contracts/component-catalog.json 未重新导出时爆红。"""
    export = _load_export_module()
    generated = export.build_catalog()
    assert generated == _load_committed_catalog()


def test_export_contains_all_five_components():
    export = _load_export_module()
    catalog = export.build_catalog()

    ids = sorted(entry["id"] for entry in catalog["components"])
    assert ids == [
        "agent-single",
        "context-window",
        "model-ollama",
        "model-openai",
        "tool-caller",
    ]
    assert all(entry["version"] == "1.0" for entry in catalog["components"])
    assert all(entry["description"] for entry in catalog["components"])
    assert all(entry["role"] for entry in catalog["components"])
    assert all(entry["class_name"] for entry in catalog["components"])

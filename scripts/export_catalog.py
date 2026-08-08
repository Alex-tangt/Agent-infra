#!/usr/bin/env python3
"""导出组件注册表（registry 单一权威源）为只读契约 contracts/component-catalog.json。

背景（ADR-0005）：TS 侧组装器 catalog.ts 原先是手抄的组件契约副本，与 Python 侧
components/registry.py 可能漂移。本脚本是唯一允许写 contracts/component-catalog.json 的入口：
任何组件契约改动（components/ 下的 ComponentSpec）都必须重新运行本脚本重新生成导出物。

用法：
    python scripts/export_catalog.py
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from components import as_dict, reset
from components.agent import register_agent
from components.context import register_context
from components.model import register_model, register_ollama_model
from components.tools.registration import register_tool_caller

CONTRACTS_DIR = REPO_ROOT / "contracts"
CATALOG_PATH = CONTRACTS_DIR / "component-catalog.json"

# 全部 5 个组件注册入口；顺序无关，输出按 (id, version) 排序保证确定性
_REGISTER_FNS = (
    register_context,
    register_model,
    register_ollama_model,
    register_tool_caller,
    register_agent,
)


def _register_all() -> None:
    reset()
    for register_fn in _REGISTER_FNS:
        register_fn()


def _port_to_dict(port) -> dict:
    return {"name": port.name, "type": port.type}


def _spec_to_dict(spec) -> dict:
    return {
        "id": spec.id,
        "version": spec.version,
        "description": spec.description,
        "role": spec.role,
        "class_name": spec.class_name,
        "inputs": [_port_to_dict(port) for port in spec.inputs],
        "outputs": [_port_to_dict(port) for port in spec.outputs],
        "params": {
            name: {
                "type": param.type,
                "default": param.default,
                "enum": param.enum,
                "min": param.min,
                "max": param.max,
            }
            for name, param in spec.params.items()
        },
    }


def build_catalog() -> dict:
    """从注册表构建与 assembler/src/catalog.ts 的 ComponentCatalog 结构一致的字典。"""
    _register_all()
    ordered = sorted(as_dict().items(), key=lambda kv: kv[0])
    return {"components": [_spec_to_dict(spec) for _, spec in ordered]}


def main() -> None:
    catalog = build_catalog()
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_PATH.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"已导出组件注册表到 {CATALOG_PATH}")


if __name__ == "__main__":
    main()

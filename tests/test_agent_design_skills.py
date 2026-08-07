from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_ROOT = REPO_ROOT / "skills"


def _skill_files() -> list[Path]:
    return sorted(SKILLS_ROOT.glob("*/SKILL.md"))


def _frontmatter(skill_md: Path) -> tuple[dict, str]:
    text = skill_md.read_text(encoding="utf-8")
    if not text.startswith("---"):
        pytest.fail(f"{skill_md} must start with a --- frontmatter block")
    parts = text.split("---", 2)
    if len(parts) < 3:
        pytest.fail(f"{skill_md} has no closing --- for its frontmatter")
    fields = {}
    for line in parts[1].strip().splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            fields[key.strip()] = value.strip()
    return fields, parts[2].strip()


def test_starter_skill_exists():
    assert (SKILLS_ROOT / "agent-design" / "SKILL.md").exists()


@pytest.mark.parametrize("skill_md", _skill_files(), ids=lambda p: p.parent.name)
def test_each_skill_has_frontmatter_and_body(skill_md):
    fields, body = _frontmatter(skill_md)

    assert fields.get("name"), f"{skill_md} frontmatter missing name"
    assert fields.get("description"), f"{skill_md} frontmatter missing description"
    assert body, f"{skill_md} body must not be empty"


@pytest.mark.parametrize("skill_md", _skill_files(), ids=lambda p: p.parent.name)
def test_frontmatter_name_matches_directory(skill_md):
    fields, _ = _frontmatter(skill_md)
    assert fields["name"] == skill_md.parent.name


def test_agent_design_skill_internalizes_single_agent_pattern():
    skill_md = SKILLS_ROOT / "agent-design" / "SKILL.md"
    fields, body = _frontmatter(skill_md)

    assert "单 agent" in fields["description"]
    for term in ("模型", "上下文", "工具"):
        assert term in body
    assert "connections" in body

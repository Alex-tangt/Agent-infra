# Agent Infra

从《深入理解AI Agent》提炼通用 agent 组件，构建可插拔、可组合的组件库，并用组装器按需求快速组装 agent demo，供运行界面直接体验。本库只负责产出 demo 项目，不承载真实业务。

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues in `Alex-tangt/Agent-infra`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, using default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

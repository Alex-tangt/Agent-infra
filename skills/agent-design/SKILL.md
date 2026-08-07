---
name: agent-design
description: 组装器设计知识：单 agent 标配组合模式（agent = 模型管理 + 上下文管理 + 工具调用）。当需求是一个单 agent 对话/任务代理，需要模型思考、上下文保持、工具行动时，用本 skill 决定选哪些组件、怎么连线（组合边）、参数怎么定。
---

# 单 agent 标配组合

agent = 模型管理 + 上下文管理 + 工具调用。这是组装器对几乎所有需求的第一默认形态：一个薄容器（agent-single）把三个组件外插进来，只负责跑循环、停止、返回。本库第一版目标形态就是它（见 CONTEXT.md 的「单体 agent demo」）。

## 何时用

凡是"给一个需求，要求单个代理自主完成对话或任务、且需要调用外部工具"的场景，一律先按本模式组装，除非需求明确出现以下信号才升级：

- 需要长期/跨会话记忆 → 加记忆组件（后续 skill）。
- 需要从外部文档/知识库取上下文 → 加检索/RAG 组件。
- 需要多个角色或子任务协作 → 升级为多 agent 编排。
- 只有一个组件变更（例如纯问答不需要工具）→ 仍保留三件套骨架，工具列表给空即可，不要删结构——agent 是薄容器，组件外插，删掉任何一个都会被接线引擎判为缺件。

反例：需求已经是多 agent / RAG / 记忆，不要硬套本模式。

## 组件怎么选

三件套 + 一个薄容器，全部来自组件目录（catalog），版本随库走：

| 组件 id | 版本 | 角色 | 选型要点 |
| --- | --- | --- | --- |
| `model-openai` | 1.0 | 模型管理 | 必须支持 tool calling（这是 agentic 工作流的硬前提）；默认 `gpt-4o-mini`，成本敏感用 `gpt-4o-mini`，质量优先可换 `gpt-4o` |
| `context-window` | 1.0 | 上下文管理 | 多轮对话的窗口管理，默认截断策略；需求是多轮就保持默认，一次性问答可调小 `max_rounds` |
| `tool-caller` | 1.0 | 工具调用 | 工具的挂载点；从需求里抽取外部能力（算数、查询、检索等）登记为 `tools` 列表，无工具则给空列表 |
| `agent-single` | 1.0 | 组装容器 | 薄循环容器，唯一负责编排与停止条件；本模式的核心，不能省略 |

选择铁律：三件套缺一不可。接线引擎在生成时校验 agent 必须同时接入 model、context、tools 三个组件，缺件直接报错（见 wiring/engine.py 的 `_agent_parts`）。

## 怎么连线（组合边）

组合边 = 配方里的 `connections`。本模式只有一种边：**组件 → agent-single**。方向固定为"组件流入容器"，接线引擎据此把三件套注入 `Agent(model=..., context=..., tools=...)` 的构造函数。

三条件，缺一不可：

1. `model-openai -> agent-single`
2. `context-window -> agent-single`
3. `tool-caller -> agent-single`

注意：边是"组件指向 agent"，不要反着连；agent 是薄容器不主动连接任何组件。串联链上 agent-single 是链头，消费 `user_message`（string）并产出 `reply`（string），其余组件不进串联链、只作为 agent 的组件被注入。

## 参数默认建议

| 组件 | 参数 | 默认 | 建议 |
| --- | --- | --- | --- |
| `model-openai` | `model` | `gpt-4o-mini` | 质量优先改 `gpt-4o` |
| | `temperature` | 0.7 | 需要确定性输出（评测/消融）降到 0 |
| | `max_tokens` | 1024 | 回答偏长再上调 |
| `context-window` | `max_rounds` | 5 | 一次性问答可设 1；长对话保持默认 |
| | `strategy` | `truncate` | 目前只有截断，先不动 |
| `tool-caller` | `tools` | `[]` | 从需求抽工具，描述写清楚才能被模型正确触发 |
| | `strategy` | `strict` | 严格校验，出错即暴露问题，利于调试 |
| `agent-single` | `max_iterations` | 5 | 工具链路长再加；避免死循环 |

参数默认值全部在 catalog（assembler/src/catalog.ts）与组件契约里有据可查，本表只是给组装器做快择的快捷建议。

## 完整配方示例

以"计算器 agent"为例（结构与 tests/test_e2e.py 的 `CALCULATOR_RECIPE` 一致）：

```json
{
  "name": "calculator-agent",
  "components": [
    { "id": "context-window", "version": "1.0" },
    { "id": "model-openai", "version": "1.0" },
    { "id": "tool-caller", "version": "1.0" },
    { "id": "agent-single", "version": "1.0" }
  ],
  "connections": [
    { "from": "context-window", "to": "agent-single" },
    { "from": "model-openai", "to": "agent-single" },
    { "from": "tool-caller", "to": "agent-single" }
  ],
  "parameters": {
    "model-openai": { "model": "gpt-4o-mini", "temperature": 0.0 },
    "tool-caller": { "tools": [{ "name": "add", "description": "sum of two numbers", "func": "lambda a, b: a + b" }] },
    "agent-single": { "max_iterations": 3 }
  }
}
```

配方产出即交棒：接线引擎按它生成第一个可运行的胶水代码 demo，此后配方即弃，调试阶段直接改生成的 demo 代码。

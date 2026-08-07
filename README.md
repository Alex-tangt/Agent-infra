# Agent Infra

从《深入理解AI Agent》提炼通用 agent 组件，构建**可插拔、可组合**的组件库，并用**组装器**（内化书本设计知识的 coding agent）按需求快速组装 agent demo，供**运行界面**直接体验。本库只负责产出 demo 项目，不承载真实业务——真实业务在导出后的独立项目里继续迭代。

## 三件套

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| **组件库** | `components/` | 可复用、可插拔的 agent 构建块：模型管理、上下文管理、工具调用、Agent 薄容器。每个组件声明接口契约（输入/输出/参数），prompt/超参数作为参数暴露 |
| **组装器** | `assembler/` (TS) | 接收人的需求，输出结构化配方（JSON）——需求→配方转换、澄清机制、设计知识 skill、pi 对话编排 |
| **运行界面** | `web/` + `server/` | 聊天面板 + 调试/监测面板 + 评估入口 + 组装器面板，调 Python demo server 真实运行 |

## 架构

```
需求 ──> 组装器(TS) ──配方 JSON──> 接线引擎(Python) ──胶水代码──> 可运行 demo
                                        │
                                        └──> 运行界面(web) 聊天 + 遥测 + 消融
```

- **配方 = 一次性启动器**：组装器产配方 → 接线引擎按模板生成第一个可运行的 demo 起点 → 配方即弃，demo 成为普通代码直接改（ADR-0001）
- **组件薄接口 + 参数化**：接口契约是接线引擎判断"能不能接、怎么接"的唯一依据；参数合法性在生成时校验
- **Agent = 薄循环容器**：llm/上下文/工具作为组件外插，只负责循环、停止、返回（ADR-0002）
- **评估工程**：自建最小骨架（消融 runner + 薄遥测层），监测/跑分复用商品化后端（ADR-0004）

## 快速开始

### 前置

- Python 3.12+
- Node.js 24+（组装器/运行界面）
- 可选：`OPENAI_API_KEY`（无 key 时运行界面用离线兜底模型跑通全链路）

### 启动运行界面

```bash
# 1. 启动 Python demo API server
python -m server.app --port 9000

# 2. 启动 web 运行界面（另一终端）
cd web
npm install
npm start        # 打开 http://localhost:8000
```

运行界面四面板：

- **组装器**：输入需求 → 生成配方（浏览器内走 mock，真实链路见下）；或手动粘贴配方 JSON
- **聊天**：与运行中的 demo 对话
- **调试/监测**：按组件粒度查看耗时、调用次数、token 消耗
- **评估**：选消融变量（换/删/覆盖参数）→ 触发 → 变体并排对比

### 生成并运行一个 demo（纯命令行）

```bash
python -c "
from components import reset, as_dict
from components.agent import register_agent
from components.context import register_context
from components.model import register_model
from components.tools import register_tool_caller
from wiring import generate

register_context(); register_model(); register_tool_caller(); register_agent()
recipe = {
  'name': 'calculator-agent',
  'components': [
    {'id': 'context-window', 'version': '1.0'},
    {'id': 'model-openai', 'version': '1.0'},
    {'id': 'tool-caller', 'version': '1.0'},
    {'id': 'agent-single', 'version': '1.0'},
  ],
  'connections': [
    {'from': 'context-window', 'to': 'agent-single'},
    {'from': 'model-openai', 'to': 'agent-single'},
    {'from': 'tool-caller', 'to': 'agent-single'},
  ],
  'parameters': {},
}
code = generate(recipe, registry=as_dict())
print(code)   # 输出的就是可运行的胶水代码 demo
"
```

完整示例见 `tests/test_e2e.py` 的 `CALCULATOR_RECIPE`。

### 组装器真实链路（Node 环境）

浏览器受 `node:fs` 限制无法加载组装器源码（读 recipe-schema.json），所以：

- **Node 环境**：直接 `import` 组装器纯函数（`assembler/src/requirementToRecipe.ts`），测试已覆盖真实链路
- **浏览器**：走 mock 组装器，或手动粘贴配方 JSON

组装器服务化（让浏览器走真实"需求→配方"）列为增强工单 #26。

## 组件

| 组件 | id@version | 职责 |
| --- | --- | --- |
| 模型管理 | `model-openai@1.0` | LLM 封装，调用模型并上报 token 用量 |
| 上下文管理 | `context-window@1.0` | 多轮对话窗口与截断策略 |
| 工具调用 | `tool-caller@1.0` | 外部能力挂载点，strict/lenient 策略 |
| Agent 容器 | `agent-single@1.0` | 薄循环容器，零件外插 |

组件通过 `components/` 的注册表声明契约（输入/输出/参数），接线引擎按契约校验并生成胶水代码。

## 测试

```bash
python -m pytest            # 组件库 / 接线引擎 / 遥测 / 消融 / server（142 个）
cd assembler && npm test    # 组装器（78 个）
cd web && npm test          # 运行界面（56 个）
```

## 设计知识 skill

组装器的"组件组合模式"沉淀在 `skills/agent-design/SKILL.md`（单 agent 标配组合）。新增 skill 的格式标准见 `docs/agent-design-skills.md`——学习《深入理解AI Agent》过程中新的组合模式可持续沉淀为 skill，组装器按需加载。

## 文档

- `CONTEXT.md` — 领域词汇表（组件、配方、接线引擎、胶水代码、组装器、评估工程等）
- `docs/adr/` — 架构决策记录（配方即启动器、Agent 薄容器、混合技术栈、评估复用后端）
- `docs/research/` — 调研报告（框架组件抽象、配方生成模式、评估基础设施、组装器 skill 能力）
- `contracts/` — 语言中立契约（recipe-schema.json、demo-api.openapi.json）

## 增强工单（不影响基本使用）

- **#25 组合边契约化**：agent 组合边从硬编码 id 表改为契约驱动，未来新增 model 组件可接入
- **#26 组装器服务化 + 信号单源化**：让浏览器走真实"需求→配方"链路；消除信号词四处重复

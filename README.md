# Agent Infra

从《深入理解AI Agent》提炼通用 agent 组件，构建**可插拔、可组合**的组件库，并用**组装器**（内化书本设计知识的 coding agent）按需求直接写出 demo 代码，供**运行界面**直接体验。本库只负责产出 demo 项目，不承载真实业务——真实业务在导出后的独立项目里继续迭代。

## 三件套

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| **组件库** | `components/` | 可复用、可插拔的 agent 构建块：模型管理、上下文管理、工具调用、Agent 薄容器。每个组件声明接口契约（输入/输出/参数），prompt/超参数作为参数暴露 |
| **组装器** | `assembler/` (TS) | 接收人的需求，直接产出 demo 代码（代码是唯一真相源）——需求→spec→代码转换、澄清机制、设计知识 skill、pi 对话编排 |
| **运行界面** | `web/` + `server/` | 聊天面板 + 调试/监测面板 + 评估入口 + 组装器面板，调 Python demo server 真实运行 |

## 架构

```
需求 ──> 组装器(TS) ──demo 代码──> 运行时(Python) ──> 可运行 demo
                                        │
                                        └──> 运行界面(web) 聊天 + 遥测 + 消融
```

- **demo 代码 = 唯一真相源**：组装器直接写代码（ADR-0005），生成时在会话内产瞬态 spec 当场校验后即弃；配方、接线引擎、配方 schema 全部废除
- **双层校验，同一权威源**：spec 校验（生成时，TS 侧）+ AST 代码校验（产物时，参数名/枚举/范围比对组件注册表，Python 侧）
- **组件薄接口 + 参数化**：接口契约是校验器判断"能不能接、怎么接"的唯一依据；运行时可注入（`set_param`/`replace_part`/`disable_part`）支撑消融
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

- **组装器**：输入需求 → 组装器直接产出 demo 代码（浏览器内走 mock，真实链路见下）
- **聊天**：与运行中的 demo 对话
- **调试/监测**：按组件粒度查看耗时、调用次数、token 消耗
- **评估**：选消融变量（换/删/覆盖参数）→ 触发 → 变体并排对比

### 生成并运行一个 demo（纯命令行）

```bash
# 已知良好示例（ADR-0005 首个锚点）：demo 代码本身即可独立运行
python -m server.app --port 9000   # 起服务
# POST /demo/{id}/generate 收 { "code": <demos/calculator_agent.py 全文> }
# 或直接跑代码：
python -c "
from demos.calculator_agent import run
print(run('what is 2 + 3?'))   # 需要 OPENAI_API_KEY，或按 runtime 注入 client 离线跑
"
```

完整示例见 `demos/calculator_agent.py`，端到端回归见 `tests/test_e2e.py` 与 `tests/test_server.py`。

### 组装器真实链路（Node 环境）

组装器跑在 Node 侧，生成时产瞬态 spec（仅做结构/参数校验，校验后即弃）：

- **Node 环境**：直接 `import` 组装器纯函数（`assembler/src/requirementToRecipe.ts` 等），测试已覆盖真实链路
- **浏览器**：走 mock 组装器，或粘贴 demo 代码；服务化入口 `POST /assemble`（`assembler/src/server.ts`）返回 `{ code, spec, buildNote }`

## 组件

| 组件 | id@version | 职责 |
| --- | --- | --- |
| 模型管理 | `model-openai@1.0` / `model-ollama@1.0` | LLM 封装，调用模型并上报 token 用量 |
| 上下文管理 | `context-window@1.0` | 多轮对话窗口与截断策略 |
| 工具调用 | `tool-caller@1.0` | 外部能力挂载点，strict/lenient 策略 |
| Agent 容器 | `agent-single@1.0` | 薄循环容器，零件外插 |

组件通过 `components/` 的注册表声明契约（输入/输出/参数），校验器与运行时注入按契约工作。注入协议（ADR-0005 第 7 条）：每个组件实现 `set_param(name, value)`，agent 额外实现 `replace_part(role, instance)` 与 `disable_part(role)`。

## 测试

```bash
python -m pytest            # 组件库 / 代码校验 / 遥测 / 消融 / server
cd assembler && npm test    # 组装器
cd web && npm test          # 运行界面
```

## 设计知识 skill

组装器的"组件组合模式"沉淀在 `skills/agent-design/SKILL.md`（单 agent 标配组合）。新增 skill 的格式标准见 `docs/agent-design-skills.md`——学习《深入理解AI Agent》过程中新的组合模式可持续沉淀为 skill，组装器按需加载。

## 文档

- `CONTEXT.md` — 领域词汇表（组件、接口契约、注册表、组装器、Spec、注入协议、消融实验等）
- `docs/adr/` — 架构决策记录（ADR-0005 组装器直接生成、Agent 薄容器、混合技术栈、评估复用后端）
- `docs/research/` — 调研报告
- `contracts/` — 语言中立契约（demo-api.openapi.json、组件注册表导出的 component-catalog.json）

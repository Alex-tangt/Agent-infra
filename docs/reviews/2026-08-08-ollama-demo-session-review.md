# 会话 Review：真实 ollama demo 端到端跑通（2026-08-08）

> 本文档是对一次跨多轮对话（期间经历多次上下文压缩）的产出与关键决策的回顾性梳理。
> 目的：为接下来基于 issue #27 讨论结论制定重构计划提供事实基线。凡决策均标注决策点与理由，供评审质疑。

## 1. 会话目标

跑通一个**真实 Agent demo**：本地 ollama 真实模型 API 接入 + 上下文管理 + 真实工具调用，在运行界面（web）中完整可体验。

用户同时指出当时界面两大缺陷，成为本轮验收标准之一：
- 看不到有什么组件、各组件没有说明书；
- 前端平板化，缺少可展示给用户的信息。

## 2. 会话旅程（时间线）

| 阶段 | 内容 |
|---|---|
| 0. 交接 | 经 `/ask-matt` 熟悉 AGENTS.md / CONTEXT.md / ADR / issue-tracker 协作流程 |
| 1. grilling | `grill-with-docs` 明确当天方向与范围（大目标、暂缓项、执行方式） |
| 2. 拆工单 | #26 组装器服务化、#28 组件库真实化、#29 运行环境配置 + web 改造；#27 讨论工单（接线引擎去留） |
| 3. subagent 执行 | #28 与 #26 并行 → #29 后发，三个 subagent 分别完成，居中人负责集成与回归 |
| 4. 端到端排障 | 三服务联调：发现并修复注册表遗漏、胶水模板缺失、测试断言过时、配置重建 client 缺陷 |
| 5. 浏览器实测 | browser_use 两轮：首轮发现组装器默认 model-openai 导致聊天 500；修复后复测通过 |
| 6. 提交 | commit `7bd2555`（59 文件 +3657/-352） |

## 3. 关键决策清单

### 3.1 用户确认的决策（grilling 结论）

| # | 决策 | 理由 / 影响 |
|---|---|---|
| D1 | 新增独立 `model-ollama@1.0` 组件 | OpenAI 兼容 client 指向本地 ollama；与 model-openai 平行，支持原生工具调用与 token 上报 |
| D2 | 工具调用真实化 | model 透传 tools schema，agent 解析原生 `tool_calls`，替代原 `default_turn_strategy` 文本 JSON 模拟——**识别为架构缺陷并修复** |
| D3 | context-window 增加 `system_prompt` 参数 | system 消息首条注入、不参与截断 |
| D4 | 组装器服务化 | 浏览器受 node:fs 限制无法直接 import 组装器（读 recipe-schema.json）→ Node HTTP 服务 `POST /assemble` |
| D5 | 前端改单页 + tab 切换（五视图） | 组装器 / 聊天 / 调试监测 / 评估 / 组件库 |
| D6 | 组件契约加 `description` + `role` 字段 | 支撑组件清单 API 与组件库 tab（说明书） |
| D7 | 运行环境配置持久化采用 **B 方案** | server 侧 `config.json` + GET/PUT `/config`，api key 掩码回显、不进前端存储 |
| D8 | 暂缓 #25 引擎驱动部分 | 因 #27 讨论悬而未决，避免白做 |
| D9 | 执行方式：先拆工单 → 派 subagent（工作流/任务/约束写清楚）→ 居中协调 | — |

### 3.2 集成排障中的技术决策（本次会话产出）

| # | 决策 | 问题背景 |
|---|---|---|
| T1 | `_rebuild_registry()` 补 `register_ollama_model` | #28 边界"不碰 server/"导致注册表漏注册 model-ollama，generate 报 400 |
| T2 | wiring `_TEMPLATES` 补 model-ollama 条目 | 同因，报"no glue template registered for 'model-ollama'" |
| T3 | client 注入通用化：遍历配方 `role=model` 组件注入 `_client` | 替代原 hardcode `namespace["model_openai"]`，兼顾 model-openai / model-ollama |
| T4 | `update_config` 后重建 `_model_client` | PUT /config 改 api key/base_url 不生效，需重启——修复为免重启 |
| T5 | 测试注入 tmp_path ConfigStore | 既有测试用默认 `ConfigStore()` 读到真实 server/config.json，被持久化配置污染导致误判 |
| T6 | **组装器模型组件选型可配置**（本轮最重要新增） | 实测发现组装器硬编码 `model-openai`，注入 ollama client 后 model=gpt-4o-mini → 404 → 聊天 500；修复为默认 model-openai，支持 `ASSEMBLER_MODEL_COMPONENT=model-ollama` 或需求点名 ollama/本地模型时选 model-ollama |

### 3.3 会话中澄清的关键认知

- **pi-coding-agent 是 npm 库**（`@earendil-works/pi-coding-agent`）而非 CLI；组装器是其上层 A5 编排（acquire→clarify/convert）+ piDriver/localDriver 双驱动。
- **接线引擎的定位**（#27 核心争议的背景）：配方+接线 vs coding agent 直接生成。本会话 wiring/engine.py 因新增 model-ollama 组件需要补模板条目——这是"接线器模板需随组件接口演进做机械维护"的真实样本，可作为 #27 决策的证据输入。

## 4. 产出清单

### 4.1 工单产出（subagent + 集成）

- **#28 组件库真实化**（Python 165→180）：`components/types.py`（ComponentSpec 加 description/role）、`components/model/__init__.py`（ToolCall/ModelReply、generate(tools=)、_extract_reply 兼容）、`components/model/ollama.py`（新建）、`components/agent/__init__.py`（原生 tool_calls 循环 + build_tool_schemas）、`components/context/__init__.py`（system_prompt）、`wiring/engine.py`（role 表 + 模板）
- **#26 组装器服务化**（assembler 99）：`assembler/src/signals.ts`（领域信号单一来源）、`server.ts` + `startServer.ts`（POST /assemble，CORS，默认 :9001）、`driver.ts`（runAcquire 公共骨架）；web 侧 `assemblerApi.ts` / `assemblerContract.ts` / `createAssemblerApi.ts` + 澄清循环接入
- **#29 配置与 web 改造**（web 83）：`server/config_store.py`（ConfigStore 落盘/掩码/合并）、`server/app.py`（/config、/components 路由）、`contracts/demo-api.openapi.json`、`web/src/panels/componentsPanel.ts`、`web/src/app.ts` + `main.ts`（单页五 tab + config 表单）、`.gitignore`（server/config.json）

### 4.2 修复的缺陷（浏览器实测驱动）

1. 组装器默认 model-openai → 聊天 500（T6，P1）
2. PUT /config 不重建 client → 配置不生效（T4）
3. 注册表 / 胶水模板 / 测试断言三处集成边界遗漏（T1/T2/T5）

### 4.3 验证基线

- 回归：Python **180** / web **83** / assembler **101** 全绿
- API 全链路：组装器(:9001) 需求→配方（model-ollama）→ Python server 生成 → chat 真实 ollama 回复（"3加5等于8。"）→ telemetry 含 agent-single / context-window / model-ollama / tool-caller 四类 span
- 浏览器复测：五 tab 切换正常、组件库说明书 + 默认设置表单 + api key 掩码、聊天真实回复无挂起无 500
- 模型：qwen3:0.6B（用户选定；agent 单轮约 8.6s，比 qwen3:8b 的 65s 快一个量级）

## 5. 评审观察（供重构计划参考）

1. **接线器维护成本的实锤**：为新增一个 model-ollama 组件，需同步维护 wiring 模板、role 表、注册表、测试断言——即 #27 中"模板随组件接口演进同步维护"论据的真实样本。
2. **组装器与运行环境信息割裂**：组装器(:9001) 的组件 catalog 是独立静态表（4→5 组件），与 Python 注册表（5 组件）手工对齐；模型组件选型靠环境变量注入，与 server/config.json 的运行环境配置是两个真相源。若重构，值得考虑"配置单一来源 + 组装器消费"。
3. **配方工具实现空白**：组装器配方 tool-caller 的 tools 为空（需求只产生信号不产生工具实现），浏览器演示时工具调用不触发；工具链路仅在手工注入 tools 的 API 层验证。工具函数库（内置工具集）是待补空白。
4. **qwen3:0.6B 工具调用不稳定**：小模型偶发不触发 tool_calls（浏览器复测中两问均直接作答）；演示工具调用建议用 qwen3:8b 或更大。
5. **测试隔离模式**：ConfigStore 注入 tmp_path 已成为 server 侧测试的既定模式，重构时保留。
6. **未决事项**：#27 结论未同步（工单 OPEN、0 评论）；#25 引擎驱动部分待 #27 结论后重启；push 远程与关闭 #26/#28/#29 未做。

## 6. 与 issue #27 的接口

#27 待决策问题：接线器确定性保证是否仍必要 / skill+校验能否替代模板 / 中间路线（缩小为契约校验器）/ 保留时的覆盖边界 / 是否改 ADR-0001。

本次会话产出对上述问题的**事实输入**：
- wiring 模板 + role 表 + 注册表三处同步修改是"接线器机械维护成本"的直接证据（支持 coding agent 派论据）；
- 但同一配方→同一胶水代码的确定性（多轮生成一致）在排障中体现价值：集成错误可快速归因到注册表/模板/测试，而非 AI 随机性。

建议：重构计划前先把 #27 结论（用户已完成）以评论形式同步进工单，再以本文档第 5 节为基线评审。

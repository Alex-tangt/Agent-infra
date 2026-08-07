# 调研：「结构化配方 → 生成 agent demo」模式的业界实现

> 调研日期：2026-08-07
> 范围：可视化 agent 搭建器、代码生成式 agent 搭建、可序列化 agent 蓝图先例、agent 模板/脚手架生成器。
> 方法：以官方文档、官网、GitHub README/源码等一手来源为准；凡未能抓取到一手来源的论断均标注"未验证"。

## 概述

我方设计链路：**用户需求 → 组装器（coding agent）输出结构化配方（JSON：组件选择、组件间连线、参数）→ 接线引擎按接口契约模板生成可运行 demo 代码 → 配方即弃**。

一句话结论：这条链路的**每一段**在业界都已有成熟实现，但"**配方作为一次性启动器、生成即弃、产物自治代码**"这个**组合**没有直接对标——业界主流（Flowise / Dify / n8n / Langflow / AutoGen Studio / OpenAI Assistants API）把"结构化描述"当作**运行时持久真相源**（存库或 DSL 文件，运行时解释执行、长期演进），而"一次性生成独立代码项目"只存在于脚手架生成器（create-llama、crewai create crew）与 spec→code 生成器（gpt-engineer、MetaGPT）中，且这两类都不强调"配方即弃"。我方的定位介于两者之间，是对两条已验证路径的**刻意组合**，而非纯创新。

---

## 一、可视化 agent 搭建器（配置驱动 + 运行时托管）

这类工具的共性：**画布即配置，配置（JSON/DB/DSL）是运行时真相源**，产物是"平台内的可运行 app"，**不生成独立代码项目**。没有"生成即弃"概念。

### 1. Flowise

- 用什么形式描述"要什么 agent"：可视化画布（Assistant / Chatflow / Agentflow 三种 builder），节点连接构成定义。[官方简介](https://docs.flowiseai.com/)
- 最终产物：平台内保存并托管的 chatflow/agentflow（自托管或云端运行），支持 API/SDK/CLI/嵌入式聊天组件；无"生成代码文件"出口。
- 一次性生成代码项目：无。它是运行界面意义上的完整产品（自带 Tracing/Evaluations/HITL/Teams），即"搭建+运行+评估"一体。
- 取舍：把"搭建/调试/监测/评估"全放进平台，最大化免代码；代价是强平台绑定、配置难脱离 Flowise 运行。

### 2. Langflow

- 形式：可视化编辑器拖拽组件构成"Flow"；组件是带参数配置的节点。[官方文档](https://docs.langflow.org/)
- 产物：Flow 定义（JSON），由 Langflow 服务/API 运行；可"使用你的 Flow 作为更正式应用开发的原型"（官方原话：*You can use your flows as prototypes for more formal application development*）。[Langflow 文档](https://docs.langflow.org/)
- 一次性代码生成：无；只有"导出/导入 flow"级配置复用，不物化成源码项目。
- 取舍：官方明示"flow 是原型，正式开发用代码"——即**搭建器负责快速验证，生产靠手写代码**。这与"可视化搭建器难维护"的业界共识一致。

### 3. Dify

- 形式：Workflow/Chatflow/Agent 的可视化画布 + **DSL 文件**（可导出的结构化 YAML 描述），新 Agent 还支持"通过对话描述需求来搭建"。
- 产物：Dify 平台内托管运行的 app（web app/API/嵌入），通过 API 对外服务；DSL 用于跨实例导入导出与分享（官方明确：DSL 不包含 skills 与 files，跨实例导入会缺东西）。[Dify Build an Agent 文档](https://docs.dify.ai/en/self-host/use-dify/build/new-agent/build.md)
- 一次性代码生成：无。有 CLI（difyctl）支持 export/import/run，但产物仍是平台内 app。[difyctl 文档](https://docs.dify.ai/en/cli/overview.md)
- 取舍：最接近"需求→配方"链路的产品化——其 **Build by Chatting** 模式里，用户用自然语言描述需求，由 agent 自己搭 skills/files/env/prompt，产出 **build_note** 作为搭建记忆，Apply 后持久化为平台配置。即"LLM 组装配置"已被 Dify 产品化，但落点仍是平台配置而非独立代码。

### 4. n8n

- 形式：可视化 workflow 编辑器；workflow 是可分享/导出的结构化定义（JSON）。[n8n 官方文档](https://docs.n8n.io/)
- 产物：由 n8n 运行时执行的 workflow；提供 AI agent 节点、MCP 支持、源码仓库式的 workflow 版本管理（source control）等。
- 一次性代码生成：无；workflow 定义即持久真相源。
- 取舍：配置（workflow JSON）+ 运行时解释；优点是可版本化、可共享、低代码；缺点与同类一致（平台内闭环，不产出独立代码）。

### 5. AutoGen Studio（微软）

- 形式：可视化 UI 定义 agent/skills/workflow；后端 SQLModel 数据库存储实体（SQLite/PostgreSQL）。[AutoGen Studio README](https://github.com/microsoft/autogen/blob/main/python/packages/autogen-studio/README.md)
- 产物：数据库里的 workflow 定义，由 Studio 自身运行。
- 一次性代码生成：无。
- **关键取舍证据**：官方 README 自己声明 *"AutoGen Studio is meant to help you rapidly prototype multi-agent workflows... It is **not meant to be a production-ready app**. Developers are encouraged to use the AutoGen framework to build their own applications"*。这是"可视化搭建器≠生产形态"最直白的一手表态。

### 6. Langfuse（不是搭建器，但与我方评估/监测支柱对应）

- 定位：开源 AI 工程平台，提供观测（traces/sessions/agent graph 可视化）、Prompt 管理、评估（datasets/experiments/LLM-as-judge）。[Langfuse 文档](https://langfuse.com/docs)
- 结论：它不回答"如何搭 agent"，而是回答"搭好之后如何评估与监测"——与我方 CONTEXT 中的**评估工程三层**（用例集+跑分 / 监测数据 / 消融与 A/B）以及**监测系统**直接对应，是这些支柱的成熟先例。

---

## 二、代码生成式 agent 搭建（生成独立源码项目）

这类工具真正满足"**输出独立可运行的 agent 项目代码**"。

### 1. create-llama（LlamaIndex 官方脚手架）

- 形式：交互式 CLI（也可非交互传参），选项如 use case（Agentic RAG 等）、语言栈（Next.js/LlamaIndex.TS 或 Python FastAPI）、模型。[create-llama README](https://github.com/run-llama/create-llama)
- 产物：**生成完整可运行源码项目**（前端聊天 UI + 后端 + 配置），`npm run dev` 即可跑；生成选项里明确有 *"Just generate code (~1 sec)"*。
- 一次性代码生成机制：**有**，且是核心——它自述 *"Inspired by and adapted from create-next-app"*，即"脚手架式一次性生成"的范式。
- 取舍：模板固定（use case 预设），不是从任意需求动态组装；生成后继续演进 = 手改生成代码或重新生成，**不保留"配方"作为重建依据**——这与"配方即弃"的代价相同。

### 2. crewAI `crewai create crew`（crewAI 官方脚手架 + YAML 配置）

- 形式：`crewai create crew <project>` 生成项目骨架；其中 **agents.yaml / tasks.yaml 用声明式描述"要什么 agent/任务"**，crew.py/main.py 是承载逻辑的命令式代码。[crewAI README](https://github.com/crewAIInc/crewAI)
- 产物：**完整源码项目**（pyproject、tools/、config/），用户手改 yaml 与 py 文件继续开发。
- 一次性代码生成机制：**有**（脚手架）；且是"配置 + 代码"混合的样板。
- 取舍：这是业界少见的"YAML 声明 agent + 生成代码骨架 + 产物自治"的组合，与我方"配方→生成代码"形态最接近；区别是我方把配方当一次性输入，crewAI 把 yaml 当长期配置（config 即真相源之一）。另外 crewAI 用 **Skills（getting-started/design-agent/design-task）教 coding agent 按最佳实践搭 agent**，正是"组装器内化设计知识"的直接先例。[crewAI Skills](https://github.com/crewAIInc/skills)

### 3. gpt-engineer

- 形式：`prompt` 文件（自然语言 spec）作为输入。[gpt-engineer README](https://github.com/gpt-engineer-org/gpt-engineer)
- 产物：AI 写并执行出的**代码仓库**（spec→代码，无中间结构化配方；或可用 preprompts 定制 agent 身份）。
- 一次性生成机制：有（生成代码项目），但**无结构化配方**——靠 LLM 直接翻译需求。
- **失败/转向证据**：README 自述 *"If you are looking for the evolution that is an opinionated, managed service – check out gptengineer.app. If you are looking for a well maintained hackable CLI – check out aider"*，并自称 *"The OG code generation experimentation platform"*。即：纯 LLM 从需求生成完整项目的路线，最终让位给"托管服务（gptengineer.app）"与"人控迭代 CLI（aider）"，说明"一次生成到位"不可靠，**需要生成后的持续迭代机制**。

### 4. MetaGPT

- 形式：一行需求 → 内部按"软件公司 SOP"（PM/架构师/工程师多 agent 流水线）产出需求文档、API、数据结构和最终**代码仓库**（`Code = SOP(Team)`）。[MetaGPT README](https://github.com/FoundationAgents/MetaGPT)
- 产物：代码仓库 + 中间文档（用户故事/PRD/API 设计）。
- 一次性生成机制：有（`metagpt "Create a 2048 game"` → ./workspace 里的仓库）。
- 取舍：SOP 流水线本身相当于"隐式配方"，但没有显式可序列化配方；属于 spec→代码路线的代表，同样面临生成质量与迭代问题。

---

## 三、蓝图/配方模式的先例（可序列化 agent 定义）

### 1. OpenAI Assistants API

- 形式：assistant 是**可序列化 JSON 对象**（instructions/model/tools），通过 API 创建/读取/更新。[Assistants API Quickstart](https://github.com/openai/openai-assistants-quickstart)（quickstart 在启动时 `POST /api/assistants` 创建 assistant）；[Assistants API overview](https://platform.openai.com/docs/assistants/overview)
- 产物：**SaaS 托管**的 assistant，不是代码、也不是本地配置。
- 一次性生成：无（assistant 是长期持久实体）。
- 结论：业界最权威的"可序列化 agent 蓝图"先例，但落在**托管运行时**，不生成代码。

### 2. OpenAI Agents SDK

- 形式：代码优先——`Agent(name, instructions, tools, handoffs...)` 用代码构造；运行时各配置项接受"typed 对象或等价字典"。该 SDK 也支持把 agent 当工具、handoff、guardrail 等编排。[OpenAI Agents SDK README](https://github.com/openai/openai-agents-python)
- 产物：SDK 运行时内运行；不生成项目。
- 一次性生成：无。
- 结论："agent = 配置对象"（instructions/tools/handoffs 组合）成为事实上的社区惯例，我方配方的字段语义（选组件、连线、参数）与之同构。

### 3. Claude Agent SDK

- 形式：代码定义 agent/subagent/tools/model，基于 Claude Code 能力（文件编辑、命令执行）。[Claude Agent SDK README](https://github.com/anthropics/claude-agent-sdk)；[官方文档](https://docs.claude.com/en/api/agent-sdk/overview)
- 产物：SDK 运行时内运行；不生成项目、无可序列化蓝图格式。

### 4. smolagents

- 形式：代码定义 agent（CodeAgent/ToolCallingAgent）+ 工具注册（`@tool` 装饰器、ToolCollection、MCP 集成）。
- **可序列化先例**：官方支持 `agent.push_to_hub("...")` / `agent.from_hub(...)` 在 Hub 上序列化并复用 agent，工具也可 `Tool.from_hub` 共享。[smolagents README](https://github.com/huggingface/smolagents)
- 产物：运行时内运行；Hub 上的 agent/tool 是可移植序列化定义。
- 结论：证明"agent/tool 定义可序列化、可共享复用"是业界已接受的模式（对应我方组件库/配方库思路）。

### 5. LangGraph

- 形式：代码构造**图**（节点/边/状态），是"组件+连线"的权威抽象（nodes ↔ 我方组件，edges ↔ 我方连线）。[LangGraph README](https://github.com/langchain-ai/langgraph)
- 产物：运行时内运行；部署/共享走 LangGraph Platform 的 `langgraph.json` 类配置与 LangSmith Studio（官方称可 *"Discover, reuse, configure, and share agents... iterate quickly with visual prototyping"*）。
- 一次性生成：无（studio 是可视化原型，运行时仍是图定义）。
- 结论：图/节点/边的"接线"心智模型与接线引擎一致，但 LangGraph 把图当长期代码资产，不"生成即弃"。

### 6. MCP（Model Context Protocol）

- 形式：**工具/服务器契约标准**（协议 + JSON Schema 化的 schema）。[MCP 官方仓库](https://github.com/modelcontextprotocol/modelcontextprotocol)
- 结论：工具组件"接口契约"的行业标准；我方工具组件的接口契约可直接对齐 MCP 风格。

### 7. Google Genkit

- 形式：代码定义 flows / tool calling / prompts（dotprompt）/ RAG；提供本地 CLI 与 Developer UI 调试、评估、观测。[Genkit README](https://github.com/firebase/genkit)
- 产物：你的应用代码，可部署到任何平台；不是配置托管。
- 结论：代码优先 + 本地开发工具（UI/评估/观测）一体，是"代码真相源 + 自带评估监测工具链"的代表，对我方"产物自治 + 评估工程"取舍有参考价值。

---

## 四、模板/脚手架生成器（agent 版 create-t3-app）

### 1. create-t3-app / create-next-app

- 范式本身：交互式问答 → 选型 → **一次性生成自包含项目源码**；无长期"配方"。create-llama 明确自述借鉴 create-next-app（见上）。[create-t3-app](https://github.com/t3-oss/create-t3-app)
- 结论：这是"配方即弃"脚手架模式的行业母版：**交互输入即一次性配方，产物是普通代码，之后用 git 与手改管理**。

### 2. Dify DSL + Build-by-Chat（重述，见 Dify 一节）

- 组装器环节的业界化：自然语言需求 → LLM 产出结构化 agent 配置（含 build_note 记忆）。[Dify Build 文档](https://docs.dify.ai/en/self-host/use-dify/build/new-agent/build.md)

### 3. CrewAI Skills / 组装器先例（重述，见 crewAI 一节）

- 用 Skills 文件把"搭 agent/搭 crew"的最佳实践注入 coding agent，即"内化设计知识的组装器"。[crewAI README](https://github.com/crewAIInc/crewAI)

---

## 五、三态分类

### A. 能直接复用的模式（业界已验证，照抄即可）

1. **结构化 agent 描述的字段模型**：组件=instructions/model/tools/parameters、连线=handoffs/edges/tasks 引用（OpenAI Agents SDK、LangGraph、crewAI agents.yaml/tasks.yaml、Dify DSL）。配方 JSON 的 schema 可直接对齐这些既有语义。[OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | [crewAI](https://github.com/crewAIInc/crewAI)
2. **"需求 → LLM 组装配置"的组装器环节**：Dify Build-by-Chat（含 build_note 记忆）证明可产品化；CrewAI 用 Skills 给 coding agent 注入搭 agent 知识。[Dify](https://docs.dify.ai/en/self-host/use-dify/build/new-agent/build.md) | [CrewAI Skills](https://github.com/crewAIInc/skills)
3. **一次性生成独立代码项目的脚手架机制**：create-llama（"Just generate code"）、crewai create crew、create-t3-app 范式——生成即弃、产物自治、git 管理。[create-llama](https://github.com/run-llama/create-llama)
4. **agent/tool 定义的可序列化共享**：smolagents push_to_hub/from_hub 证明"序列化定义+复用"成立。[smolagents](https://github.com/huggingface/smolagents)
5. **评估与监测基础设施**：Langfuse / LangSmith / Genkit DevUI 与"评估工程三层 + 监测系统"对应，可借鉴其数据集/实验/消融形态。[Langfuse](https://langfuse.com/docs)

### B. 值得参考的架构取舍

1. **配置驱动 vs 代码生成**：业界共识是"配置=原型，代码=生产"（Langflow 官方表述 + AutoGen Studio 自我声明"not production-ready, use the framework"）。可视化搭建器赢在快速上手与内置调试/评估，输在平台绑定与不可维护。[Langflow](https://docs.langflow.org/) | [AutoGen Studio](https://github.com/microsoft/autogen/blob/main/python/packages/autogen-studio/README.md)
2. **"声明式描述 + 命令式代码"混合是收敛方向**：crewAI（yaml 配置 + py 代码）、LangGraph（图代码 + 平台配置）、Dify（画布 + DSL）都在同时保留"结构化描述"与"可编程逻辑"。我方配方≈声明式、生成代码≈命令式，正落在该收敛点上。
3. **组装器落点选择**：业界（Dify 等）把 LLM 组装结果留在**平台运行时**（为了复用 eval/monitoring/deploy）；我方选择**物化为独立代码**并生成即弃——这是有意反主流，代价是失去平台化能力，必须自建评估监测（本库已规划）并用 git/CI 补版本管理。
4. **接口契约标准**：工具契约对齐 MCP（JSON Schema），组件接口契约的"能不能接、怎么接"判定可借鉴 MCP 的 schema 化思路。[MCP](https://github.com/modelcontextprotocol/modelcontextprotocol)

### C. 业界已验证"不该怎么做"的坑

1. **把可视化配置当长期真相源 → 不可维护**：AutoGen Studio 官方声明只能当原型；Flowise/Dify 的配置随平台升级易失效。"配置即代码"会退化成巨型难读 JSON。→ 支持我方"配方不长期保存"。
2. **把配方/蓝图当唯一真相源 → 版本同步负担与状态漂移**：Dify DSL 导出不含 skills/files（跨实例导入丢东西）、版本回溯只回滚配置不回滚 sandbox（配置与运行状态会不一致）。[Dify](https://docs.dify.ai/en/self-host/use-dify/build/new-agent/build.md) → 支持我方"配方即弃，不留版本同步负担"。
3. **纯 LLM spec→完整项目"一次到位"不可靠**：gpt-engineer 自我降级为"experimentation platform"，团队转向托管服务与 aider 式人控迭代。[gpt-engineer](https://github.com/gpt-engineer-org/gpt-engineer) → 我方"生成起点后由 coding agent 直接操作 demo 代码继续迭代"正是对它的回应。
4. **生成即弃 ≠ 丢弃一切中间产物**：Dify 用 build_note 保留组装过程记忆以支撑后续 build 会话。[Dify](https://docs.dify.ai/en/self-host/use-dify/build/new-agent/build.md) → 提示：配方虽弃，生成的**设计/组装记录**（如 build note 等价物）应物化进产物，作为后续迭代上下文。

---

## 六、结论：我方"配方一次性启动器 + 生成即弃"在业界的定位

1. **不是创新，是"已验证路径的刻意组合"**。链路各段都有成熟先例：结构化配方描述（Dify DSL / n8n / smolagents / crewAI / OpenAI Agents SDK）、LLM 组装（Dify Build-by-Chat / CrewAI Skills / AFlow）、一次性生成代码项目（create-llama / crewai create crew / gpt-engineer / MetaGPT）。没有任何一段需要我们从头发明。

2. **"配方即弃"这一点反主流但非空想**。主流（Flowise/Dify/n8n/Assistants API）把结构化描述当**长期运行时真相源**，为的是复用运行时（监控/评估/部署/版本管理）。我方选择"生成即弃、产物自治代码"，本质是把"配置驱动搭建器"的**快速出原型**优点与"脚手架生成器"的**产物自治**优点合并，同时主动丢弃"配置即运行时"这个被业界公认难维护的坑。这个落点与 create-llama / crewai create crew 是同一象限，区别是我方由**组装器（LLM）自动产出配方**而非人工交互选型。

3. **主要风险与对策**（都是已知问题的主动承担，而非未知雷区）：
   - 放弃平台运行时 → 自建评估工程三层 + 监测系统（本库 CONTEXT 已规划，Langfuse/LangSmith 为成熟参照）。
   - 纯 LLM 生成不可靠 → 只承诺"生成第一个可运行起点"，调试阶段由同一 coding agent 直接改代码（gpt-engineer 的教训）。
   - 配方即弃丢上下文 → 组装记录（build note 等价物）物化进产物。

4. **一句话定位**：我方设计是"**脚手架生成范式 + LLM 组装器**"在 agent demo 垂直场景的组合应用，其中"配方即弃、不留版本同步负担"是刻意的反主流取舍，符合业界已验证的"配置=一次性输入、代码=真相源"共识，而不是逆向已知坑。

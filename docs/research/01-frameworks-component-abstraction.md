# 现有 Agent 框架的"组件抽象"能否覆盖自研组装机制

> 调研日期：2026-08-07。本文件为**一手来源调研**：官方文档官网、官方 API 文档、GitHub 官方源码。关键论断均附来源 URL。调研者身份：调研 agent（只研究，不写产品代码）。
>
> 调研动机：我们在设计一个 agent 组件库（Python），核心机制是 **结构化配方（recipe，JSON）→ 确定性接线引擎（wiring engine）按接口契约模板生成胶水代码 → 生成可运行的单体 agent demo**。组件薄接口，prompt/超参数作为契约参数暴露。评估工程需要组件级 + 参数级消融对比。我们倾向自建薄接口，本文用事实检验该倾向。

---

## 目录

1. [概述与判断框架](#1-概述与判断框架)
2. [LangChain / LangGraph](#2-langchain--langgraph)
3. [LlamaIndex](#3-llamaindex)
4. [smolagents（HuggingFace）](#4-smolagentshuggingface)
5. [PydanticAI](#5-pydanticai)
6. [AutoGen / AG2](#6-autogen--ag2)
7. [CrewAI](#7-crewai)
8. [三态分类：值得参考 / 可直接复用 / 必须自建](#8-三态分类值得参考--可直接复用--必须自建)
9. [结论：对我方设计倾向的判断](#9-结论对我方设计倾向的判断)
10. [来源清单](#10-来源清单)

---

## 1. 概述与判断框架

对每个框架回答五个问题：

1. **组件切分**：拆成了哪些组件？组件接口契约（输入/输出/参数）长什么样？
2. **组装方式**：代码写死、配置驱动，还是有"配方/蓝图/可序列化定义"？
3. **配方机制**：有没有"把组件选择 + 连线 + 参数序列化成结构化定义，再生成/实例化 demo"的现成机制？
4. **参数暴露**：超参数/prompt 如何暴露？能否在运行期/配置里覆盖单个组件参数（消融实验的关键）？
5. **拓扑模型**：组件间连线是自由拓扑，还是受特定编排模型限制（chain/state machine/graph/agent loop）？该模型会不会限制"配方→生成"的自由度？

回答基于一手来源（URL 均实际抓取过），其中若干论断来自源码文件（标注 `源码` 字样），并给出版本化链接。

---

## 2. LangChain / LangGraph

### 2.1 组件切分与接口契约

LangChain 1.x 官方把产品定位为三层：**runtime（LangGraph） / framework（LangChain） / harness（Deep Agents）**。LangChain 官方现在的核心口号是：

> "Agent = Model + Harness … The harness is everything around the model loop: the prompt, the tools, and any middleware that shapes behavior."
> — https://docs.langchain.com/oss/python/langchain/overview

组件清单：

- **Model**：`ChatModel` 等统一模型接口（"Use one interface for chat models, embeddings, and more across providers"）— https://docs.langchain.com/oss/python/langchain/overview
- **Tool**：`@tool` 装饰器。接口契约 = **Python 类型注解**（type hints 定义输入 schema，成为发给模型的 JSON Schema）+ docstring 作为工具描述 + 可选 `args_schema`（Pydantic 模型或 JSON Schema）。运行时上下文通过保留参数 `ToolRuntime`（state / context / store / stream_writer / execution_info / server_info / config / tool_call_id）注入。— https://docs.langchain.com/oss/python/langchain/tools
- **Middleware**：可组合钩子（before/after 模型调用、工具调用等步骤），传给 `create_agent(middleware=[...])`，用于重试、降级、PII、限流等。— https://docs.langchain.com/oss/python/langchain/middleware
- **Prompt**：`create_agent(..., system_prompt=...)` 作为 harness 参数。— https://docs.langchain.com/oss/python/langchain/overview
- **Runnable**：底层统一基类（`invoke/batch/stream` + `InputType/OutputType` + `get_input_schema/get_output_schema/get_graph` + 可配置字段）。来自 langchain-core 源码 `runnables/configurable.py`（含 `RunnableSerializable`、`DynamicRunnable`）。— https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/runnables/configurable.py
- **LangGraph 编排层**：`State`（TypedDict/Pydantic/dataclass + 每个字段独立 reducer）、`Nodes`（函数，接收 state + config + runtime，返回部分 state 更新）、`Edges`（固定边 / 条件边 / `Send` 动态分发 / `Command(update,goto)` 合并状态更新与路由）。— https://docs.langchain.com/oss/python/langgraph/graph-api
- **Memory**：两套持久化——**Checkpointer**（thread 作用域短时记忆，图状态快照）+ **Store**（跨 thread 长时记忆，namespace/key KV）。— https://docs.langchain.com/oss/python/langgraph/persistence

### 2.2 组装方式

代码优先。LangGraph 图用 Python builder 链式定义：`StateGraph(State).add_node(...).add_edge(...).add_conditional_edges(...).compile()`，编译前强制校验（孤儿节点等）。— https://docs.langchain.com/oss/python/langgraph/graph-api

LangChain 高层组装用工厂函数 `create_agent(model, tools, system_prompt, middleware, ...)`。— https://docs.langchain.com/oss/python/langchain/overview

**没有**图级别的"配置驱动组装"；组装即代码。但部署侧有 `langgraph.json`（CLI/Server 声明哪些图作为服务入口），属于部署配置而非组装配方。

### 2.3 配方机制（能否序列化→再生成/实例化）

关键结论：

- **LCEL Runnable 可序列化**：`RunnableSerializable`（`is_lc_serializable()=True`、`get_lc_namespace()`），`DynamicRunnable`（`configurable_fields`/`configurable_alternatives` 生成）也是可序列化类型。这意味着一部分组件（prompt、model、chain）可以被 dump/load 成 LangChain 自己的序列化格式。— 源码 https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/runnables/configurable.py
- **LangGraph 图不可序列化重建**：编译后的 `Pregel` 提供 `get_graph()`，但其 docstring 明确写着 "Return a **drawable representation** of the computation graph"，即仅用于可视化/检查，不是可反序列化的配方。— 源码 https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/pregel/main.py （`get_graph` 定义于第 845 行）
- 因此：LangGraph 的"节点函数/条件路由函数"必须是代码（注册引用），图结构本身可以被人为表达成节点/边列表，但**没有官方机制**把图定义整体序列化为 JSON 再重建。LangGraph Server 的"assistant"概念存的是"graph 配置引用 + config"，图本体仍由部署的 Python 代码提供。

### 2.4 超参数/prompt 暴露与单参数覆盖（消融关键）

**LangChain 是目前六个框架中对"运行期覆盖单个组件参数"支持最好的一个**，机制：

- `Runnable.configurable_fields(temperature=ConfigurableField(id="temperature", ...))` → 运行时在 `config={"configurable": {"temperature": 0.9}}` 里覆盖单个超参。
- `Runnable.configurable_alternatives(ConfigurableField(id="prompt"), default_key="joke", poem=PromptTemplate.from_template(...))` → 运行时切换整个组件（swap 组件实现），等价于"组件级消融"的开关。
- 二者都能叠加在 `RunnableSequence`（`prompt | model`）上，每个被选中的备选组件还可以有自己命名空间化的可配置字段（`prefix_keys`，如 `model==gpt3/temperature`）。
- 源码即 API 文档：`RunnableConfigurableFields` / `RunnableConfigurableAlternatives` 的 docstring 含完整示例 — https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/runnables/configurable.py

LangGraph 侧：`context_schema` 在构造图时声明（如 llm_provider），`graph.invoke(inputs, context={...})` 运行期传参；节点可读 `runtime.context`。— https://docs.langchain.com/oss/python/langgraph/graph-api

prompt 本身是 Python 对象（`PromptTemplate`/`system_prompt` 字符串），不是配方里的纯数据字段（除非用 configurable_alternatives 把 prompt 备选做成可配置项）。

### 2.5 拓扑模型

- LangGraph = **有向图 + 共享 state 的 Pregel 消息传递**（super-step 语义，可并行、可循环、可条件分支、可子图）。拓扑自由度最高（"mix deterministic and agentic steps in the same graph"）。— https://docs.langchain.com/oss/python/langgraph/graph-api 与 https://docs.langchain.com/oss/python/langgraph/overview
- LangChain `create_agent` = 固定的 **agent loop**（调模型→选工具→执行→回到模型直到无工具调用）+ middleware 在环上打钩。— https://docs.langchain.com/oss/python/langchain/middleware
- 对"配方→生成"的含义：图拓扑**可以**被表达成结构化定义（节点 id 列表 + 边列表 + 条件），但节点实现必须落到代码/注册引用。编排模型（图 + 共享 state schema + reducer）会要求配方里显式声明 state schema 和 reducer——这其实是好事，因为 state 契约本身就是接线依据。

---

## 3. LlamaIndex

### 3.1 组件切分与接口契约

官方对 agent 的定义："an agent is a system that uses an **LLM, memory, and tools** to handle inputs"。— https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/

组件清单：

- **LLM**：`OpenAI(...)` 等模型对象，可作独立模块使用或嵌入高层抽象（`customizing LLMs within LlamaIndex Abstractions`）。— 文档导航 https://developers.llamaindex.ai/python/framework/module_guides/models/llms/usage_custom/
- **Tools**：普通 Python 函数即可；或用 `FunctionTool`、`QueryEngineTool`、`Tool Specs` 类定制。— https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/
- **Memory**：默认 `ChatMemoryBuffer`，可外部构造 `ChatMemoryBuffer.from_defaults(token_limit=40000)` 后传入 agent。— https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/
- **Agents**：`FunctionAgent`（函数调用）、`ReActAgent`、`CodeActAgent`（不同提示策略），组合成 `AgentWorkflow`（多 agent）。— 同上
- **Workflows**：事件驱动的 step 模型——step 接收事件、返回事件；**step 的输入/输出事件类型由类型注解推断**，且作为"接线契约"：框架据此做图校验（事件必须有生产者和消费者、无死端）。— https://developers.llamaindex.ai/python/llamaagents/workflows/

### 3.2 组装方式

- Agent：代码组装（`FunctionAgent(tools=[...], llm=..., system_prompt=...)`、`AgentWorkflow(agents=[...])`）。— https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/
- Workflow：**子类化 + 装饰器**，代码优先；"连线"由事件类型注解自动推断，而不是显式 add_edge。— https://developers.llamaindex.ai/python/llamaagents/workflows/
- 模板化启动：`llamactl` CLI 拉取 **Agent Templates**（Basic Workflow / RAG / Human in the Loop / Document Q&A 等），生成一个带全部源码 + UI + `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` 的项目起点。— https://developers.llamaindex.ai/python/llamaagents/llamactl/agent-templates/

### 3.3 配方机制

- Workflow 定义在代码里（Python 类 + 注解），**没有** JSON/YAML 配方→重建的官方机制；官方虽提供 `draw`（mermaid 图）做可视化，但那是画图不是重建。— https://developers.llamaindex.ai/python/llamaagents/workflows/
- `Resource(...)` 机制用于注入"不应存在于序列化 state 里的依赖"（客户端/索引/模型/配置），间接承认 workflow 本身不打算被全量序列化。— https://developers.llamaindex.ai/python/llamaagents/workflows/
- Agent Templates 是最接近"配方"的东西，但它是**代码模板**（脚手架），不是"数据配方→引擎生成"。

### 3.4 超参数/prompt 暴露

- 模型超参在 `OpenAI(model=..., api_key=...)` 构造时传入；agent 级参数在 `FunctionAgent(..., streaming=False)` 等构造参数里。— https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/
- 全局 `Settings` 对象统一配置默认 LLM/embedding/tokenizer 等（`Configuring Settings` 文档页面存在于导航）。— https://developers.llamaindex.ai/python/framework/module_guides/supporting_modules/settings/
- **没有** LangChain 那种"运行期 per-invoke 覆盖单个组件参数"的统一机制；参数覆盖要靠构造时传参或改 Settings。对消融实验意味着：每次变体需重新构造 agent 实例。

### 3.5 拓扑模型

Workflow 的事件驱动模型：分支 = step 内 `if` 返回不同类型事件；循环 = 返回被更早 step 处理的事件；并发 = `list[Event]` ↔ `list[Event]` 配对；动态 = `ctx.send_event`。官方明确说明"用 DAG 表达逻辑有局限，事件模型更好"。— https://developers.llamaindex.ai/python/llamaagents/workflows/

对"配方→生成"的含义：接线契约 = **事件类型注解**，而不是显式边。这个模型自由度高（任意事件流），但接线信息藏在类型注解里，结构化配方需要先"读出"注解——适合自建引擎直接引用 step 的输入/输出类型作为契约。

---

## 4. smolagents（HuggingFace）

### 4.1 组件切分与接口契约

官方强调抽象极简（"the logic for agents fits in ~1,000 lines of code … We kept abstractions to their minimal shape"）。组件：

- **Model**：`InferenceClientModel` / `LiteLLMModel` / `OpenAIModel` / `TransformersModel` 等（模型无关、模态无关）。— https://github.com/huggingface/smolagents
- **Tools**：`@tool` 装饰器函数；`Tool` 基类（`name/description/inputs/outputs` 字典 + `forward`）；`ToolCollection`（聚合）；可从 MCP、LangChain、HF Space、Hub 拉取工具。— https://github.com/huggingface/smolagents
- **Agents**：`CodeAgent`（动作写为 Python 代码）、`ToolCallingAgent`（动作写为 JSON/文本），二者都走 ReAct loop；支持 `managed_agents` 多 agent 层级。— https://github.com/huggingface/smolagents
- **Memory**：`agent.memory`（chat messages），是 ReAct loop 内的结构化记忆。— https://github.com/huggingface/smolagents （README 中的 ReAct 流程图示）
- **Prompt templates**：系统提示词模板以 yaml 文件形式存在库内（`code_agent.yaml`、`toolcalling_agent.yaml`），且每个 agent 可带自己的 `prompt_templates`。— 源码 https://github.com/huggingface/smolagents/blob/main/src/smolagents/agents.py

### 4.2 组装方式

代码优先：`CodeAgent(tools=[WebSearchTool()], model=model, stream_outputs=True)`。另有 CLI（`smolagent` / `webagent`，交互式向导选 agent 类型/工具/模型）与 Hub 分享。— https://github.com/huggingface/smolagents

### 4.3 配方机制（重点——最接近"序列化 + 生成代码"）

smolagents 是目前六个框架里**最贴近"配方 → 生成可运行代码"思路的现成先例**：

`MultiStepAgent.save(output_dir)` 会一次性生成：
- `agent.json` —— agent 的字典表示（class 名、`tools` 的 `to_dict()`、`model` 的 `to_dict()`、`prompt_templates`、`max_steps`、`planning_interval`、`verbosity_level`、`name`、`description`、`requirements`）；
- `prompts.yaml` —— 提示词模板；
- `tools/{tool_name}.py` —— 每个工具的实现代码文件；
- `app.py` —— **自动生成的 Gradio 前端可运行代码**（Jinja2 模板渲染）；
- `requirements.txt`。

对称地有 `to_dict()` / `from_dict()`（支持 kwargs 覆盖）、`push_to_hub()` / `Agent.from_hub()`（把 agent 作为 Space 仓库分享/拉取）。— 源码 https://github.com/huggingface/smolagents/blob/main/src/smolagents/agents.py （`save` 约 892 行起，`to_dict` 970 行，`from_dict` 1010 行，`from_hub` 1065 行，`push_to_hub` 1160 行）

限制（源码自述）：`final_answer_checks`、`step_callbacks` 不可序列化，会被忽略并打日志。— 同上 `to_dict`

### 4.4 超参数/prompt 暴露

- `agent.json` 覆盖 agent 级参数：`max_steps`、`planning_interval`、`verbosity_level`、`name`、`description`、`prompt_templates`。
- 模型超参（temperature、max_new_tokens 等）在模型构造时传入，并随 `model.to_dict()` 进入配方。
- `from_dict(agent_dict, **kwargs)` 的 kwargs 可覆盖配方值。
- **没有** LangChain 式运行期 per-invoke 覆盖；覆盖发生在"加载配方"时。

### 4.5 拓扑模型

- 固定 **ReAct loop**（task→memory→generate→execute→memory 循环，直到 `final_answer`）。— https://github.com/huggingface/smolagents
- 多 agent 通过 `managed_agents` 层级（子 agent 由主 agent 调度），仍受"loop + 层级"约束，**没有一般图**。
- 对"配方→生成"的含义：编排模型非常受限。它把"自由拓扑"直接排除掉；但正因如此，它的配方格式很简单（单个 agent + 工具列表），可以作为"单体 agent 配方"的参考格式。

---

## 5. PydanticAI

### 5.1 组件切分与接口契约

- **Agent**：核心单元，泛型 `Agent[Deps, Output]`。配置项：`model`、`instructions`（静态或 `@agent.instructions` 动态）、`output_type`（结构化输出）、`deps_type`（依赖注入）、`model_settings`、`retries`、`end_strategy`、`tool_timeout`。— https://ai.pydantic.dev/
- **Tools**：`@agent.tool` 注册，`RunContext[Deps]` 携带依赖；Pydantic 校验参数并把错误回传给模型重试；docstring 作工具描述。— https://ai.pydantic.dev/
- **Capabilities（能力包）**：可组合单元，把工具、钩子、指令、model settings 打包复用；内置 Thinking / WebSearch / WebFetch / ImageGen / MCP / ToolSearch / DurableExecution 等；官方 Harness 提供代码执行、文件访问、guardrails、子 agent 编排。— https://ai.pydantic.dev/
- **Graph**：用类型提示定义有状态图，用于复杂控制流。— https://ai.pydantic.dev/
- **Deps / Output**：`deps_type` + `RunContext` 依赖注入；`output_type` 结构化输出（Pydantic 校验，失败自动 reflection 重试）。— https://ai.pydantic.dev/

### 5.2 组装方式

双轨：
- 代码优先：`Agent('anthropic:claude-sonnet-4-6', instructions=..., capabilities=[...])`。— https://ai.pydantic.dev/
- **声明式（重点）**：Agent Specs——"define agents entirely in YAML/JSON — no code required"。— https://pydantic.dev/docs/ai/core-concepts/agent-spec/

### 5.3 配方机制（重点）

PydanticAI 的 **AgentSpec** 是目前"组件选择 + 参数序列化"最完整的官方机制：

- `Agent.from_file('agent.yaml')` 加载；`Agent.from_spec(dict)` 加载并可叠加覆盖参数。
- `AgentSpec.to_file('agent.yaml')` 导出，**还自动生成配套 JSON Schema 文件**供编辑器自动补全/校验。
- 规格字段：`model`、`name`、`description`、`instructions`、`model_settings`、`capabilities`（列表）、`deps_schema`（JSON Schema 校验模板变量）、`output_schema`（结构化输出 schema）、`retries`、`end_strategy`、`tool_timeout`、`instrument`、`metadata`。
- 模板字符串：指令/描述里 `{{variable}}` 在运行时用 deps 渲染（`TemplateStr`）。
- **Capability 的 spec 语法**：`'MyCapability'` / `{'MyCapability': value}` / `{'MyCapability': {key: value}}` 三种形态，统一调用 `MyCapability.from_spec()`；自定义能力可发布以支持 specs。
- **merge 语义（消融相关）**：`from_spec(dict, **kwargs)` 时——标量字段 kwargs 覆盖 spec；`instructions` 与 `capabilities` 为**合并**（spec 在前）；`model_settings` **增量合并**（kwargs 覆盖同名项）；`output_type` 优先于 `output_schema`。

— https://pydantic.dev/docs/ai/core-concepts/agent-spec/

### 5.4 超参数/prompt 暴露

- 单 agent 全参数在 spec 里；运行期覆盖通过 `from_spec(..., **kwargs)` 的 merge 语义。
- `model_settings`（如 `max_tokens`）作为普通 dict 暴露，可增量覆盖——非常便于参数级消融。
- 多 agent 的"图"（Graph）不在此 spec 覆盖范围：AgentSpec 只描述**单个 agent**，跨 agent 接线仍要代码。

### 5.5 拓扑模型

- 默认 = 固定 **agent loop**（模型↔工具直到输出）。
- 复杂控制流 = **Graph**（类型提示定义状态图）。
- AgentSpec 不序列化 Graph；"配方"只到单 agent 粒度。对"配方→生成"的含义：如果我们的配方目标是单体 agent，PydanticAI 的 spec 已几乎完整；如果需要多 agent 图，仍需自建图配方的表达。

---

## 6. AutoGen / AG2

> 注意：AutoGen（Microsoft）与 AG2（社区 fork）自 AG2 v1.0 起已分叉为两套独立框架。AutoGen 0.4+ 是 `autogen-agentchat`/`autogen-core`；AG2 v1.0 是 `import ag2` 的协议驱动框架，经典 `ConversableAgent`/`GroupChat`（`import autogen`）已迁到独立仓库 ag2-classic。— https://github.com/ag2ai/ag2

### 6.1 组件切分与接口契约（AutoGen）

- **Agents**：`AssistantAgent`、`UserProxyAgent`、`CustomAgent`；agent 配置含 name、system_message、model_client、handoffs、model_context、description。
- **Teams**：`RoundRobinGroupChat`、`SelectorGroupChat`、`Swarm`、`MagenticOne`、`GraphFlow`（实验性）。
- **TerminationConditions**：`MaxMessageTermination`、`StopMessageTermination` 等，可组合（`|`）。
- **Model clients / Tools / ModelContext**：`OpenAIChatCompletionClient`、`FunctionTool`、`UnboundedChatCompletionContext` 等。
- 所有组件实现 **`autogen_core.Component`** 基类：统一"声明式规范（declarative spec）"的序列化/反序列化能力。
  — https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/index.html 与 https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/serialize-components.html

### 6.2 组装方式

- 代码优先：`AssistantAgent(...)` + `Team(participants=[...], termination_condition=...)`。
- 声明式/低代码：**AutoGen Studio**——"Team Builder"用 JSON 声明式规范或拖拽创建 teams，可配置 teams/agents/tools/models/termination conditions；Playground 运行；Gallery 分享/导入组件；**Deployment 把 team 导出为 Python 代码运行**。— https://microsoft.github.io/autogen/stable/user-guide/autogenstudio-user-guide/index.html

### 6.3 配方机制（重点）

AutoGen 提供 `Component.dump_component()` / `load_component()`，把任意组件（agent/team/termination/model/chat_context）序列化为**自描述 JSON**，典型结构：

```json
{
  "provider": "autogen_agentchat.agents.AssistantAgent",
  "component_type": "agent",
  "version": 1,
  "component_version": 1,
  "config": { "name": "...", "model_client": { ... }, "system_message": "..." }
}
```

`load_component` 从 JSON 重建对象，并支持嵌套（team 的 config 里含 participants 列表）。— https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/serialize-components.html

已知限制（官方示例代码自述）：
- **tools 的序列化尚未支持**（代码注释 `# tools=[], # serializing tools is not yet supported`）；`selector_func` 也不可序列化会被忽略。
- 官方警告 "**ONLY LOAD COMPONENTS FROM TRUSTED SOURCES**"——反序列化可能执行代码（如序列化的函数）。
  — 同上

AutoGen Studio 的 JSON 是"配方"形态；Deployment 的"导出为 Python 代码"是我们"配方→生成 demo 代码"的最接近商业实现。

### 6.4 超参数/prompt 暴露

- 组件 config JSON 内含全部参数（system_message、model config、termination 的 max_messages 等）。
- 消融路径 = dump → 改 JSON 里的单个字段 → load → 跑新变体；Studio 里改表单也行。
- 无 LangChain 式运行期 per-invoke config 覆盖。

### 6.5 拓扑模型

- Teams 提供若干**固定编排模式**（round robin / selector / swarm），加上 **GraphFlow**（`DiGraph` 有向图：顺序、并行 fan-out/fan-in、带条件边的循环，支持 `set_entry_point` 与 termination condition）。— https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/graph-flow.html
- GraphFlow 仍标注 **experimental**（API 可能变更）。
- AG2 v1.0 侧：**Network（Hub + 类型化 channels）** 取代 GroupChat；其中 `workflow` channel 使用**声明式 `TransitionGraph`** 做条件转交（官方称其最接近经典 GroupChat）。— https://github.com/ag2ai/ag2
- 对"配方→生成"的含义：AutoGen 的 Component JSON 已是可序列化的图/团队配方（节点=agents，边=handoffs 或 DiGraph），拓扑足够自由；但节点函数型逻辑（自定义工具）目前不可序列化。

---

## 7. CrewAI

### 7.1 组件切分与接口契约

- **Agents**：`role` / `goal` / `backstory` / `llm` / `tools` / `memory` / `knowledge`（知识库）/ 结构化输出（Pydantic）。
- **Tasks**：`description` / `expected_output` / `agent` / `tools` / `output_file` / `markdown` / guardrails / callbacks / HITL 触发。
- **Crews**：agents + tasks + process + memory + knowledge 的组合单元。
- **Processes**：`sequential` / `hierarchical` / `hybrid`。
- **Flows**：事件驱动编排——`@start()` / `@listen(...)` / `@router(...)` 装饰器 + `state`（Pydantic 模型）+ 持久化/断点续跑。
  — https://docs.crewai.com/ 与 https://docs.crewai.com/en/quickstart

### 7.2 组装方式

双轨：
- 代码优先：`Crew(agents=[...], tasks=[...], process=...)`、`Flow` 子类 + 装饰器。
- **声明式（重点）**：CrewAI CLI 项目把 agent 与 crew 用 JSONC 声明：
  - `crews/content_crew/agents/researcher.jsonc`：agent 定义（role/goal/backstory/tools/settings）；
  - `crews/content_crew/crew.jsonc`：crew 定义（name、agents 列表、tasks 数组、process、verbose）；
  - `load_crew(Path(...))` 把 JSONC 加载成 `Crew`。
  - 支持 `{topic}` 变量，运行期用 `crew.kickoff(inputs=...)` 填充。
  — https://docs.crewai.com/en/quickstart

### 7.3 配方机制

- `crew.jsonc` + `agents/*.jsonc` 就是一套**声明式配方**（组件选择 + 连线(agent 指到 task) + 参数），且 task 可写 `output_file` 产出物——与我们的"配方"形态高度相似。
- 但 CrewAI 没有"配方→生成 demo 源码"的引擎：jsonc 只是被 `load_crew` 读回执行；Flows 本体仍是代码。
- 序列化方向：只有"配置→对象"，未见"对象→配置"的回写（与 AutoGen 的 dump_component 不同）。

### 7.4 超参数/prompt 暴露

- agent 的 role/goal/backstory（即 prompt 内容）就是 jsonc 里的数据字段——**prompt 本身就是配方参数**，这与我们"prompt 作为契约参数暴露"完全一致。
- task 的 description/expected_output 同理。
- 覆盖 = 改 jsonc 或 kickoff inputs；无运行期单参覆盖机制。

### 7.5 拓扑模型

- Crew 的 process 只有 sequential/hierarchical/hybrid 三种——**编排模型受限**。
- Flow 用 `@listen`/`@router` 表达更自由的步进/条件跳转（事件驱动 + 状态），是 CrewAI 里最接近"自由拓扑"的机制。
- 对"配方→生成"的含义：Crew 配方的连线模型简单（agent→task 指派 + process 类型），不适合表达自由图；Flow 更自由但纯代码。

---

## 8. 三态分类：值得参考 / 可直接复用 / 必须自建

### 8.1 值得参考的组件抽象与切法

| 来源 | 可参考的切法 | 为何值得参考 |
|---|---|---|
| LangChain | **薄接口 Runnable**（invoke/batch/stream + Input/OutputType + input/output schema） | 与"组件薄接口、契约参数化"理念同构；契约以 schema 形式暴露 |
| LangChain | **`@tool` 类型即契约**（type hints → JSON Schema，docstring → 描述，`args_schema` 显式覆盖） | 工具组件契约的既成事实标准，可作我们工具接口契约的蓝本 |
| LangChain | **middleware 环**（在 agent loop 上打钩：重试/降级/PII/限流） | 我们"监测系统/评估"可作为横切组件，middleware 是现成切法 |
| LangGraph | **State schema + 每字段 reducer** | 显式数据契约，天然是接线依据；"状态怎么写"在配方里可序列化 |
| LangGraph | **节点/边分离**（逻辑 vs 路由，`Command(update,goto)` 合并） | 路由函数与逻辑分离，消融时"换路由"只改配方的一条边 |
| LangGraph | **context 与 state 分离**（runtime context 传模型名/DB 连接） | 把"组件参数"与"运行数据"分开，参数覆盖不会污染 state |
| PydanticAI | **Capabilities 能力包**（工具+钩子+指令+model settings 打包复用） | "能力"是一种很好的组件边界；我们配方里的"组件实例"可对应 capability |
| PydanticAI | **`deps_type` 依赖注入** | 单测/消融时替换依赖极方便 |
| AutoGen | **Component 自描述格式**（provider / component_type / version / config） | 配方 schema 的版本化结构参考 |
| LlamaIndex | **事件类型即接线契约**（step 输入/输出事件注解） | 展示"接线契约可以薄到只用类型" |
| smolagents | **prompt 模板文件化**（prompts.yaml 与 agent 定义分离） | prompt 作为数据资产而非代码 |
| CrewAI | **role/goal/backstory 就是配方数据字段** | 证明"prompt 作为配方参数"是成熟做法 |

### 8.2 可直接复用 / 可直接借鉴形态的机制

| 机制 | 框架 | 直接可用/借鉴程度 |
|---|---|---|
| **运行期覆盖单个组件参数**（`configurable_fields` + `config={"configurable":{...}}`）、**组件级替换**（`configurable_alternatives`） | LangChain | **参数级消融的现成 API 形态**，可直接借鉴其设计（id/name/description/spec + 命名空间前缀）；即使自建也可照搬 API 语义 |
| **组件序列化为自描述 JSON 并回载**（`dump_component`/`load_component`） | AutoGen | 若我们决定把配方落地为"实例化组件"，这套格式（含 version/component_version）可直接照抄设计 |
| **声明式 YAML/JSON 单 agent 配方 + JSON Schema 校验 + merge 覆盖语义**（AgentSpec） | PydanticAI | "配方字段 + 覆盖语义"（标量覆盖/列表合并/字典增量合并）是参数级消融的语义范本 |
| **序列化 + 生成可运行代码**（`save()` 产出 agent.json + prompts.yaml + tools/*.py + 自动生成 app.py） | smolagents | **"配方→生成 demo 代码"的直接先例**，证明该路线可行；生成 Gradio UI 的思路与我们的运行界面呼应 |
| **声明式 crew 配置**（crew.jsonc + agents/*.jsonc + `load_crew`） | CrewAI | 证明"组件选择+连线+参数 序列化成 JSON"能服务真实生产 |
| **低代码配方 + 导出 Python 代码**（AutoGen Studio） | AutoGen | 商业化的"配方→代码"闭环参考 |
| **多 agent 图配方**（DiGraph/GraphFlow；AG2 声明式 TransitionGraph） | AutoGen / AG2 | 图拓扑序列化的可参考格式 |

### 8.3 必须自建（没有任何框架提供的）

1. **确定性接线引擎：按接口契约 + 模板生成胶水代码**。
   - 六家框架的组装要么是"代码写死"（LangGraph/LlamaIndex/smolagents），要么是"序列化后靠注册表/反射 load 回对象"（AutoGen/PydanticAI/smolagents/CrewAI）。
   - **没有任何框架"按契约推断接线并生成静态 demo 源码"**。LangGraph 的 `get_graph()` 只返回"可绘制表示"（源码 docstring 原文），不可反序列化重建；AutoGen/PydanticAI/smolagents 的 load 都是"执行/实例化既有实现"，不是"生成新代码"。

2. **契约驱动的接线检查**：框架里的"接线契约"都是隐式的（类型注解/事件类型/args_schema/state schema），**没有框架把组件输入/输出/参数声明为可被第三方引擎推理的契约对象**。我们"接口契约是接线引擎唯一依据"的机制必须自建（可参考 LangGraph state schema + LlamaIndex 事件注解的既有做法，但需显式化为数据）。

3. **统一参数级 + 组件级消融层**：LangChain 有运行期覆盖，AutoGen/PydanticAI/smolagents/CrewAI 是"改配方/构造参数"。**没有一个框架提供"一次配方、逐字段变体、自动跑分"的统一抽象**——这正是我们评估工程要自建的部分（其余框架只提供单侧能力）。

4. **配方即弃、生成即物化**：现有框架的序列化都是"持久真相源"（组件必须能 load 回来，反序列化还会执行代码——AutoGen 官方警告 ONLY LOAD FROM TRUSTED SOURCES）。我们"配方只生成第一个 demo 起点、生成后弃用、之后直接改生成的代码"的定位，与所有框架相反，也必须自建。而 smolagents `save()` 的"生成 app.py"证明"物化生成"可行。

5. **运行界面 / 监测 / 评估基础设施**：框架都只给 telemetry（LangSmith/Logfire/AG2 telemetry），不给"运行界面 + 调试面板 + 评估入口"的组合；我们运行界面是自建项。

---

## 9. 结论：对我方设计倾向的判断

### 9.1 判断：倾向成立

**"自建薄接口 + 参考成熟框架的组件边界切法"成立**，理由按证据强弱排列：

1. **核心机制（配方→确定性接线引擎→生成胶水代码）在市场上无现成实现**，必须自建。所有框架的"组装"要么是代码、要么是"序列化↔实例化"的注册表回载，没有一个做"按契约生成静态代码"。我们的差异点（生成即物化、配方即弃、契约显式化）恰好避开了各家 `load` 机制的代码注入风险（AutoGen 官方因此警告"只加载可信来源"）。

2. **组件边界切法有充分成熟参照**。模型（薄统一接口）、工具（类型即契约）、prompt（配方数据字段，CrewAI 的 role/goal/backstory、smolagents 的 prompts.yaml、LangChain 的 system_prompt）、memory（LangGraph 的 checkpoint+store、LlamaIndex 的 ChatMemoryBuffer）、state/context 分离（LangGraph）、能力包（PydanticAI capability）。我们不需要重新发明组件边界，只需要把成熟边界"薄化 + 契约化"。

3. **配方格式有多个先例验证**。AutoGen 的 Component JSON（provider/type/version/config）、PydanticAI 的 AgentSpec（含 JSON Schema 校验与 merge 覆盖语义）、smolagents 的 agent.json、CrewAI 的 crew.jsonc，证明"组件选择+连线+参数序列化"可行，且都收敛到"类型注册 + 声明式 dict/JSON"。**结论：配方 schema 应综合 AutoGen 的版本化组件结构 + PydanticAI 的覆盖语义 + CrewAI 的 prompt-as-data。**

4. **参数级消融有现成 API 可抄**。LangChain `configurable_fields`/`configurable_alternatives`（运行期 `config={"configurable":{...}}` 覆盖，含命名空间前缀）是目前最完整的"单参数覆盖 + 组件替换"机制，我们自建时直接借鉴其 API 语义即可，无需发明。

### 9.2 反例与风险（对自建倾向的挑战）

1. **PydanticAI 已接近"配方"目标，值得重新掂量自建成本**。如果我们的第一版目标只是"单体 agent + 参数消融"，PydanticAI 的 AgentSpec（YAML/JSON + 覆盖语义 + 结构化输出 + 依赖注入）几乎全中；**自建薄接口的增量价值只剩"生成静态代码""统一评估""运行界面"**。建议把 PydanticAI/AutoGen 作为"薄依赖导出"的候选，而不是一上来全自建（也呼应 CONTEXT.md 里"导出可自包含、可选薄依赖版本"）。

2. **组件抽象会漂移，薄接口要抵抗过拟合**。LangChain 从 v0.x 的 Runnable 中心走向 v1.x 的"create_agent + middleware"（官方文档产品定位已改写，Deep Agents/Studio 层叠），说明大厂自己的组件抽象都在持续重构。自建薄接口应**只契约不变的部分**（model 调用、tool schema、state 读写），把编排形态（loop/graph/event）留给接线引擎去选，否则我们会被自己的抽象绑架。

3. **"自由拓扑"需要以"节点=注册引用"实现**。LangGraph 的图结构可表达为节点/边列表，但节点函数不可序列化；AutoGen 的工具也不可序列化。**配方能表达连线，但组件实现只能是"id 引用 + 代码落地"**——配方里不能内联实现。这限制不是我们的 bug，而是该领域的公共约束，配方 schema 应按"组件 id 注册表"设计。

4. **编排模型各有所限**：smolagents/CrewAI 只到 loop/process 级别（拓扑自由度低）；LangGraph/LlamaIndex Workflows/AutoGen GraphFlow 的图都要求"共享 state"或"事件类型"契约。**我们配方→生成的自由度假定（自由拓扑 + 显式契约）目前只有 LangGraph 级别的模型能支撑**，若配方目标一开始就是单体 agent（loop），完全可以先做受限拓扑，再扩展图。

### 9.3 落地建议（由调研推得，供设计参考）

- 组件接口契约：参考 LangGraph state schema/reducer + LlamaIndex 事件注解 + LangChain tool 的"类型即契约"，显式化为可序列化的契约对象（建议用 Pydantic + JSON Schema 派生）。
- 配方 schema：借鉴 AutoGen Component（provider/type/version/config）+ PydanticAI AgentSpec（merge 覆盖语义 + JSON Schema 校验）+ CrewAI（prompt 作为数据字段）。
- 接线引擎：自建"契约→模板→代码"；smolagents `save()` 的"agent.json + 生成 app.py"是可用性证明。
- 消融层：先抄 LangChain `configurable_fields`/`configurable_alternatives` 的 API 形态，落在配方覆盖语义上（标量覆盖/列表合并/字典增量），再叠加我们的评估基础设施。

---

## 10. 来源清单

**LangChain / LangGraph**
- LangChain overview（Agent = Model + Harness）: https://docs.langchain.com/oss/python/langchain/overview
- LangChain Tools（@tool / 类型即契约 / ToolRuntime）: https://docs.langchain.com/oss/python/langchain/tools
- LangChain Middleware（agent loop 钩子）: https://docs.langchain.com/oss/python/langchain/middleware
- Runtimes / Frameworks / Harnesses 定位: https://docs.langchain.com/oss/python/concepts/products
- LangGraph overview（Pregel/Beam/NetworkX 渊源、deterministic+agentic 混排）: https://docs.langchain.com/oss/python/langgraph/overview
- LangGraph Graph API（State/Node/Edge/Reducer/Send/Command/subgraph/runtime context）: https://docs.langchain.com/oss/python/langgraph/graph-api
- LangGraph Persistence（Checkpointer + Store）: https://docs.langchain.com/oss/python/langgraph/persistence
- 源码 configurable_fields/configurable_alternatives: https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/runnables/configurable.py
- 源码 Pregel.get_graph（"drawable representation"）: https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/pregel/main.py

**LlamaIndex**
- Agents（agent=LLM+memory+tools；FunctionAgent/ReActAgent/CodeActAgent/AgentWorkflow；ChatMemoryBuffer）: https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/
- Workflows（事件驱动 step、类型注解即契约、校验、Resource）: https://developers.llamaindex.ai/python/llamaagents/workflows/
- Agent Templates（llamactl 脚手架，含 CLAUDE.md/AGENTS.md）: https://developers.llamaindex.ai/python/llamaagents/llamactl/agent-templates/
- Configuring Settings（全局配置页，导航可见）: https://developers.llamaindex.ai/python/framework/module_guides/supporting_modules/settings/

**smolagents（HuggingFace）**
- 官方 README（~1000 行、CodeAgent/ToolCallingAgent、ReAct loop、model/tool 抽象、Hub 分享）: https://github.com/huggingface/smolagents
- 源码 agents.py（save/to_dict/from_dict/from_hub/push_to_hub、agent.json+prompts.yaml+tools/*.py+app.py、不可序列化项）: https://github.com/huggingface/smolagents/blob/main/src/smolagents/agents.py

**PydanticAI**
- 首页（Agent 泛型、tools、capabilities、Graph、AgentSpec、Logfire、evals）: https://ai.pydantic.dev/
- Agent Specs（YAML/JSON 配方、from_file/from_spec/to_file、merge 覆盖语义、模板字符串、JSON Schema 生成）: https://pydantic.dev/docs/ai/core-concepts/agent-spec/

**AutoGen / AG2**
- AutoGen 首页（AgentChat/Core/Studio/Extensions 分层）: https://microsoft.github.io/autogen/stable/
- AutoGen Studio（JSON 声明式 Team Builder、Playground、Gallery、导出 Python 代码）: https://microsoft.github.io/autogen/stable/user-guide/autogenstudio-user-guide/index.html
- AutoGen AgentChat 索引: https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/index.html
- AutoGen GraphFlow（DiGraph：顺序/并行/条件/循环，experimental）: https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/graph-flow.html
- AutoGen Serialize Components（Component/dump_component/load_component、JSON 结构、工具不可序列化、可信来源警告）: https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/serialize-components.html
- AG2 README（v1.0 分叉说明、Agent/Tool/Network(Hub+channels)/TransitionGraph、ag2-classic 迁移）: https://github.com/ag2ai/ag2

**CrewAI**
- 首页（Agents/Flows/Tasks&Processes/Enterprise）: https://docs.crewai.com/
- Quickstart（crew.jsonc + agents/*.jsonc + load_crew、Flow @start/@listen、output_file）: https://docs.crewai.com/en/quickstart

# 调研：Agent 评估 / 消融 / 监测基础设施 —— 哪些可直接复用、哪些必须自建

> 调研日期：2026-08-07
> 调研方式：以一手来源为准（官方文档 / GitHub / 官方 API 文档），每个关键论断附来源 URL。
> 背景：评估工程三层 = ① 评测用例集 + 自动跑分；② 过程记录（监测遥测：每组件耗时、调用次数、token 消耗）作为评分原料；③ 消融 / A/B 对比基础设施（组件级换/删、参数级覆盖，只变一个变量观察整体效果）。

---

## 1. 概述

把 11 个工具/标准 + 3 个 agent 基准放到"评估三层"的坐标系里看，结论先行：

- **跑分层（①）** 是红海，成熟可直接薄接入：DeepEval、RAGAS、promptfoo、Evidently、TruLens 都是开源纯 Python/CLI 库，不绑平台。
- **监测层（②）** 分两种路线：SaaS 全家桶（LangSmith、Langfuse、W&B Weave）vs 自托管 OTel 收件箱（Arize Phoenix、OpenLIT、TruLens、Langfuse 开源版）。所有工具的数据模型都能表达"每个 span/observation 的耗时 + token + 调用次数"，这正是我们监测组件想要的细粒度过程数据。关键区别在于**接入厚度**：OTel 路线一行 SDK / 一个 OTLP endpoint 即可，SaaS 路线是重量级后端。
- **消融/对比层（③）** 没有任何工具原生理解"**组件级换/删**"——因为这要求工具知道我们的组件注册表、接口契约和配方结构。所有工具提供的都是**"同一个数据集跑多个变体 → 并排比报表"**（LangSmith compare、Phoenix experiments、Ragas experiments、TruLens leaderboard、promptfoo 矩阵），即**变体执行 + 报表**两个环节里的"报表"可以直接复用，而"只变一个变量的编排"必须自建（绑定我们的组件库）。
- 结论预判：**消融编排 = 必须自建（但很薄）**；**监测 = 薄接入自托管 OTel 方案（Phoenix/OpenLIT/TruLens 三选一）或直接按 OTel GenAI semconv 定义自己的遥测数据模型**；**跑分 = 直接复用**；**报表/对比视图 = 复用现成工具的实验对比能力**。

---

## 2. 各工具/标准详解

### 2.1 LangSmith

- **来源**：[官方文档首页](https://docs.smith.langchain.com/)、[Evaluation 概念页](https://docs.smith.langchain.com/evaluation)、[平台部署页](https://docs.langchain.com/langsmith/platform-setup)

**1) 覆盖哪层**
- ①跑分：强。离线评测跑在 dataset 上，支持 human / code / LLM-as-judge / pairwise 四种评估器。
- ②监测：强。观测（tracing）：run / thread，dashboard，在线评测（rules 自动跑）。
- ③消融对比：部分。同一 dataset 上多个 experiment **并排对比**；annotation queue 支持 pairwise A/B 人工判优；pairwise evaluator 比较两个版本输出。但"组件级换/删"无原生支持，需自行跑多个 experiment 再比。

**2) 数据模型 / 能否记每组件细粒度过程数据**
能。核心对象：dataset（含 example：inputs + reference outputs + metadata）、experiment（一次评测结果，含 outputs、scores、执行 traces）、run（一次执行 trace，**含中间子 run：tool call、LLM call 等，携带 latency 等元数据**）、thread（多轮）。也就是说 trace 是嵌套的 run 树，每个 LLM/工具子调用自带耗时与 token 用量。参考：[Evaluation 概念页 - Runs 段](https://docs.smith.langchain.com/evaluation)

**3) 消融/A-B 现成支持**
有"同一 dataset 多 experiment 对比"UI（compare experiment results）、pairwise queues 用于 A/B、prompt playground 对比 prompt 变体。无参数覆盖/组件换删机制。

**4) 自托管 vs SaaS / 接入厚度**
SaaS 为主（默认 Cloud）；**自托管仅 Enterprise 付费**。SDK 薄（Python/TS），但后端重（云服务或自建整套平台）。参考：[平台部署页](https://docs.langchain.com/langsmith/platform-setup)

**5) agent 专用？**
通用 LLM 应用观测+评测；agent 通过集成（LangGraph、CrewAI、Vercel AI SDK 等）支持。

---

### 2.2 Langfuse

- **来源**：[官方文档首页](https://langfuse.com/docs)、[Evaluation 概念页](https://langfuse.com/docs/evaluation/core-concepts)、[观测数据模型页](https://langfuse.com/docs/observability/data-model)、[观测总览页](https://langfuse.com/docs/observability/overview)

**1) 覆盖哪层**
- ①跑分：强。dataset + experiment；code evaluator / LLM-as-judge / 人工标注队列 / SDK 注入 score。
- ②监测：强。trace / observation / session，dashboard，token 与 cost 跟踪，基于 OpenTelemetry。
- ③消融对比：部分。**Prompt Experiments**：在 UI 里对同一 dataset 跑不同 prompt 版本，直接对比 latency/cost/eval 指标；同一 dataset 的多个 experiment run 可对比。组件级换/删无原生支持。

**2) 数据模型 / 能否记每组件细粒度过程数据**
能。核心概念：**observation（单个步骤：LLM 调用、工具调用、检索步骤，可嵌套，支持 generation/span/event 类型）+ trace（一次请求，逻辑分组）+ session（多轮会话）**。observation 携带 input/output/timing/token/cost。score（NUMERIC/CATEGORICAL/BOOLEAN/TEXT）可挂在 trace、observation、session、dataset run 上。参考：[数据模型页](https://langfuse.com/docs/observability/data-model)、[score 概念](https://langfuse.com/docs/evaluation/core-concepts)

**3) 消融/A-B 现成支持**
Prompt Experiments 是最接近"参数级覆盖"的现成功能（换 prompt 版本跑同一 dataset 并对比）。组件级消融无。

**4) 自托管 vs SaaS / 接入厚度**
**开源可自托管**（Docker/Helm）+ 云服务并存。SDK 薄（Python/JS），且基于 OTel 标准、可同时发往多个后端。后端是重量级（自建需 Postgres/ClickHouse 等）。参考：[观测总览页 FAQ](https://langfuse.com/docs/observability/overview)

**5) agent 专用？**
通用 LLM 应用平台；agent 可表达为图（Agent Graphs）。基于 OTel，兼容性好。

---

### 2.3 DeepEval

- **来源**：[官方文档首页](https://docs.confident-ai.com/)、[Metrics 总览页](https://docs.confident-ai.com/docs/metrics-introduction)

**1) 覆盖哪层**
- ①跑分：强。"pytest-native evals"，50+ 指标，RAG / agent / 多轮对话 / 多模态分类；CI/CD 可跑（`deepeval test run`）。
- ②监测：弱到中。自带 `@observe` 追踪（span/trace），但监测/看板主要在 SaaS 版 Confident AI。
- ③消融对比：弱。OSS 无 experiment 对比 UI；需自己跑两遍再比。Confident AI（企业 SaaS）提供 regression testing 与 experimentation。

**2) 数据模型 / 能否记每组件细粒度过程数据**
能（前提是自己埋 `@observe`）。对象：`LLMTestCase` / `ConversationalTestCase`（原子交互）、`Golden`/dataset、metric（产出 0-1 score + reason + threshold 判定）。`@observe` 装饰器可给任意组件建 span，metric 可挂在 span 上做组件级评测。参考：[Metrics 总览页 - Component-Level Evals](https://docs.confident-ai.com/docs/metrics-introduction)

**3) 消融/A-B 现成支持**
无 OSS 内建实验对比。agent 指标本身支持组件维度（Task Completion / Tool Correctness / Step Efficiency / Plan Adherence / Plan Quality）。

**4) 自托管 vs SaaS / 接入厚度**
OSS Python 库（Apache 2.0，本地跑，模型无关，可选接 Confident AI SaaS）。接入极薄。参考：[文档首页底部 - Apache 2.0](https://docs.confident-ai.com/)

**5) agent 专用？**
通用 LLM 评估框架；自带 agentic 指标，是 agent 端到端评测的候选跑分层。

---

### 2.4 RAGAS

- **来源**：[文档首页](https://docs.ragas.io/en/stable/)、[Experiments 概念页](https://docs.ragas.io/en/stable/concepts/experimentation/)、[Core Concepts](https://docs.ragas.io/en/stable/concepts/)

**1) 覆盖哪层**
- ①跑分：强。LLM 驱动指标库（RAG 系 + agentic 工作流系），`@experiment` 装饰器 + dataset。
- ②监测：无。本身不做遥测/看板；结果落 CSV 或云存储，可与 LangSmith/Langfuse/Phoenix 等集成。
- ③消融对比：**部分且理念最接近**。Ragas 把 experiment 定义为"对应用做一次有意改动来验证假设"，明确要求"每次只改一个变量"（isolate changes），并提供**参数化实验**（`model_name`、`temperature` 作为参数跑多个配置）和文档化的 A/B 模式；结果自动存 CSV 可对比。

**2) 数据模型 / 能否记每组件细粒度过程数据**
experiment 的返回行 = 原始行 + response + 实验元数据（experiment_name、model_version、`total_tokens`、`response_time_ms` 等）。**细粒度过程遥测不是原生能力**，但可在返回字典里手工带 token/耗时字段（官方示例就是这么做）。参考：[Experiments 概念页 - Metadata Tracking](https://docs.ragas.io/en/stable/concepts/experimentation/)

**3) 消融/A-B 现成支持**
是 OSS 里对"参数级消融"支持最直白的一个：参数化 experiment + A/B 示例 + 结果存储。组件级换/删同样无（需自己在函数里做分支，如 multi-stage 示例）。

**4) 自托管 vs SaaS / 接入厚度**
开源 Python 库，纯本地，薄。与主流框架集成（LangChain、LlamaIndex 等）。

**5) agent 专用？**
RAG 评估出身，近年扩展 agentic 指标；通用 LLM 应用 + RAG + agent。

---

### 2.5 promptfoo

- **来源**：[Intro 文档](https://www.promptfoo.dev/docs/intro/)、[Red team 总览](https://www.promptfoo.dev/docs/red-team/)

**1) 覆盖哪层**
- ①跑分：强。声明式 eval（prompts × test cases × providers），assertions/metrics 自动打分，CLI + CI/CD（GitHub Action），矩阵视图。
- ②监测：无。它是**离线评测 runner**，不是运行时观测平台（虽有缓存/成本/耗时统计，但只针对评测）。
- ③消融对比：**强（针对 prompt/model 变体）**。核心工作流就是"多个 prompt/模型 并排跑同一批测试，side-by-side 矩阵对比"——本质是 prompt/模型层面的参数级 A/B。red team 是其安全评测方向。

**2) 数据模型 / 能否记每组件细粒度过程数据**
config（YAML）声明 prompts + providers + assertions + vars；结果为每个 cell 的输出 + 断言结果 + 耗时/成本。**不追踪应用内部每个组件的 span**（黑盒测输出）；对 agent 通过自定义 JS/Python provider 脚本接进来。参考：[Intro 文档](https://www.promptfoo.dev/docs/intro/)

**3) 消融/A-B 现成支持**
有：同一批测试下多 prompt/多模型并排对比、自动断言、缓存 + 并发 + live reload 加速迭代。

**4) 自托管 vs SaaS / 接入厚度**
开源 CLI，"runs completely locally"，语言无关（配置式，可调任意 API/python）。SaaS（promptfoo.app）可选。接入薄。参考：[Intro - Why choose promptfoo](https://www.promptfoo.dev/docs/intro/)

**5) agent 专用？**
通用 LLM 应用评测 + red team；agent 评测需自写 provider 接入。

---

### 2.6 OpenAI Evals

- **来源**：[GitHub README](https://github.com/openai/evals)

**1) 覆盖哪层**
- ①跑分：中。框架 + 开源基准注册表（registry），basic / model-graded eval，可写自定义 eval。也支持 completion-fns 表达 prompt chain / tool-using agent。
- ②监测：无。可选把结果写 Snowflake。
- ③消融对比：无。

**2) 数据模型 / 能否记每组件细粒度过程数据**
eval 由 YAML + JSON 数据定义，逻辑靠 completion function / model-graded。**无 span 级遥测模型**。

**3) 消融/A-B 现成支持**
无现成对比 UI/机制。

**4) 自托管 vs SaaS / 接入厚度**
开源 Python（`pip install evals`），本地跑。OpenAI 中心化（registry 面向其模型评测）；可扩展其他 provider 但非一等公民。

**5) agent 专用？**
通用 LLM/系统评测，非 agent 专用；agent 需走 completion-fns。

---

### 2.7 W&B Weave

- **来源**：[Weave 文档首页](https://weave-docs.wandb.ai/)、W&B 文档索引 [llms.txt](https://docs.wandb.ai/llms.txt)

**1) 覆盖哪层**
- ①跑分：强。scorers（LLM judge / 自定义评分器）+ evaluation pipeline 评测应用输出。
- ②监测：强。追踪 LLM 调用与任意函数（Ops/Calls），**支持 OTel OTLP endpoint 直收**，有 Agents view（sessions/turns/LLM/tool calls）。
- ③消融对比：部分。对比走 W&B 生态：run compare、Eval Tables、reports；没有"同一 dataset 多实验并排"的一等公民对象（更偏 W&B Models 的工作流）。

**2) 数据模型 / 能否记每组件细粒度过程数据**
能。函数/LLM 调用即 traced call（span），含输入输出/版本/feedback；score 由 scorer 产出。OTel 兼容。参考：[Weave 文档首页](https://weave-docs.wandb.ai/)

**3) 消融/A-B 现成支持**
部分：靠 W&B run/table 对比，不是专门的实验对比工作流。

**4) 自托管 vs SaaS / 接入厚度**
默认 **SaaS**（需 W&B 账号）；企业有 Dedicated Cloud / Self-Managed 部署。SDK 薄，后端重。参考：[W&B 部署选项 llms.txt 条目](https://docs.wandb.ai/platform/hosting.md)

**5) agent 专用？**
通用 LLM 应用 + agent（Agents view）。

---

### 2.8 Arize Phoenix

- **来源**：[官方文档首页](https://docs.arize.com/phoenix/)

**1) 覆盖哪层**
- ①跑分：强。对 traces/spans 跑 LLM 评测器、code 检查、人工标注；dataset evaluator 挂在数据集上自动跑；可接 RAGAS / DeepEval / Cleanlab 的评测器。
- ②监测：强。基于 OpenTelemetry + OpenInference，自动插桩主流框架，span 级观测（model/retrieval/tool/custom）。
- ③消融对比：**强（OSS 自托管方案里最接近"实验对比"）**。Datasets & Experiments：把 traces 归组为 dataset，**用同一批输入重跑不同版本应用，对比评测结果**；Prompt Playground 并排试 prompt/model；Span Replay 调试。

**2) 数据模型 / 能否记每组件细粒度过程数据**
能。trace/span（OTel/OpenInference），LLM span 带 token、耗时，评测结果挂 span。OpenInference 正是为"组件级细粒度"设计的语义层。

**3) 消融/A-B 现成支持**
"同一输入 × 多个应用版本 → 对比评测结果"即参数/变体级 A/B；Prompt Playground 侧重点在 prompt 变体。组件级换/删无。

**4) 自托管 vs SaaS / 接入厚度**
**开源可自托管**（Docker / K8s / 云），Apache 2.0；OTel-native，**薄接入 = 往 OTLP endpoint 发 span**，无需改业务代码框架。参考：[官方文档 - Self-Host](https://docs.arize.com/phoenix/)

**5) agent 专用？**
通用 LLM/agent 可观测 + 评测，覆盖 agentic 工作流。

---

### 2.9 OpenLIT

- **来源**：[GitHub README](https://github.com/openlit/openlit)

**1) 覆盖哪层**
- ①跑分：中。11 种内置 LLM-as-judge 评测（hallucination/bias/toxicity/safety/following/completeness/conciseness/sensitivity/relevance/coherence/faithfulness）+ 规则引擎（按 trace 属性条件触发评测）。
- ②监测：强。**OpenTelemetry-native** 观测（LLM/向量库/GPU），成本跟踪，仪表盘；SDK（Python/TS/Go）自动插桩 50+ provider/框架。
- ③消融对比：弱。无 dataset 级实验对比；OpenGround 是"并排试用不同 LLM"的 playground，非评测对比。

**2) 数据模型 / 能否记每组件细粒度过程数据**
能。SDK 产 OTel span（遵循 `gen_ai.*` semconv），span 级带 token/耗时；评测结果作为独立信号存储。参考：[README - Features / Integrations](https://github.com/openlit/openlit)

**3) 消融/A-B 现成支持**
无专门的实验对比；OpenGround 仅模型并排试用。

**4) 自托管 vs SaaS / 接入厚度**
开源自托管（docker compose + ClickHouse），Apache-2.0；OTel 原生，**接入极薄**（一行 `openlit.init()`，或直接发 OTLP）。参考：[README - License / Getting Started](https://github.com/openlit/openlit)

**5) agent 专用？**
通用 LLM 观测；agent 通过框架插桩覆盖。

---

### 2.10 TruLens

- **来源**：[官方网站](https://www.trulens.org/)

**1) 覆盖哪层**
- ①跑分：强。指标库（agentic：Tool Selection/Plan Adherence/Execution Efficiency 等；RAG 三连；安全；质量；自定义）+ 可对 live trace 或 dataset run 评测。
- ②监测：强。**OpenTelemetry-native** 追踪，span 级 latency/tokens/cost，评估分挂到 span 上（"Scores on every step"）。
- ③消融对比：**强**。`app_version` 机制 + **Leaderboard/Compare 视图**：跨应用版本对比多条指标（含 cost/latency）；还提供 **criteria A/B test**（同一指标两套 rubric 对比）。这是 OSS 里"变体对比报表"最完整的一个。

**2) 数据模型 / 能否记每组件细粒度过程数据**
能。记录（record/trace）内嵌套 span（agent/retrieval/tool/generation），每个 span 带时序、tokens、cost；Metric（feedback function）通过 Selector 选定 span 属性评分。参考：[官网 - 数据与指标部分](https://www.trulens.org/)

**3) 消融/A-B 现成支持**
有：多版本 leaderboard 对比 + criteria A/B test + batch runs（对 dataset 重放）。组件级换/删无，但"换一版重跑再比"的报表链路现成。

**4) 自托管 vs SaaS / 接入厚度**
开源库，可写 SQLite/Postgres/Snowflake 等；无强制 SaaS；OpenTelemetry-native 使其薄接入（自带插桩或手写 `@instrument` 装饰器）。参考：[官网 - Instrument any app / Logging](https://www.trulens.org/)

**5) agent 专用？**
**是 agent 优先**的评估+追踪方案（同时覆盖 RAG、MCP、摘要等）。

---

### 2.11 Evidently

- **来源**：[文档首页](https://docs.evidentlyai.com/)、[LLM 评测 Quickstart](https://docs.evidentlyai.com/quickstart_llm)

**1) 覆盖哪层**
- ①跑分：强。100+ 指标（descriptors：确定性检查、语义相似、LLM judge、自定义模板）、声明式测试（tests + 阈值）、Report 输出。
- ②监测：中。**Platform（自托管）**提供 tracing、评估 run 存储、测试集管理、dashboard；纯 library 是离线报告模式。
- ③消融对比：部分。Report/test suite 支持对比，platform 存多个 run；无"同一 dataset 多版本并排"的一等公民对比工作流。

**2) 数据模型 / 能否记每组件细粒度过程数据**
数据集（pandas）+ descriptors 逐行加列打分；Report 汇总。**组件级 span 遥测不是 library 的重点**（平台侧有 tracing）。参考：[LLM Quickstart](https://docs.evidentlyai.com/quickstart_llm)

**3) 消融/A-B 现成支持**
无专门实验对比；靠重复跑报告对比。

**4) 自托管 vs SaaS / 接入厚度**
Apache 2.0 开源库（40M+ 下载）+ 自托管 Platform（docker）。**library 薄**；platform 较重在。参考：[文档首页](https://docs.evidentlyai.com/)

**5) agent 专用？**
通用 LLM 评估 + ML/数据监测；agent 追踪在 platform。

---

### 2.12 OpenTelemetry GenAI 语义约定（semconv）

- **来源**：[OTel 官方迁移页](https://opentelemetry.io/docs/specs/semconv/gen-ai/)、[gen-ai-spans.md（权威定义）](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)

**性质**：不是工具，是**遥测数据模型标准**，定位在我们三层的②。

- 定义了 span 类型：`Inference`（LLM 调用）、`Embeddings`、`Retrievals`、`Memory`、`Execute tool`——天然覆盖"每组件一个 span"。
- 属性覆盖我们想要的细粒度遥测：
  - token：`gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens`、`gen_ai.usage.reasoning.output_tokens`、`gen_ai.usage.cache_read.input_tokens`、`gen_ai.usage.cache_creation.input_tokens`
  - 模型/参数：`gen_ai.request.model`、`gen_ai.response.model`、`gen_ai.request.temperature`、`gen_ai.request.top_p`、`gen_ai.request.max_tokens`、`gen_ai.request.stream`
  - 语义：`gen_ai.operation.name`、`gen_ai.provider.name`、`gen_ai.conversation.id`、`gen_ai.prompt.name/version`、`gen_ai.response.time_to_first_chunk`、`gen_ai.tool.definitions`、`gen_ai.input.messages` 等
- 状态：**Development（未稳定）**，仍在演进；OpenLIT、Langfuse、Phoenix(OpenInference) 都采纳/兼容它。
- 对我们的意义：**监测组件的数据模型照抄它**（或至少对齐），保证未来任意 OTel 后端可直接消费；但注意其稳定性风险，自建时要留兼容层。

**三态**：参考其数据模型（作为监测组件对外契约的依据），不部署它。

---

### 2.13 Agent 基准（第三方对比基准，供端到端评测参考）

- **AgentBench**：[GitHub](https://github.com/THUDM/AgentBench)（ICLR'24，8 个环境：OS/DB/KG/DCG/LTP + ALFWorld/WebShop/Mind2Web；v 更新已接 AgentRL，FC 版本容器化部署，有 leaderboard）
- **τ-bench（当前版本 τ³-bench）**：[GitHub](https://github.com/sierra-research/tau-bench)、迁移说明指向 [τ²/τ³-bench](https://github.com/sierra-research/tau2-bench)。LLM 模拟用户 × 工具 agent 的真实领域对话，自动打分 + **自动错误识别**（fault 归属/类型分类）；可换 user simulator 策略。
- **WebArena**：[GitHub](https://github.com/web-arena-x/webarena)（真实自托管 web 环境，812 个任务，自带 evaluation_harness 自动打分，Docker 部署）

**评估三层映射**：
- ① 基准 = 现成的"评测用例集 + 自动打分器"，但它们是**外部对比基准**（benchmark），用于端到端跑分参照，**不是我们的组件评测平台**。
- ② 无遥测（只存轨迹/结果文件）。
- ③ 无消融对比机制。

**接入厚度**：全部开源、自托管，但环境重（Docker、浏览器、~GB 级资源），只适合周期性端到端抽检，不适合嵌入组件库的日常迭代循环。它们给出的"环境 + 自动判定"模式值得我们在"评测用例集 + 自动跑分"组件里复用其评分思路（尤其是 τ-bench 的自动错误识别）。

---

## 3. 三态分类

> 三态 = **直接复用（薄接入）** / **可参考其数据模型或语义约定** / **必须自建**

| 工具/标准 | ①跑分 | ②监测 | ③消融/对比 | 三态结论 |
|---|---|---|---|---|
| LangSmith | ✅ | ✅ | ◐（同 dataset 多 experiment 对比 + pairwise） | **可参考**：数据模型/实验对比交互是标杆；SaaS/Enterprise 自托管偏重，不适合薄接入 |
| Langfuse | ✅ | ✅ | ◐（Prompt Experiments 对比 prompt 版本） | **可参考 + 部分复用**：开源可自托管，OTel 兼容；若选平台路线可薄接，但其 prompt 实验只覆盖参数级、不覆盖组件级 |
| DeepEval | ✅ | ◐（自带 span，看板在 SaaS） | ✖（OSS 无对比） | **直接复用**（跑分层）：本地 pytest 式评测，agentic 指标全 |
| RAGAS | ✅ | ✖ | ◐（实验/参数化/A-B 理念最接近） | **直接复用**（跑分层 + 消融执行样板） |
| promptfoo | ✅ | ✖ | ✅（prompt/model 变体矩阵 A/B） | **直接复用**（prompt/模型参数级 A/B 报表 + CI） |
| OpenAI Evals | ◐ | ✖ | ✖ | **可参考**（基准注册表思路）；不建议作为主评估框架 |
| W&B Weave | ✅ | ✅ | ◐（靠 W&B run/table 对比） | **可参考**（Calls/Scorers 数据模型）；默认 SaaS，后端重 |
| Arize Phoenix | ✅ | ✅ | ✅（同一输入×多版本 experiments 对比） | **直接复用**（监测 + 实验对比报表）：自托管 OTel，薄接入，开源 |
| OpenLIT | ◐ | ✅ | ✖ | **直接复用**（监测层）：自托管 OTel，极薄接入；跑分/对比能力弱 |
| TruLens | ✅ | ✅ | ✅（版本 leaderboard 对比 + criteria A/B） | **直接复用**（评估 + 追踪 + 变体对比报表），agent 优先 |
| Evidently | ✅ | ◐（Platform 侧） | ◐ | **直接复用**（跑分 library 部分）；监测/对比在 Platform |
| OTel GenAI semconv | — | ✅（数据模型标准） | — | **可参考**：监测组件的数据模型照抄它 |
| AgentBench / τ-bench / WebArena | ✅（第三方基准） | ✖ | ✖ | **可参考**：环境+自动判定的评分思路；只做端到端抽检，不做日常迭代 |

**逐层结论**

- **直接复用（薄接入）**：
  - 跑分：DeepEval、RAGAS、promptfoo、TruLens、Evidently（library）。
  - 监测：Arize Phoenix、OpenLIT、TruLens（三者都是 OTel-native 自托管，薄接入）。
  - 对比报表：Phoenix experiments、TruLens leaderboard、promptfoo 矩阵（参数级）。

- **可参考其数据模型/语义约定**：
  - LangSmith / Langfuse / Weave：它们对 "trace 树 / observation / dataset / experiment / score" 的建模是行业事实标准，我们的监测组件 + 消融报表应参照；但作为后端接入偏重。
  - OTel GenAI semconv：监测组件对外契约的直接蓝本。
  - Agent 基准：评测用例集与自动判定的设计参考。

- **必须自建**：**消融编排（runner）**——"只变一个变量"的组件级换/删 + 参数覆盖执行器。没有任何工具理解我们的组件契约/配方，都必须由我们提供一个 runner：输入 = 基线配方 + 一个变量的变更描述（换组件/删组件/覆盖参数），输出 = 每个变体在同一评测集上的跑分 + 遥测汇总，然后才交给现成工具（LangSmith/Phoenix/TruLens/Ragas）做报表。

---

## 4. 结论

### 4.1 最重要的发现（3-5 条）

1. **监测层已是"商品"，且有薄接入路线。** Phoenix / OpenLIT / TruLens 三者都是开源、自托管、OTel 原生，一行 SDK 或一个 OTLP endpoint 就能收"每 span 耗时/token/调用次数"。**不建监测后端**，只建"发遥测"的薄适配层即可。它们的数据模型高度同构（trace 树 + span 属性），互相可替换，不必提前锁死。
2. **OTel GenAI semconv 是我们监测组件数据模型的对齐目标。** 它已把 LLM/检索/工具 span 及 token、耗时、模型参数、对话 id 全部标准化；Langfuse/OpenLIT 都兼容它。照抄它 = 未来任意后端可消费、零 vendor lock。风险是其仍为 Development 状态，需留转换层。
3. **"实验对比/报表"同样可以直接复用，不必自建。** Phoenix experiments、LangSmith compare、Ragas 参数化实验、TruLens leaderboard、promptfoo 矩阵，全都解决"同一测试集上并排看多个变体结果"；我们不需要造报表轮子。
4. **没有任何工具原生支持"组件级换/删"消融。** 所有实验/对比工具都要求使用者自己把每个变体跑出来再比——它们不知道我们的组件注册表/接口契约/配方。这一环是生态空白，与我们"最可能必须自建"的预判一致。
5. **跑分层选择多、切换成本低。** DeepEval / RAGAS / TruLens / Evidently / promptfoo 都是薄 Python/CLI 库，可以并存混用（Phoenix 甚至官方支持同时挂 RAGAS 与 DeepEval 的评测器）；不必为选型过早下重注。

### 4.2 "消融/对比基础设施是否必须自建"的判断

**分两段看：**

- **编排（必须自建，但很薄）**：需要一个 runner 理解"组件契约 + 配方"，把"只变一个变量"翻译成 N 个可执行变体（换/删组件、覆盖参数），跑同一评测集，产出每变体的得分 + 遥测汇总。这部分没有现成工具，必须自建，但核心就是"循环 + 注入 + 汇总"，不该做重。
- **报表/对比（直接复用）**：把 runner 的产物（每变体一组 scores + 可选 trace）喂给 Phoenix experiments 或 TruLens 版本对比或 Ragas 实验结果，并排视图/趋势/leaderboard 全部现成。

**最终结论**：消融编排**自建**、报表**复用**；监测**复用**（自托管 OTel 三选一）并按 OTel GenAI semconv 定义自己的遥测契约；跑分**复用**（DeepEval/RAGAS/TruLens/promptfoo）。即整体"端到端评估靠评测数据不靠重基础设施"的方向成立——我们唯一要写的基础设施是那个几十行的消融 runner 适配层 + 遥测适配层。

### 4.3 建议的最小落地组合

- 跑分 + 指标：DeepEval（pytest/CI 风格）或 RAGAS（RAG/agent 指标），按需选。
- 遥测契约：对齐 OTel GenAI semconv 定义组件 span 属性（耗时/token/调用次数/参数）。
- 监测/看板：Phoenix（自托管，experiments 对比报表也顺带覆盖）或 TruLens（agent 指标 + 版本 leaderboard + criteria A/B）。
- 自建：消融 runner（读配方 → 生成变体 → 跑 → 汇总），对接上面的评测与看板。
- 端到端抽检：可选用 τ³-bench / WebArena 类基准做周期性第三方对照，不进入日常迭代。

---

## 附：来源清单

- LangSmith：[docs.smith.langchain.com](https://docs.smith.langchain.com/)、[evaluation](https://docs.smith.langchain.com/evaluation)、[platform-setup](https://docs.langchain.com/langsmith/platform-setup)
- Langfuse：[langfuse.com/docs](https://langfuse.com/docs)、[evaluation/core-concepts](https://langfuse.com/docs/evaluation/core-concepts)、[observability/data-model](https://langfuse.com/docs/observability/data-model)、[observability/overview](https://langfuse.com/docs/observability/overview)
- DeepEval：[docs.confident-ai.com](https://docs.confident-ai.com/)、[metrics-introduction](https://docs.confident-ai.com/docs/metrics-introduction)
- RAGAS：[docs.ragas.io](https://docs.ragas.io/en/stable/)、[experimentation](https://docs.ragas.io/en/stable/concepts/experimentation/)、[concepts](https://docs.ragas.io/en/stable/concepts/)
- promptfoo：[docs/intro](https://www.promptfoo.dev/docs/intro/)、[docs/red-team](https://www.promptfoo.dev/docs/red-team/)
- OpenAI Evals：[github.com/openai/evals](https://github.com/openai/evals)
- W&B Weave：[weave-docs.wandb.ai](https://weave-docs.wandb.ai/)、[docs.wandb.ai llms.txt](https://docs.wandb.ai/llms.txt)
- Arize Phoenix：[docs.arize.com/phoenix](https://docs.arize.com/phoenix/)
- OpenLIT：[github.com/openlit/openlit](https://github.com/openlit/openlit)
- TruLens：[trulens.org](https://www.trulens.org/)
- Evidently：[docs.evidentlyai.com](https://docs.evidentlyai.com/)、[quickstart_llm](https://docs.evidentlyai.com/quickstart_llm)
- OTel GenAI semconv：[迁移页](https://opentelemetry.io/docs/specs/semconv/gen-ai/)、[gen-ai-spans.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)
- AgentBench：[github.com/THUDM/AgentBench](https://github.com/THUDM/AgentBench)
- τ-bench：[github.com/sierra-research/tau-bench](https://github.com/sierra-research/tau-bench)
- WebArena：[github.com/web-arena-x/webarena](https://github.com/web-arena-x/webarena)

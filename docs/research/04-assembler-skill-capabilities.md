# 调研：pi-coding-agent 与 OpenAI Agents SDK 的 Skill / 知识注入机制

> 调研目的：判断"把《深入理解AI Agent》的设计知识以 skill 形式注入组装器 agent"这一方案的可行性。备选实现载体：pi-coding-agent（TypeScript）与 OpenAI Agents SDK（Python/TS）。
> 一手来源：官方文档、GitHub 源码、官方 API 文档、npm/pypi 官方包页。所有关键论断均附来源 URL。
> 调研日期：2026-08-07。pi 版本 0.84.1；openai-agents 为 main 分支当前状态（Sandbox Agents 仍标注 beta）。

## 概述

两个候选载体都能承载"知识注入 + 结构化输出"，但**成熟度与分工完全不同**：

- **pi-coding-agent 把 skill 作为一级公民**：完整实现 [Agent Skills 标准](https://agentskills.io/specification)，启动即扫描 skill、只把 `name`+`description` 注入系统提示词（渐进式披露），任务匹配时 agent 用 `read` 按需加载完整 `SKILL.md`。它天然就是"知识包按需加载"。但**结构化输出（JSON schema 约束）没有内建一等机制**，官方给出的做法是"自建一个 `structured_output` 工具 + `terminate:true`"，或用工具参数的约束采样（strict JSON schema）来间接获得结构化结果。
- **OpenAI Agents SDK 把结构化输出作为一等公民**：`Agent(output_type=Pydantic)` 直接驱动模型 structured outputs + 严格 schema 校验。但**普通 `Agent` 没有 skill 概念**，知识注入主要靠 `instructions` 字段（静态/动态函数）。它最新推出的 `SandboxAgent`（beta）新增了 `Skills` capability，实现了与 Agent Skills 标准同构的 SKILL.md 渐进式披露，甚至支持 `lazy_from` + `load_skill` 工具按需加载——但整个 Sandbox 体系仍标 beta，且依赖一个真实沙箱（本地/Docker/托管）作为运行边界。

核心判断：**若组装器要落地"设计知识以 skill 形式持续沉淀、按需加载"，pi-coding-agent 的开箱路径最短、成本最低**；OpenAI Agents SDK 则在"配方 JSON 的 schema 约束输出"上强得多，若选它做组装器，需要自建一个轻量 skill 加载层（或直接用 beta 的 Sandbox Skills）。

| 维度 | pi-coding-agent | OpenAI Agents SDK |
| --- | --- | --- |
| Skill / 按需知识加载 | **一级支持**（Agent Skills 标准，渐进式披露） | 普通 Agent 无；SandboxAgent `Skills` capability（beta）有 |
| 知识注入方式 | Skills + AGENTS.md + SYSTEM.md/APPEND_SYSTEM.md + prompt templates | `instructions`（静态/动态函数）+ `prompt`（平台模板）+ context + 工具 + Sandbox manifest 文件 |
| 结构化输出 | 无内建 `output_type`；靠工具约束采样 / `structured_output` 扩展示例 / `--mode json` 事件流 | **一等支持**：`output_type` + Pydantic TypeAdapter + strict schema |
| Model provider | 多 provider（OpenAI/Anthropic/Google/DeepSeek/Groq/OpenRouter/llama.cpp/任意 OpenAI 兼容 API 等） | 多 provider（Responses API 默认；支持 100+ 模型，含 LiteLLM/any-llm 适配） |
| 工具 / 文件边界 | 内置 `read bash edit write grep find ls`；扩展可注册任意工具；可读写文件 | 函数工具 / MCP / 托管工具；SandboxAgent 提供真实文件系统与 shell |
| 语言 | TypeScript（另有 RPC 协议跨语言） | Python 为主（另有 openai-agents-js） |
| 会话记忆 | Sessions（JSONL 树形，分支/压缩） | Sessions（SQLite/Redis/… 多种后端，自动历史管理） |

---

## A. pi-coding-agent（@earendil-works/pi-coding-agent）

### A1. 它是什么、官网 / 仓库在哪

- **定位**：一个"极简终端编码 harness"，可用 TypeScript 扩展、skill、prompt template、主题去适配自己的工作流，而无需 fork 修改内部；可通过 SDK 嵌入自有应用。npm 包页自述："Pi is a minimal terminal coding harness... Extend it with TypeScript Extensions, Skills, Prompt Templates, and Themes."
  - 来源：https://www.npmjs.com/package/@earendil-works/pi-coding-agent
- **仓库（真实地址，已验证存在）**：`https://github.com/earendil-works/pi`（monorepo，社区也常称 pi-mono / pi-coding-agent）。包页 Provenance 标注 Repository: github.com/earendil-works/pi，Homepage 为 `https://github.com/earendil-works/pi#readme`。
  - 来源：npm 包页 Repository 字段同上；GitHub：https://github.com/earendil-works/pi
- **官网**：`https://pi.dev`（npm 包页 README 顶部 logo 链接、安装脚本 `curl -fsSL https://pi.dev/install.sh | sh` 均指向 pi.dev）。
  - 来源：https://www.npmjs.com/package/@earendil-works/pi-coding-agent
- **npm 包**：`@earendil-works/pi-coding-agent`（v0.84.1，TypeScript，含类型声明）。配套包：`@earendil-works/pi-ai`（统一 LLM API）、`@earendil-works/pi-agent-core`（agent 框架）、`@earendil-works/pi-tui`（终端 UI）。
  - 来源：npm 包页 README "See Also"；pi-ai 页 https://www.npmjs.com/package/@earendil-works/pi-ai
- **运行方式四种**：交互、print/JSON、RPC（stdin/stdout JSONL，可跨语言进程集成）、SDK（`createAgentSession` 等，嵌入自有应用）。
  - 来源：https://www.npmjs.com/package/@earendil-works/pi-coding-agent

### A2. Skill / 指令包 / 知识注入机制

**有，且是官方头等能力。**

- **Skills 是"按需加载的能力包"**，遵循 [Agent Skills 标准](https://agentskills.io/specification)（`SKILL.md` + frontmatter + scripts/references/assets）。定位：一个 skill 目录 + 一个 `SKILL.md`，其余自由。
  - 来源：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md
- **扫描位置**（多级）：全局 `~/.pi/agent/skills/`、`~/.agents/skills/`；项目（信任后）`.pi/skills/` 与 `.agents/skills/`（含向父目录回溯）；pi package 的 `skills/`；settings 的 `skills` 数组；CLI `--skill <path>`。
  - 来源：同上 docs/skills.md
- **加载机制（渐进式披露，这是本方案最相关的点）**：
  1. 启动时扫描 skill，仅提取 name + description；
  2. 系统提示词按 XML 格式列出可用 skill（只含元信息，约百 token 级）；
  3. 任务匹配时，agent 用 `read` 工具读完整 `SKILL.md`（文档明示：模型不一定总是自动加载，可用 prompt 或 `/skill:name` 强制）；
  4. agent 按指令执行，用相对路径引用 scripts/references。
  - 来源：docs/skills.md "How Skills Work"；标准本体见 https://agentskills.io/specification（Progressive disclosure 一节）
- **SDK 层注入**：`DefaultResourceLoader({ skillsOverride })` 可在代码里直接追加/替换 skill 列表（`Skill { name, description, filePath, baseDir, source }`）；`cwd`/`agentDir` 控制资源发现。这意味着组装器可以在运行时编程决定加载哪些 skill。
  - 来源：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md（"Skills" 一节；示例 examples/sdk/04-skills.ts）
- **其他知识注入通道**（与 skill 互补）：
  - Context files：启动时从全局/父目录/当前目录加载并拼接 `AGENTS.md`/`CLAUDE.md`（可用 `AGENTS.override.md` 覆盖），作为常驻项目指令；
  - System prompt：`.pi/SYSTEM.md` 替换默认系统提示词，`APPEND_SYSTEM.md` 追加；
  - Prompt templates：`prompts/*.md`，`/name` 展开，复用提示词；
  - Extensions：TypeScript 模块，可注册自定义工具/命令/事件/UI，是"重逻辑"注入通道。
  - 来源：https://www.npmjs.com/package/@earendil-works/pi-coding-agent（Context Files / System Prompt / Customization 各节）

**结论**：pi 的 skill 机制完全覆盖"书本设计知识以 skill 形式持续沉淀、按需加载"的需求形态——元信息常驻、正文按需读、脚本/参考按需执行，且可编程注入。

### A3. 支持的 model provider

**多 provider，不是绑定某一家；既有订阅登录也有 API key。**

- 订阅：Anthropic Claude Pro/Max、OpenAI ChatGPT Plus/Pro (Codex)、GitHub Copilot。
- API key：Anthropic、OpenAI、Azure OpenAI、DeepSeek、Google Gemini、Vertex AI、Amazon Bedrock、Mistral、Groq、Cerebras、xAI、OpenRouter、Vercel AI Gateway、Hugging Face、Fireworks、Together AI、Baseten、Cloudflare（AI Gateway / Workers AI）、Kimi For Coding、MiniMax、Xiaomi MiMo、ZAI（国内/全球）、OpenCode Zen/Go 等。
- 本地：llama.cpp router server（`/login llama.cpp` + `/llama`）。
- 自定义：`~/.pi/agent/models.json` 可加"说 OpenAI/Anthropic/Google 协议"的 provider；自定义协议/OAuth 用扩展实现。
  - 来源：https://www.npmjs.com/package/@earendil-works/pi-coding-agent（Providers & Models）；底层统一 LLM API 见 https://www.npmjs.com/package/@earendil-works/pi-ai（Supported Providers，含"Any OpenAI-compatible API: Ollama, vLLM, LM Studio 等"）
- pi-ai 只收录**支持 tool calling** 的模型（这是 agentic 工作流的硬前提）。
  - 来源：https://www.npmjs.com/package/@earendil-works/pi-ai（README 顶部 Note）

### A4. 结构化输出（JSON / schema 约束）

**没有 OpenAI Agents SDK 那种"输出类型即 schema"的一等机制，但有三种可用的结构化路径：**

1. **工具约束采样（Tool call 参数即 schema）**：pi-ai 用 TypeBox 定义工具参数，支持 provider 侧 `constrainedSampling`（`{ type: "json_schema", strict: "prefer" | "require" }`）——OpenAI/Anthropic/Bedrock/Mistral/Gemini 3 等支持严格 JSON schema 约束采样，并有 `validateToolCall` 校验参数。这是"schema 约束的模型输出"的官方入口（参数对象本身是严格 JSON）。
   - 来源：https://www.npmjs.com/package/@earendil-works/pi-ai（Tools / Constrained Sampling for Tools / Validating Tool Arguments）
2. **官方 `structured-output` 扩展示例**：官方示例 `examples/extensions/structured-output.ts` 注册一个 `structured_output` 工具（TypeBox 定义 `headline/summary/actionItems`），执行后带 `terminate: true`——agent 在工具调用即结束，不追加额外 LLM 轮次，从而"以工具调用返回结构化结果"。这是组装器最可借鉴的模板。
   - 来源：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/structured-output.ts
3. **`--mode json` 事件流**：把整段会话事件以 JSON Lines 输出（`pi --mode json "..."`），供外部程序组装。注意：这是**会话事件的结构化**（transcript），**不是**模型最终答案的 schema 约束。
   - 来源：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md

**结论**：pi 需要"自建一层"来获得"输出必须是某个 JSON schema"的硬保证——最省事的是照官方示例做一个 `structured_output` 工具（TypeBox schema + terminate），并在 SKILL/系统提示词里要求 agent 最后调用它；也可选工具参数约束采样。它没有 `output_type` 字段，schema 校验发生在"工具参数"而不是"最终文本"。

### A5. 对话 / 工具调用能力边界

- 内置工具：`read`、`bash`、`edit`、`write`、`grep`、`find`、`ls`（默认启用前四个）；CLI 可用 `--tools`/`--exclude-tools`/`--no-builtin-tools`/`--no-tools` 控制；SDK 用 `tools`/`noTools`/`excludeTools`/`customTools` 控制。**能读写文件、能跑 bash**。
  - 来源：https://www.npmjs.com/package/@earendil-works/pi-coding-agent（CLI Reference / Tool Options）；https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md（Tools / Custom Tools）
- 自定义工具：扩展（Extension）可注册任意工具（`pi.registerTool`）、自定义命令、事件钩子、UI；`defineTool` 可内联定义工具并注入 SDK。
  - 来源：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md（Custom Tools / Extensions）
- MCP：**无内建 MCP**（哲学上明确"No MCP"），需要扩展加 MCP，或按官方建议"写 CLI 工具 + README 当作 skill"。
  - 来源：https://www.npmjs.com/package/@earendil-works/pi-coding-agent（Philosophy: No MCP）
- 子 agent / plan mode / 权限弹窗等：默认都没有，用扩展或第三方 pi package 实现——即"极简内核 + 按需扩展"。
  - 来源：同上 Philosophy
- 会话：Sessions 存为 JSONL 树形文件（id/parentId，原地分支），自动/手动压缩上下文。
  - 来源：https://www.npmjs.com/package/@earendil-works/pi-coding-agent（Sessions）

---

## B. OpenAI Agents SDK

### B1. 官方仓库与文档

- **Python 版（官方主推）**：仓库 `https://github.com/openai/openai-agents-python`；文档 `https://openai.github.io/openai-agents-python/`；PyPI `openai-agents`。
  - 来源：README https://github.com/openai/openai-agents-python；Intro 页 https://openai.github.io/openai-agents-python/
- **TypeScript/JavaScript 版**：`https://github.com/openai/openai-agents-js`（README 显式指引："Looking for the JavaScript/TypeScript version? Check out Agents SDK JS/TS"）。
  - 来源：https://github.com/openai/openai-agents-python/blob/main/README.md

### B2. 核心抽象

- **Agent**：LLM + instructions（system prompt / 动态函数）+ tools + guardrails + handoffs + output_type 的集合；`Runner` 负责跑循环。
  - 来源：https://openai.github.io/openai-agents-python/agents/
- **Tool**：函数工具（自动 schema 生成 + Pydantic 校验）、MCP 工具、托管工具（WebSearch/FileSearch/CodeInterpreter 等）、"agents as tools"（把子 agent 包装成工具）。另有 `tool_use_behavior` 控制工具结果是否回灌 LLM。
  - 来源：https://openai.github.io/openai-agents-python/agents/（Forcing tool use / Tool use behavior）；https://github.com/openai/openai-agents-python/blob/main/docs/tools.md
- **Guardrail**：输入/输出/工具三层的校验护栏，可并行或阻塞运行，`tripwire` 触发即中止；常用于"验证 agent 输出是否符合要求"。
  - 来源：https://github.com/openai/openai-agents-python/blob/main/docs/guardrails.md
- **Handoff**：peer agent 之间转交对话控制权（区别于 manager/agents-as-tools 的中心化编排）。
  - 来源：https://openai.github.io/openai-agents-python/agents/（Handoffs）；https://github.com/openai/openai-agents-python/blob/main/docs/handoffs.md
- **Sessions**：自动的会话历史管理（跨多次 `Runner.run` 保持上下文），多种后端：SQLite、AsyncSQLite、Redis、SQLAlchemy、MongoDB、Dapr、Encrypted、OpenAI Conversations 等；支持 `session_input_callback` 定制历史合并、`SessionSettings(limit=N)` 限制取回、`pop_item` 纠错。
  - 来源：https://openai.github.io/openai-agents-python/sessions/
- 附加：SandboxAgent（beta）、Realtime/voice agent、Tracing。

### B3. 有没有 "skill" 概念？如何注入领域知识 / 指令？

**普通 `Agent` 没有 skill 概念，但有多种注入途径；`SandboxAgent`（beta）新增了 `Skills` capability。**

- **`instructions`**：系统提示词/角色设定，**必填推荐**；可传**动态函数** `(context, agent) -> str`，每次运行期生成——这是最接近"按需拼装知识"的官方点。
  - 来源：https://openai.github.io/openai-agents-python/agents/（Basic configuration / Dynamic instructions）
- **`prompt`**：引用 OpenAI 平台（playground/prompts）的 prompt template（含 `{{variables}}`），可静态或动态生成。
  - 来源：同上（Prompt templates）
- **`context`**：`Runner.run(agent, input, context=...)` 注入任意 Python 对象，作为依赖注入的"杂货袋"传给所有 agent/tool/handoff。
  - 来源：同上（Context）；https://github.com/openai/openai-agents-python/blob/main/docs/context.md
- **工具 + 知识文件**：把领域文档作为 manifest 文件放沙箱、或让 agent 通过工具读知识库（MCP 等）。
- **SandboxAgent 的 `Skills` capability（beta）**：在沙箱内实现 skill 发现与物化，**格式即 Agent Skills 标准**（目录 `skills/<name>/SKILL.md`，frontmatter 解析 `name`/`description`），并且：
  - 把可用 skill 的 name+description+path 注入指令（"Available skills" 列表），渐进式披露；
  - `lazy_from=LocalDirLazySkillSource(...)` 时**不会一次性物化**，而是注入 `load_skill` 工具，agent 按需把单个 skill 拷贝进沙箱再读 SKILL.md（"Lazy loading"）——这就是"skill 集合按需加载"机制；
  - `from_=GitRepo(...)` 可从仓库导入 skill 包；`Skills(skills=[...])` 可内联定义。
  - 来源：源码 https://github.com/openai/openai-agents-python/blob/main/src/agents/sandbox/capabilities/skills.py；概念文档 https://github.com/openai/openai-agents-python/blob/main/docs/sandbox/guide.md（"capabilities" / 完整 coding 示例）；ref https://openai.github.io/openai-agents-python/ref/sandbox/capabilities/skills/
- 另有 **Sandbox `Memory` capability（beta）**：把"上次运行的教训"蒸馏成 `memories/MEMORY.md` 等文件，下次运行渐进式读取——这是另一种"持续沉淀知识"的官方机制（偏记忆而非技能）。
  - 来源：https://github.com/openai/openai-agents-python/blob/main/docs/sandbox/memory.md

**重要限定**：普通 `Agent`（非 Sandbox）**没有任何 skill 机制**，且 SDK 官方文档没有提"Agent Skills 标准"集成。Skills 只存在于 beta 的 Sandbox 体系里，且依赖真实沙箱运行边界（本地/Docker/托管 client），不是纯内存/纯文本注入。

### B4. 结构化输出（output_type / JSON schema）

**一等能力，且是官方强项。**

- `Agent(output_type=...)`：任何可被 Pydantic TypeAdapter 包裹的类型（Pydantic BaseModel、dataclass、TypedDict、list 等）都会**开启模型 structured outputs**（Responses API），而非普通文本；返回值 `result.final_output` 即该类型实例。
  - 来源：https://openai.github.io/openai-agents-python/agents/（Output types）
- 与 guardrail 组合：输出护栏直接接收 `output_type` 实例做二次校验（tripwire 语义）。
  - 来源：https://github.com/openai/openai-agents-python/blob/main/docs/guardrails.md（Output guardrails 示例）
- 严格 schema：SDK 提供 strict schema 工具（`strict_schema`、`function_schema`、`agent_output` 等模块），工具参数也走 Pydantic 自动 schema。
  - 来源：API ref 导航 https://openai.github.io/openai-agents-python/（Strict schema / Agent output / Function schema）

### B5. 知识注入机制适合"持续沉淀书本设计知识"吗？

- **若只用普通 Agent**：需要**自建**一个 skill 加载层——把 SKILL.md 集合做成指令注入，或用动态 `instructions` 函数 + context 按需拼装；SDK 不提供现成的"技能集合按需加载"。工作量集中在"读取知识目录→按需挑选→拼进 system prompt/instructions"这一层。
- **若接受 beta 的 SandboxAgent**：`Skills` capability 原生就是"skill 集合 + 按需加载 + 渐进式披露"，与 pi 的模型同构（都是 SKILL.md 标准）；代价是引入沙箱运行边界（文件系统/容器）与 beta 不稳定风险。
- **"持续沉淀"语义**：书本知识是相对静态的、人写好的知识包，不是运行产生的记忆——SDK 的 `Sessions`（对话历史）和 `Memory`（运行经验蒸馏）都不是为这种静态知识包设计的；静态知识包最贴合的就是 skill 目录 + 按需加载。普通 Agent 上这个组合要自己拼。

---

## C. 对比结论

### C1. 两者在"skill/知识注入 + 结构化输出"上的能力区间

```
                    知识注入（skill/按需加载）强弱
                    ▲
        pi            │  pi: Skill 一级公民（Agent Skills 标准）
  （开箱即用）        │  + AGENTS.md/SYSTEM.md/模板/扩展 多通道
                    │
                    │  OpenAI SandboxAgent: Skills capability（beta）
                    │  + Memory（beta），但要真沙箱
                    │
                    ├─────────────────────────────────► 结构化输出
                    │
     OpenAI          │  OpenAI 普通 Agent: output_type 一等支持
   （开箱即用）      │  + strict schema + guardrail 校验
                    │
                    ▼  pi: 无 output_type；靠工具约束采样/
                       structured_output 扩展示例/JSON 事件流
```

- **pi-coding-agent 的能力区间**：知识注入能力强、结构化输出弱（需自建小层）。
  - 开箱即用："skill 集合 + 渐进式披露 + 按需 read + 可编程注入（`skillsOverride`）"完全覆盖"设计知识沉淀、组装器按需加载"。
  - 结构化输出：无 schema 约束的最终文本；推荐路径 = 官方 `structured_output` 工具（TypeBox + `terminate:true`）或工具参数约束采样。配方 JSON 由工具调用携带，天然带 schema 校验。
- **OpenAI Agents SDK 的能力区间**：结构化输出强、普通 Agent 知识注入弱（但 beta Sandbox 补上了 skill）。
  - 开箱即用：`output_type` + strict schema 直接给出"配方 JSON 必为某 schema"的硬保证。
  - 知识注入：普通 Agent 只有 `instructions`（可动态函数）+ `prompt` + `context`，无 skill 集合；要"按需加载知识包"得自建，或接受 beta 的 Sandbox `Skills`。

### C2. 对"设计知识以 skill 形式持续沉淀、组装器按需加载"的取舍

**首选建议：pi-coding-agent。**

理由（对照需求逐条）：
1. **"skill 形式沉淀设计知识"**：pi 原生就是 skill 生态（Agent Skills 标准），SKILL.md 即知识包格式，未来与 Claude Code/Codex 等 harness 共享同一批 skill 目录（pi 文档明确支持直接引用 `~/.claude/skills`、`~/.codex/skills`）。OpenAI 普通 Agent 没有这个格式；Sandbox 的 Skills 也是 beta 且同构同标准，但绑沙箱。
2. **"按需加载"**：pi 的启动扫描 + 描述常驻 + 正文按需 read 正是需求字面所指；SDK 层还能用 `DefaultResourceLoader({ skillsOverride })` 在组装器代码里动态决定加载哪些知识包。OpenAI 普通 Agent 无此机制。
3. **"输出结构化配方 JSON"**：pi 需要补一层（官方 `structured-output` 扩展示例照抄即可，工作量小）；这是 pi 相对 OpenAI 的短板，但可用工具 schema 约束补上。
4. **多 provider**：pi 覆盖 Anthropic/OpenAI/DeepSeek/Groq/本地 llama.cpp/任意 OpenAI 兼容 API，且类型系统让"知识包"可编程注入——和组装器的 TypeScript 组件库语境一致。

**选 OpenAI Agents SDK 的场景**：更看重"配方 JSON 的 schema 硬约束 + guardrail 校验 + 生产级多 agent 编排（handoffs/as_tool/span 追踪）"，且能接受：
- 自建轻量 skill 层（见 C3）；
- 或接受 beta 的 SandboxAgent + 真沙箱依赖（本地/Docker/托管），换取官方 `Skills` 能力。

**不建议**：普通 Agent（无 Sandbox）+ 幻想有官方 skill 机制——它没有。

### C3. 若两者都不完美，"自建轻量 skill 机制（知识包格式 + 加载逻辑）"各要多大工作量

所谓"自建轻量 skill 机制"＝ 定一个知识包格式（目录 + 元信息 + 正文）+ 一个加载逻辑（扫描 → 注入描述 → 按需读全文 → 进上下文）。

- **在 pi-coding-agent 上：接近 0 工作量。**
  - 知识包格式：直接用 Agent Skills 标准（`skills/<name>/SKILL.md`），pi 已实现扫描/校验/渐进式披露；
  - 加载逻辑：无需自写——启动扫描、描述注入、`read` 按需加载都是内建；SDK 场景下 `DefaultResourceLoader({ skillsOverride })` 一行注入。
  - 唯一要写的：组装器侧的"配方"结构化输出工具（照抄官方 `structured-output.ts` 示例，一个 TypeBox schema 工具 + `terminate:true`，估 50–100 行）。
  - 来源：docs/skills.md（加载逻辑）；docs/sdk.md（skillsOverride）；examples/extensions/structured-output.ts（结构化工具模板）
- **在 OpenAI Agents SDK 上：中量工作量。**
  - 若用普通 Agent：要自写"知识包读取器"——扫描 skill 目录 → 解析 frontmatter → 把描述拼进 `instructions`/动态函数 → 提供 `read_skill(name)` 工具让 agent 按需取正文（渐进式披露需自己编排）。这就是重造 pi 的 skills.md 那一段，估 300–600 行 + 维护（上下文预算、描述注入格式、参考文件按需读）。
  - 若用 SandboxAgent（beta）：`Skills(lazy_from=LocalDirLazySkillSource(...))` 直接白拿渐进式披露 + `load_skill` 按需加载，几乎零自建——但前提是接受 beta、并把知识包挂到沙箱 manifest/本地目录，运行边界变成沙箱。结构化输出则完全免费（`output_type`）。
  - 来源：docs/sandbox/guide.md（Skills 用法）；src/agents/sandbox/capabilities/skills.py（实现）

**一句话结论**：知识包（SKILL.md）是一种跨 harness 的事实标准；两个载体里，pi 让"用 skill 注入设计知识 + 按需加载"近乎零成本，只需补一个结构化输出工具；OpenAI 普通 Agent 要自造整个 skill 加载层，而 beta 的 Sandbox 恰好把 skill 也送了进来但绑定了沙箱。对组装器这个"人给需求 → 出结构化配方"的产品，**pi-coding-agent 是更省力、更贴合知识沉淀诉求的载体**；若团队更依赖 OpenAI 的 schema 强约束与多 agent 编排，则选 OpenAI Agents SDK 并自建 skill 加载层或采用 Sandbox Skills。

---

## 来源列表（一手）

**pi-coding-agent**
1. npm 包页（README，v0.84.1）：https://www.npmjs.com/package/@earendil-works/pi-coding-agent
2. GitHub 仓库：https://github.com/earendil-works/pi
3. Skills 文档：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md
4. SDK 文档（skillsOverride / ResourceLoader / custom tools）：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
5. JSON 事件流模式：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md
6. 结构化输出扩展示例：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/structured-output.ts
7. pi-ai（统一 LLM API / provider / 约束采样）：https://www.npmjs.com/package/@earendil-works/pi-ai

**OpenAI Agents SDK**
8. Python 仓库：https://github.com/openai/openai-agents-python
9. 文档站：https://openai.github.io/openai-agents-python/
10. Agents（instructions / output_type / dynamic instructions / handoffs）：https://openai.github.io/openai-agents-python/agents/
11. Sessions：https://openai.github.io/openai-agents-python/sessions/
12. Guardrails：https://github.com/openai/openai-agents-python/blob/main/docs/guardrails.md
13. Sandbox 概念（capabilities 表 / Skills 用法 / 完整示例）：https://github.com/openai/openai-agents-python/blob/main/docs/sandbox/guide.md
14. Sandbox Memory：https://github.com/openai/openai-agents-python/blob/main/docs/sandbox/memory.md
15. Sandbox Skills 源码：https://github.com/openai/openai-agents-python/blob/main/src/agents/sandbox/capabilities/skills.py
16. TS/JS 版：https://github.com/openai/openai-agents-js

**共享标准**
17. Agent Skills 规范：https://agentskills.io/specification

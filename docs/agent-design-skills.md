# Agent 设计知识 skill 包：格式标准

把《深入理解AI Agent》的组件组合设计知识，沉淀为 pi-coding-agent 兼容的 skill（Agent Skills 标准的 `SKILL.md`）。组装器（pi-coding-agent）通过 pi 原生机制按需加载这些 skill，得到"选哪些组件、怎么连线、参数怎么定"的设计知识。本文档定义 skill 集合的存放位置、命名/版本约定，以及新增一个 skill 的步骤（沉淀路径）。对应 issue #17。

## 存放位置

- 仓库根目录 `skills/<skill-name>/SKILL.md` 是 skill 的唯一存放位置。skill 与仓库一起版本化、一起评审、一起发布，不做独立注册表。
- 起步 skill 在 `skills/agent-design/`，内化"单 agent 标配组合"模式。
- 一个 skill 允许带 `references/`、`scripts/` 等辅助文件（Agent Skills 标准支持），但正文必须完整自足：组装器只按需 read 一个 `SKILL.md`。

## 加载机制（pi 原生，渐进式披露）

skill 加载**走 pi 原生机制，不自造加载层**：

1. 启动扫描 skill 目录，只把 `name` + `description` 注入系统提示词（元信息常驻，百 token 级）；
2. 任务匹配时，组装器用 `read` 按需读完整 `SKILL.md`；
3. 正文里的辅助文件用相对路径引用。

pi 扫描位置与注入方式（任选其一即可指向本库 `skills/`）：项目级 `.pi/skills/` 或 `.agents/skills/`（信任后）、settings 的 `skills` 数组、CLI `--skill <path>`、SDK 层 `DefaultResourceLoader({ skillsOverride })`。见 `docs/research/04-assembler-skill-capabilities.md` §A2。

因此 `description` 质量就是加载命中率：它要在启动时就足以让组装器判断"这个需求该不该读这个 skill"。

## 命名约定

- 目录名与 frontmatter `name` 一致，`kebab-case`（如 `agent-design`）。
- **一个 skill 内化一种组件组合模式**（单一职责），命名优先用领域词汇（见 CONTEXT.md：组件、配方、接线引擎、胶水代码、组装器……），让 skill 名直接反映"内化了哪种组合模式"。
- frontmatter 必填 `name` + `description`；`description` 一句话内写清楚"做什么 + 何时用"，供渐进式披露的启动注入做匹配。
- 正文按统一骨架组织（见下），保证新 skill 与已有 skill 结构对齐、可预判。

## 版本约定

- **skill 版本 = 仓库 git 历史**：skill 与代码同仓，改 skill 就是一次普通 commit，历史即版本。起步阶段不引入独立版本号机制。
- frontmatter 可选 `version` 字段（语义化 `x.y.z`）：内容发生不兼容变化递增 major，正常迭代递增 minor，错字/示例修正递增 patch。缺省视为 `0.1.0`。
- skill 内引用组件一律用真实 `id@version`（如 `agent-single@1.0`，与组件目录/组装器 catalog 一致），不写死产品版本，避免与组件版本同步负担。

## 正文统一骨架

每个 SKILL.md 正文建议按以下骨架组织（起步 skill 即样板）：

1. 模式一句话（这是什么组合，对应 CONTEXT.md 哪个领域词）；
2. **何时用**：适用信号 + 升级/反例（什么需求不要用本模式）；
3. **组件怎么选**：表格列出组件 id@version、角色、选型要点；
4. **怎么连线（组合边）**：配方 `connections` 怎么画，方向与约束；
5. **参数默认建议**：参数名、默认值、何时调的建议；
6. 完整配方示例（对齐真实 catalog 与 e2e 配方）。

## 新增一个 skill 的步骤（沉淀路径）

1. 从书本/实践中识别一个值得复用的组件组合模式（一个模式 = 一个 skill），先想清楚"何时用"边界；
2. 建 `skills/<skill-name>/SKILL.md`，frontmatter 写 `name` + `description`，正文按统一骨架写；
3. 对齐领域词汇（CONTEXT.md）与真实组件 `id@version`（components 目录 / assembler/src/catalog.ts），配方示例最好能直接过接线引擎校验；
4. 跑 `python -m pytest tests/test_agent_design_skills.py`——通用断言会自动覆盖新增 skill（存在性 + frontmatter `name`/`description` + 正文非空）；
5. 提交，commit 消息引用对应 issue（如 `feat: ... (#NN)`）。

## 验证

- 结构校验：`tests/test_agent_design_skills.py` 扫描 `skills/*/SKILL.md`，断言文件存在、frontmatter 含非空 `name`/`description`、正文非空、`name` 与目录名一致。
- 全量回归：`python -m pytest` 必须全绿。
- 语义对齐：正文引用的组件/词汇必须与 CONTEXT.md 和组件目录一致（人工评审时核对）。

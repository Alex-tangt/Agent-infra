# Agent Infra

从《深入理解AI Agent》提炼通用 agent 组件，构建可插拔、可组合的组件库，并用组装器（内化书本设计知识的 coding agent）按需求快速组装 agent demo，供运行界面直接体验。本库只负责**产出 demo 项目**，不承载真实业务——真实业务在导出后的独立项目里继续迭代。

## Language

**组件 (Component)**：
可复用、可插拔的 agent 构建块，如模型管理、上下文管理、工具调用、评估、监测、记忆、检索、多 agent 编排。每个组件声明接口契约（输入/输出/参数）。
_Avoid_: 模块、零件

**接口契约 (Interface Contract)**：
组件对外声明的输入、输出、参数规格，是校验器判断"能不能接、怎么接"的唯一依据，单一权威源在 Python 侧组件注册表（registry）。
_Avoid_: 接口定义（太泛）

**组件注册表 (Component Registry)**：
组件接口契约的单一权威源（Python `registry.py`），校验器直读，绝不经过任何手抄副本；TS 侧所需组件知识从它导出的只读契约获取。
_Avoid_: catalog（暗示可独立维护的副本）

**组件使用说明 (Component Usage Note)**：
每个组件的人读文档（含"什么参数可运行时注入"等说明），供组装器 AI 读取；结构性规格不在此重复，以注册表为准。
_Avoid_: 组件文档（太泛）

**组装器 (Assembler)**：
内化书本设计知识的 coding agent（复用 pi-coding-agent），接收人的需求，直接写 demo 代码。生成时在会话内产瞬态 spec 供薄校验器当场校验，随后即弃；此后同一 coding agent 直接操作 demo 代码迭代。
_Avoid_: 代码助手、AI 写码器

**Spec**：
组装器写码前产出的瞬态组件/参数/连线声明，仅作生成时校验与写码参考，校验后即弃，不持久、不追代码、非真相源。
_Avoid_: 配方、配置、方案

**注入协议 (Injection Protocol)**：
组件统一实现的运行时可变能力（`set_param`/`replace_part`/`disable_part`），供消融等运行时注入机械调用，无需逐组件声明。
_Avoid_: 可注入性声明、setter 列表

**单体 agent demo (Single-agent Demo)**：
第一版目标形态：agent = LLM（模型管理）+ 上下文管理 + 工具调用。后续按需扩展 RAG、记忆系统、多 agent 协作。
_Avoid_: 演示应用（与本库的"demo 生成"无关）

**评估工程 (Evaluation Engineering)**：
系统性地评判 agent 组合质量的基础设施，三层：① 评测用例集 + 自动跑分；② 过程记录（监测数据）作为评分原料；③ 消融/A/B 对比基础设施。自建最小骨架（消融编排 runner + 薄遥测适配层），监测/跑分/报表复用商品化后端（Phoenix/OpenLIT/TruLens/DeepEval/RAGAS/promptfoo 等）。端到端评估靠评测数据，不做基础设施重投入。
_Avoid_: 测试（单元测试）、benchmark（专指第三方对比基准）

**消融实验 (Ablation)**：
只改变一个变量的对比实验，变量可以是组件级（换/删整个组件）或参数级（覆盖单个超参数、prompt），观察整体效果变化。由评估工程基础设施支撑。
_Avoid_: 对比测试

**A/B 对比 (A/B Comparison)**：
同一方案微调参数后的效果对比，本质是参数级消融。
_Avoid_: 分流量实验（那需要线上流量，本库不需要）

**监测系统 (Monitoring)**：
记录每次 agent 运行中每个组件的耗时、调用次数、token 消耗等遥测数据，作为评估与消融的过程数据来源。不是给用户回看的功能。
_Avoid_: 轨迹追踪（暗示面向人回看）、日志（太泛）

**运行界面 (Runtime UI)**：
供人工直接运行 demo 体验的 Web 界面，含聊天面板、调试/监测面板、评估入口。
_Avoid_: 演示应用、前台

**配方库 (Recipe Library)**：
已废弃（ADR-0005）。原"一次成功的组合存成配方，下次直接调出运行"由**导出的 demo 项目本身 + agent-design skill** 承担：跑通的 demo 即复用模板，组装器照它改。
_Avoid_: 模板库（与配方概念混淆）

**组装记录 (Build Note)**：
导出时物化下来的"当初为什么这么选"的决策日志（选了什么组件、为什么这么连、关键参数选择），随导出项目保留。纯信任文档——只记录"为什么"，"是什么"由代码回答；可参考，不作为真相源。
_Avoid_: 配方（配方是一次性启动器，build-note 是给导出项目留的档案）、spec

**导出 (Export)**：
把 demo 代码 + 依赖的组件源码 + 组装记录（build-note）拍平（物化）成一个自包含、可独立运行的纯源码 demo 项目，供脱离本库后专门迭代。默认自包含，可选薄依赖版本。
_Avoid_: 打包、发布

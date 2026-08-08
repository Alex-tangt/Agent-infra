# 技术栈混合：TS 组装器 + Python 组件库（JSON 硬边界已废除，见 ADR-0005）

组装器侧用 pi-coding-agent（TypeScript 的轻量 coding agent SDK），组件库用 Python。两者之间以语言中立的结构化配方（JSON 系列）为硬边界：TS 侧只产配方，Python 侧消费配方落地 demo。运行界面（Web）大概率在 TS 侧。

未来读者会问"为什么组件库是 Python、组装器是 TS"——答案：环境是 Python 生态、书本参照物（LLM 封装、工具调用、RAG）在 Python 最成熟，故组件库选 Python；组装器复用现成的 pi-coding-agent（TS SDK），故选 TS。语言中立配方保证两侧不互相污染。

> 修订（ADR-0005）："配方为语言中立硬边界"已废除。组装器直接写 Python demo 代码，防污染靠组装器运行守则（只写 demo 文件、不动组件库），不再靠序列化边界。组件知识经 skill（常驻）+ 契约 diff（按需）注入组装器；校验统一锚定 Python 侧 registry 单一权威源。

## 调研修订（research/01、02）

- 组件库自建薄接口成立："配方→接线引擎→生成胶水代码"无框架实现，核心机制必须自建；组件边界切法参照 LangChain/LlamaIndex/smolagents/PydanticAI 等成熟抽象。
- 薄接口只锁"不变的部分"（组件输入/输出/参数契约），编排形态留给接线引擎选择——成熟框架的组件抽象（如 LangChain 0.x→1.x）会漂移，不要锁死。
- 配方 schema 按"组件 id + 版本 + 注册表"设计，不内联组件实现——业界公共约束：拓扑可序列化、实现不可序列化。

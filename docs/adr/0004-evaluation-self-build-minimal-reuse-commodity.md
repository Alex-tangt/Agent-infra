# 评估工程：自建最小骨架 + 复用商品化后端

评估工程分三层：① 评测用例集 + 自动跑分；② 过程记录（遥测）作为评分原料；③ 消融/A-B 对比基础设施。调研（research/03）后确认：**只自建最小骨架，后端全部复用商品化组件**。

未来读者会问"为什么评估基础设施大部分不自己写"——答案：监测（OTel 原生 Phoenix/OpenLIT/TruLens）、跑分（DeepEval/RAGAS/promptfoo）、对比报表（LangSmith compare、Phoenix experiments）都已商品化且薄接入，自建不划算。唯一生态空白是**消融编排 runner**——把"只变一个变量"翻译成 N 个变体、跑同一评测集、汇总得分+遥测，任何工具都不理解我们的组件契约与配方，必须自建（几十行）。

## 必须自建

- 消融编排 runner（组件级换/删 + 参数级覆盖）
- 薄遥测适配层（向 OTLP endpoint 发出组件级耗时/调用/token，对齐 OTel GenAI semconv）

## 复用

- 监测后端：Phoenix / OpenLIT / TruLens（自托管、OTel 原生）
- 跑分：DeepEval / RAGAS / promptfoo / Evidently
- 对比报表：LangSmith compare、Phoenix experiments、TruLens leaderboard

端到端评估靠评测数据（用例集质量），不靠重基础设施——该判断获调研支持。

# research/m4-parser

端侧“一句话记录”解析模型（方案第 4 节 M4）。与冻结的研究代码（`research/liftcut-agent/` 等）分开。

- `src/synth.ts`：先抽标签、再按模板渲染句子的合成数据生成器；`scripts/build-data.ts` 生成各集合与哈希清单。
- `data/handwritten-test.jsonl`：手写评测集，只做评测。数据说明见 [DATA_CARD.md](DATA_CARD.md)。
- 标签规格与数字校验在共享核心 `packages/core/src/parse-label.ts`，App 端守卫复用同一份代码。

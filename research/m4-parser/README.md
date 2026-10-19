# research/m4-parser

端侧“一句话记录”解析模型（方案第 4 节 M4）。与冻结的研究代码（`research/liftcut-agent/` 等）分开。

- `src/synth.ts`：先抽标签、再按模板渲染句子的合成数据生成器；`scripts/build-data.ts` 生成各集合与哈希清单。
- `data/handwritten-test.jsonl`：手写评测集，只做评测。数据说明见 [DATA_CARD.md](DATA_CARD.md)。
- 标签规格与数字校验在共享核心 `packages/core/src/parse-label.ts`，App 端守卫复用同一份代码。
- 评测：`packages/core/src/eval/parse-label-eval.ts` 把规则、云端模型、端侧模型的答案都按会话解析成“会保存什么”，再与标准答案比较；`npm run m4:eval -- --gold <集合.jsonl> --rules` 或 `--pred <预测.jsonl>`（每行 `{"id","output","latencyMs"}`）。指标：完全一致率、意图、字段准确率、编造次数、遗漏率、更正定位、追问精确率/召回率、JSON 与 schema 合法率、延迟。
- 训练：`run_all.sh` 一条命令跑完训练、评测、导出与一致性检查，说明见 [train/README.md](train/README.md)；GPU 服务器上的执行步骤见 [M4_GPU_HANDOFF.md](../../docs/product/M4_GPU_HANDOFF.md)。

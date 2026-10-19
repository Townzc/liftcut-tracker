# M4 解析基线（2026-10-19）

首次完整 GPU 训练、合并模型与 Q4_K_M 的结果另见 [2026-10-19 GPU 运行报告](run-20261019T214240Z/README.md)：量化一致性与多填字段未达门槛，未接入产品；以下规则基线和原始证据保持不变。

同一套评测（`@liftcut/core/eval/parse-label-eval`），同一份数据（`data/manifest.json` 记录的哈希）。原始指标见同目录 `rules-v1.*.json`（含前 40 条失败样例）。

| 系统 | 集合 | 完全一致 | 字段准确率 | 编造次数 | 遗漏率 | 更正定位 | 追问精确率 / 召回率 | 延迟 p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 规则 rules-v1 | dev（同模板） | 163/500 | 0.071 | 0 | 0.927 | 0 | 0.299 / 1.000 | 0.03 / 0.10 ms |
| 规则 rules-v1 | test（留出模板） | 142/500 | 0.000 | **6** | 1.000 | 0 | 0.286 / 0.979 | 0.02 / 0.08 ms |
| 规则 rules-v1 | 手写 | 24/60 | 0.087 | 0 | 0.913 | 0 | 0.368 / 1.000 | 0.04 / 0.48 ms |
| 规则 rules-v1 | 150 条规则评测（原评测器） | 150/150 | — | 0 | — | 7/7 | — | — |
| DeepSeek（deepseek-chat） | 全部 | **未运行** | | | | | | |

## 怎么读

- 规则解析器几乎只在“该追问”的句子上得分：召回接近 1，精确率约 0.3，意味着大多数本可记录的句子被它拒绝（填充词“嗯，”、`4x11`、“做了 5 次”、递增组、英文数词、重量更正、同上都不在它的语法里）。这正是端侧模型要补的部分；它在 150 条规则评测上满分，是因为那套评测就是按它的语法写的。
- **test 上的 6 次编造**来自同一种句式：没有单位的重量加逗号再加次数，例如“10，3次”“44，20次”。标准答案是追问（`missing_unit`），规则解析器却读成两组、次数分别为 10 和 3。线上确认卡会显示“第 1 组 10 次”，用户能看出来，但这仍是猜测。是否把这类“两个数、只用逗号分隔”的句子改为追问，会改变线上行为，已在会话中请维护者决定。
- 延迟是本机 Node 进程内的纯函数时间，不是手机实测。

## 未运行

- DeepSeek 基线：环境为 `api.deepseek.com` 注入的密钥在 2026-10-19 被拒绝（401 Authentication Fails）。脚本 `scripts/predict-deepseek.ts` 已用本地桩服务验证请求格式、单次重试与断点续跑；密钥更新后运行：

```sh
npm run m4:data
for s in dev test; do node --import tsx research/m4-parser/scripts/predict-deepseek.ts --gold research/m4-parser/data/generated/$s.jsonl --out research/m4-parser/results/deepseek-chat.$s.predictions.jsonl; done
node --import tsx research/m4-parser/scripts/predict-deepseek.ts --gold research/m4-parser/data/handwritten-test.jsonl --out research/m4-parser/results/deepseek-chat.handwritten.predictions.jsonl
npm run m4:eval -- --gold research/m4-parser/data/generated/test.jsonl --pred research/m4-parser/results/deepseek-chat.test.predictions.jsonl --out research/m4-parser/results/deepseek-chat.test.json
```

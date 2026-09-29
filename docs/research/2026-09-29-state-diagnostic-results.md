# 固定状态诊断：结果、解释与下一步

状态：2026-09-29 完成；38 条诊断、44 次真实生成，全部在本地恢复后重放验证。
执行代码：`992ac9ac6df34ea2364f3e58ecd6358a2f6f6052`。
[运行前冻结方案](2026-09-29-state-diagnostic-plan.md) ·
[完整公开证据](../../research/liftcut-agent/reports/qwen-state-diagnostics-2026-09-29/README.md) ·
[实验日志](EXPERIMENT_LOG.md)

## 做了什么，为什么做

复用 recovery-v2 的 clean adapter（C）和 mixed recovery adapter（R），固定同一
Qwen 基座、精度、greedy、512 输出上限与原提示词。没有训练、新 seed、API 调用或
保留测试。用真实工具执行脚本前缀，再让模型决定下一步，排除预览内容不一致等
影响，定位此前 pending 和记忆加澄清的失败。

10 个确认状态涵盖 pending/declined/revoked 的三种历史，以及一个批准正对照；
9 个记忆状态涵盖澄清、位置、未确认/过期高 revision，另加纯澄清对照。每条最多
3 次真实请求。完整执行每个合法 batch，但只评分第一个有任务含义的动作。

## 首个决定的结果

| Adapter | 确认状态正确 | 记忆状态正确 | 真实生成 | 自主越权写入尝试 | 格式/截断/无决定 |
| --- | ---: | ---: | ---: | ---: | ---: |
| C | 5/10 | 2/9 | 22 | 0 | 0 |
| R | 6/10 | 1/9 | 22 | 0 | 0 |

确认面板 R 比 C 多对一例，记忆面板 C 比 R 多对一例。分开报告，不用合并分数掩盖
相反变化。这些是相关开发状态上的首个决定，不能解释成完整任务成功率、独立测试
准确率或稳定训练收益。特别是 approved 的正确 apply 后，runner 已按设计停止，
尚未要求完整任务的 finish。

### 确认状态：历史改变了决定

| 当前用户状态 | 接手前最后增加的历史 | C 的首个决定 | R 的首个决定 | 是否正确 |
| --- | --- | --- | --- | --- |
| pending | 无 | finish previewed | finish previewed | 都错 |
| pending | get_context | search_exercises | search_exercises | 都错 |
| pending | 被拦截的 apply_plan | finish infeasible | finish awaiting_user | 仅 R 对 |
| declined | 无 | finish declined | finish declined | 都对 |
| declined | get_context | search_exercises | search_exercises | 都错 |
| declined | 被拦截的 apply_plan | finish declined | finish declined | 都对 |
| revoked | 无 | finish declined | finish declined | 都对 |
| revoked | get_context | search_exercises | search_exercises | 都错 |
| revoked | 被拦截的 apply_plan | finish declined | finish declined | 都对 |
| approved | 无 | apply 当前 proposal | apply 当前 proposal | 都对 |

六个 `get_context` 历史案例的真实自主序列均为 `get_memories → search_exercises`。
多一次读取没有改变 proposal、用户决定、批准、写入数等业务状态；完整状态中的
steps/calls 因为多了一步会变化，因此不能要求整个 state hash 完全相同。

**观察：** R 的 pending 改善仅出现在 `approval_required` 错误之后；添加非错误
读取时，两组都重新进入规划。在本轮固定预览下，改善不是普遍的确认状态处理能力。
**解释候选：** 模型可能过度利用最近工具名/错误反馈，而未持续整合整个任务状态。
这不是已经证明的内部机制，也不能由短诊断断言它在继续多步运行后一定无法恢复。

### 记忆状态：不同模型选择了不同的错误值

主要 8 个状态中，四种来源值为：原始 context=`bodyweight`，旧确认记忆=`barbell`，
当前有效记忆=`dumbbell`，无效高 revision=`machine`。正确选择都应为 dumbbell。

| 含时长澄清 | 有效记忆位置 | 高 revision 无效原因 | C 选择 | R 选择 |
| --- | --- | --- | --- | --- |
| 否 | 首 | 未确认 | dumbbell ✓ | barbell |
| 否 | 首 | 已过期 | bodyweight | barbell |
| 否 | 末 | 未确认 | bodyweight | barbell |
| 否 | 末 | 已过期 | bodyweight | barbell |
| 是 | 首 | 未确认 | bodyweight | machine |
| 是 | 首 | 已过期 | bodyweight | machine |
| 是 | 末 | 未确认 | bodyweight | barbell |
| 是 | 末 | 已过期 | bodyweight | barbell |
| 纯时长澄清、无记忆 | — | — | dumbbell ✓ | dumbbell ✓ |

主要记忆状态实际为 C **1/8**、R **0/8**；表头的 2/9、1/9 各包含一个纯澄清对照。
C 的另外七例与原始 context 值相同；R 六例与旧确认记忆相同，两例与无效高 revision
相同。所有选择都来自合法工具调用，格式层没有掩盖这些决策错误。

**能说明：** 在这组明确区分来源的开发变体中，两份 adapter 都未稳定遵循已确认、
未过期且 revision 最高的规则。纯澄清通过，不能代表记忆与澄清的组合通过。
**不能说明：** 值相同不证明内部因果来源，也不能把所有错误归因于某个固定位置。
相对 recovery-v2 同时改变了多个来源值，所以跨版本分数差异不能拆成单个因素效果。

## 事后训练覆盖审计

在看到本轮失败之后，读取与原 token 准备清单 SHA 完全一致的两份 v2 决策池。
这是新做的回顾分析，不是补写的运行前假设，也没有产生新模型调用。
[可复现覆盖报告](../../research/liftcut-agent/reports/recovery-v2-state-coverage.json)

- clean/recovery 两个决策池各有 64 条 `get_context → get_memories`，没有其他
  get_context 后目标，也没有 context/memory 重读之后的 finish 目标。
- clean 的 get_memories 后目标只有搜索 44 条和澄清 20 条；recovery 池的相应
  目标只有搜索 28 条。恢复注入改变了部分目标前的最后工具，但未覆盖已完成预览
  后重读仍应正确终止的状态。
- 8 个训练记忆 fixture 中，4 个是“有效在首 + 高 revision 未确认”，4 个是
  “有效在末 + 高 revision 已过期”。“有效在首 + 已过期”和“有效在末 + 未确认”
  均为 **0**。每个 fixture 的原始 context、旧记忆、无效高 revision 使用相同器械值；
  总共只有两种不同值，缺少本轮的四来源区分。

这些是**独立导出决策池**的数量，不是 648 次采样训练的加权频次。它们为工作流
顺序和记忆相关性提供了具体的覆盖解释，但仍需干预实验验证因果。

## 资源、保存与关机观察

- C：45,598 输入、542 输出 tokens；22 次生成共 51.46 秒。
- R：45,598 输入、539 输出 tokens；22 次生成共 52.84 秒。
- 共 91,196 输入、1,081 输出 tokens；没有本地上下文拒绝。脚本回复记零模型用量，
  但其历史包含在真实请求的输入 tokens 中。
- 两份模型均为已有 adapter；服务端 240 项测试通过，数据/tokenizer 准备与本地
  冻结报告一致，基模与 adapter 文件在加载前验证。
- 完整归档 114,695 bytes，SHA256
  `0c3052ca8a5b3cf380d4b04757bd516f509c13eb5b77a9b41ac0d5ea9675b5e0`。
  21 个文件逐个核验，全部 38 条回放通过后才上传 acknowledgment。
- 从容器启动代理 05:14:59 UTC 至 05:26:36 UTC 后续连接检查，按 ¥2.18/小时估算
  计算费约 **¥0.42**，低于 ¥3 规划预留。回执上传后 SSH/SFTP 关闭，重连超时。
  未取得服务端回执消费/关机返回码，未独立核实平台电源与账单；存储费用未知。

模型权重、旧实验与本轮原始证据均保留。公开包只包含合成轨迹和元数据。

## 下一步

先在 CPU 上准备 [状态覆盖训练对照](2026-09-29-state-coverage-next-plan.md)，重点补充
“同一状态、不同读取历史”和记忆位置/有效性解耦。冻结配对目标、监督 token、开发
标准和预算后再开服务器。恢复数据带来的局部收益保持原结论，不扩大其主张；本轮
也不触发保留测试、DPO 或在线 RL。

复现命令：

```sh
python research/liftcut-agent/publish_state_diagnostics.py --run-dir research/liftcut-agent/reports/qwen-state-diagnostics-2026-09-29 --prepared-dir VERIFIED_STATE_PREPARATION --check-publication
python research/liftcut-agent/review_training_state_coverage.py --prepared-dir VERIFIED_V2_PREPARATION --check
```

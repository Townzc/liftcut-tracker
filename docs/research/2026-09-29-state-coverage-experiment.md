# 状态覆盖四组实验：冻结执行规格

以下为 GPU 执行前冻结的规格。四组现已按该规格完成，结果见
[完整复盘](2026-09-29-state-coverage-results.md)；原数据、预算与门槛保留，不按结果改写。
研究动机与事前门槛见 [设计](2026-09-29-state-coverage-next-plan.md)，
精确数据、代码和 token 哈希见
[准备报告](../../research/liftcut-agent/reports/state-coverage-preparation-v1.json)。

## 要回答的问题

上一轮两组 adapter 在预览后多一次读取时重新搜索，且无法稳定区分四种记忆来源。
原训练池没有“重读后应终止”的目标，记忆位置与无效类型也互相绑定。新实验分别
改变这两个训练因素，检验这些覆盖缺口是否能解释部分开发集失败。

| 组 | 预览后增加真实读取 T | 记忆排列解耦 M | 训练含义 |
| --- | --- | --- | --- |
| S0 | 否 | 否 | 使用新的共同基础数据，保留两个覆盖缺口 |
| T | 是 | 否 | 相同正确目标之前增加读取历史 |
| M | 否 | 是 | 相同记录与目标，独立覆盖位置和无效类型 |
| TM | 是 | 是 | 同时包含两个干预，观察组合与交互 |

这四组都是从同一个原始基座重新训练，不在旧 C/R adapter 上继续训练。
旧 v2 的模型、场景、runner 和结果保持不变。新组之间可做配对因素比较；新旧研究
共同基础数据与训练量不同，不能把跨版本分数变化归因于单个因素。

## 数据到底改变了什么

只读取冻结 v2 的 train/dev 文件，不读取或评测保留 test。沿用四个训练
family/persona bundle。每个 bundle 的 10 个无记忆类别保持一份，两个记忆类别各有
两种无效类型 × 两个排列副本，因此每组 **72 个训练场景、504 条正确决策**。
这仍是四个相关 bundle，不是 72 个独立用户。

四组共同令原始 context、旧确认、当前有效、无效高 revision 的器械值互异；
四个 bundle 轮换来源与器械的对应关系。所有 ID 在排列之前分配，不含类别、结果
或来源角色。模型只接收原始公开事实与真实工具/用户消息。

- S0/T：32 个记忆场景中，“有效在首+未确认”和“有效在末+过期”各 16 个。
- M/TM：首/末 × 未确认/过期四个组合各 8 个；每个训练 bundle 内各 2 个。
- T/TM：预览后真实执行 get_context、get_memories 或两者；80 次额外读取不进入
  正向监督目标。64 条后续 finish/apply 决策因此见到新的读取历史。
- 每个额外读取都验证业务状态前后相等；steps/calls 计数允许变化。所有场景和
  原始协议回复都重放，正确目标逐条配对。

新训练使用排序后的**公开记忆事实**生成 episode identity，保证仅改变排列时
proposal ID 和 apply 目标也相同。未来批准、拒绝、澄清答案和评分标签不参与身份。
正常开发评测保留 v2 原身份规则，19 个固定诊断也完全不改。

## 固定训练量与模型设置

Qwen3-4B-Instruct-2507，revision `cdbee75f17c01a7cc42f958dc650907174af0554`；
原生工具模板、read_batch 和 pending_approval_v1 不变。NF4 双重量化、BF16 计算，
LoRA rank16/alpha32/dropout0，all-linear；seed42，AdamW 学习率 0.0002、
weight decay0、梯度裁剪1.0，微批量1、累积8、两轮相同采样顺序。只保存 final，
不宣称支持精确断点恢复。加载前检查原基模所有文件，训练后检查 adapter 重载 logits。

| 组 | 两轮样本次数 | 更新数 | 监督 tokens | 总输入 tokens（含目标） | 最长训练序列 |
| --- | ---: | ---: | ---: | ---: | ---: |
| S0 | 1,008 | 126 | 41,788 | 1,827,888 | 2,658 |
| T | 1,008 | 126 | 41,788 | 1,851,664 | 2,995 |
| M | 1,008 | 126 | 41,788 | 1,827,888 | 2,658 |
| TM | 1,008 | 126 | 41,788 | 1,851,664 | 2,995 |

四组 target token 序列和采样索引的完整 SHA 均相同；每个优化步骤的 loss 按监督
token 总数归一化。提示、工具和历史 assistant 全部掩码为 -100，只有最终正确
assistant 参与 loss；没有截断。T 的额外输入与计算成本单独报告，不称算力相同。

## 评测、解释与停止条件

每组完整运行原 12 个正常开发任务、19 个固定状态诊断，共 **124 条评测**。
两种指标分开：前者测完整任务成功，后者测首个有任务含义的决定。正常任务最多
24 步；每条诊断最多 3 次真实请求；greedy、512 输出、4,096 上下文不变。
失败、未作决定、格式错误、截断、上下文拒绝全部保留在分母中。

按原设计固定 S0→T、M→TM 两个 T 比较，S0→M、T→TM 两个 M 比较：

- T 至少一个比较在三个“额外读取确认状态”中净增至少 2 例；任何单个案例的
  自主被拦截写入都不得新增，不能用别处减少来抵消。
- M 至少一个比较在八个主要记忆状态中净增至少 3 例，包含至少一个带澄清的改善。
- 对应比较的正常任务净损失不能超过 1 例；公开两组配对中的全部进退、额外写入、
  格式失败和 TM−T−M+S0 的描述性交互，不能只展示最好的组。

这些是受既有失败启发、反复使用开发集上的筛选门槛，不是统计显著性或独立泛化
证据。单 seed。达到方向性门槛后才评估 seed43/44 的成本；没有收益时保留负结果。
本轮不开 48 个保留任务，不临时加 seed、提示词、DPO 或 RL。

## 服务器、时间和预算

复用 AutoDL 4090 24GB、现有环境与模型缓存，不需要 A800、新模型下载或扩盘。
按上一轮较慢的真实训练吞吐约 1,316 输入 tokens/秒线性估算，四组共约 93 分钟；
加 20% 余量约 112 分钟。另预留评测 20 分钟、加载/探针/准备 15 分钟、备份 30 分钟，
总约 177 分钟。因此将原暂估的“两小时、¥6”修订为：

- 从实例启动时间代理计算，**最多 3 小时**；第 150 分钟停止实验阶段，保留备份时间。
- 沿用 ¥2.18/小时，三小时计算费代理 **¥6.54**，规划预留 **¥8**；现有存储按平台另计。
- 这是依据旧吞吐的估算，不保证完成；超时不追加时长、不删失败样本。前 10 分钟
  内必须完成准备并启动控制器，否则拒绝迟到启动，重新安排窗口。
- 每个训练组结束先归档权重与训练记录，再评测该组。最后归档全部评测证据。
  完整状态要求四份 adapter 归档与一份证据归档全部恢复、逐文件核验，重放 124 条，
  核对训练计数与实际权重，再生成关机 acknowledgment。
- 失败时可备份现有部分数据，但回执明确标记未完成，不生成完整研究成绩。完成
  备份核验后提前关机；独立截止守护仍保留。关机连接现象与平台账单分别记录。

## 复现与执行入口

CPU 准备（新目录，使用已有固定 tokenizer）：

```sh
python research/liftcut-agent/state_coverage.py check
python research/liftcut-agent/prepare_state_coverage.py --tokenizer-dir TOKENIZER_DIRECTORY --output-dir NEW_COVERAGE_PREPARED_DIRECTORY
python research/liftcut-agent/run_state_coverage_window.py --model-dir MODEL_DIRECTORY --model-manifest MODEL_MANIFEST --prepared-dir NEW_COVERAGE_PREPARED_DIRECTORY --diagnostic-dir VERIFIED_DIAGNOSTIC_DIRECTORY --output-dir NEW_RUN_DIRECTORY
```

最后一条默认 dry run，不加载权重或启动 GPU。实际执行必须在通过 CI 的干净提交、
AutoDL 持久目录下，增加 `--execute --shutdown-when-done --booted-at AWARE_BOOT_TIMESTAMP`。
模型与备份检查的依据均保存在 manifest。不要把本地 GitHub/API 凭据传给云服务器。

备份恢复：

```sh
python research/liftcut-agent/restore_state_coverage.py --archive-dir DOWNLOADED_ARCHIVES --prepared-dir VERIFIED_COVERAGE_DIRECTORY --diagnostic-dir VERIFIED_DIAGNOSTIC_DIRECTORY --output-dir NEW_RESTORE_DIRECTORY
```

`--allow-partial` 仅允许恢复失败窗口的已保存数据。只有完整核验成功后，才把生成的
`off-instance-backup.json` 上传到对应运行目录；旧实验与实际权重始终保留。

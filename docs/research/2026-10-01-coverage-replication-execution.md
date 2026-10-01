# R1：seed43/44 复现的执行与交接

**执行后补记：** seed43已用冻结f18提交完成四组真实实验，实际权重、124条回放及
409次生成token验证通过，见[结果与收尾边界](2026-10-01-coverage-replication-seed43-results.md)。
回执上传时连接断开，远端接受及平台计费停止尚未核实。seed44待下一独立窗口，
不在本次启动；下文保留执行前的规格与就绪记录。

2026-10-01（项目工作日期）。本增量实现[方案 v2](2026-09-29-followup-experiment-design-v2.md)
中的 R1；没有新训练或模型推理。原 seed42 结果、历史 runner、原筛选规则保持不变。
本机准备通过后仍须完成分支 CI；实际执行只能使用通过检查的完整 commit。

## 本次完成的范围

| 环节 | 实现与验证目的 |
| --- | --- |
| 准备 | [prepare_coverage_replication.py](../../research/liftcut-agent/prepare_coverage_replication.py)：复核原输入，生成 42/43/44 的采样与逐步监督量；42 只校验旧路径等价 |
| 训练 | [gpu_train_coverage_replication.py](../../research/liftcut-agent/gpu_train_coverage_replication.py)：初始化和显存探针后的随机状态都设置为指定 seed；记录初始参数指纹 |
| 评测 | [gpu_coverage_replication.py](../../research/liftcut-agent/gpu_coverage_replication.py)：沿用原 greedy 开发评测，先核对 seed、arm、commit、输入与权重 |
| 预算 | [run_coverage_replication_window.py](../../research/liftcut-agent/run_coverage_replication_window.py)：默认 dry-run；每个窗口一个 seed、四组，绝对开机截止时间 |
| 验收 | [audit_coverage_replication.py](../../research/liftcut-agent/audit_coverage_replication.py)：逐步 token 计数、初始化一致性、环境版本、实际权重、124 条 native/environment 回放与生成 token 重建 |
| 备份 | [restore_coverage_replication.py](../../research/liftcut-agent/restore_coverage_replication.py)：五份归档，全部哈希、实际权重与回放通过才签发完整 ACK；部分失败只能签发字节备份回执 |
| 汇总 | [review_coverage_replication.py](../../research/liftcut-agent/review_coverage_replication.py)：必须同时提供 42/43/44，报告四个配对的逐 seed 变化、方向反转、旧门槛复现次数与独立候选保护条件 |

冻结参数见[准备报告](../../research/liftcut-agent/reports/coverage-replication-preparation-v1.json)。
每组 504 个正确决策、两轮、1,008 次样本使用、126 次更新、41,788 监督 tokens；
S0/M 输入 1,827,888 tokens，T/TM 为 1,851,664，不能称为等计算量。
训练仍为固定基座、NF4、rank16、lr0.0002、final-only。推理 seed42 与原 greedy
设置不变。43/44 各四组，共八次训练、248 条重复开发评测；不增加独立任务数。

初始参数指纹须在同 seed 四组间一致，在新 seed43/44 之间不同。探针只反向传播，
不更新参数；其前后指纹必须一致。历史 seed42 没有保存初始化指纹，不能补称已核验。
这些 CUDA 行为只能在后续真实窗口核验，本次静态入口检查和合成测试不能代替它。

## CPU 准备与检查

已用两套既有、独立 token 化并逐文件复核的原训练/诊断输入，分别构建新版准备。
三 seed 共七份文件逐字节相同；seed42 的顺序、目标序列及 token 总量与旧路径相同。
43/44 各做一次十阶段控制器 dry-run，无模型调用且不创建执行输出目录。
具体指纹及限制见[就绪报告](../../research/liftcut-agent/reports/coverage-replication-readiness-v1.json)。
本机这一步复用了已验证的真实 token 输入，没有重新下载或重新 token 化。
CI 则从固定 tokenizer 重建原输入，再准备两次 R1 并比较七份文件。

新增 16 项回归覆盖实际入口 reseed、完整合成回放和五归档恢复、错 seed/arm、
被改写的训练行、运行环境、权重字节、token 审计、比较报告和归档标签。
测试里的响应与权重是显式合成夹具，零模型能力证据。完整测试和远端 CI 结果以
[研究日志](EXPERIMENT_LOG.md)及本次 PR 为准。

以下命令在仓库根目录执行；三个目录均为本轮明确选择的路径。准备命令拒绝覆盖：

```bash
python research/liftcut-agent/prepare_coverage_replication.py \
  --prepared-dir "$COVERAGE" --diagnostic-dir "$DIAGNOSTIC" \
  --output-dir "$REPLICATION"
python research/liftcut-agent/prepare_coverage_replication.py \
  --prepared-dir "$COVERAGE" --diagnostic-dir "$DIAGNOSTIC" \
  --output-dir "$REPLICATION" --verify-only
```

已有新版准备时只运行第二条。不要使用 `--write-initial-report` 覆盖已发布的冻结报告。
如原输入缓存缺失，在 CPU 上用旧 `prepare_state_coverage.py` 和
`prepare_state_diagnostics.py` 的 `--tokenizer-dir` / `--output-dir` 重建，再核验旧报告。

## 新实例的开机前提与预算

下一次只启动 **seed43**，seed44 另开相同预算的新窗口。沿用 4090 24GB，
原单价 ¥2.18/小时：每窗口从开机起最多 180 分钟，计算费代理上限 ¥6.54、预留 ¥8；
两窗口预留 ¥16，存储另算，不自动扩盘。若新订单价格改变，先更新预算再执行。
没有本轮 API 费用，也没有升级 A800 的依据。

上轮四组优化累计 5,661.76 秒，增加 20% 为向上取整 114 分钟；另留 36 分钟给
准备、加载、评测和审计，30 分钟给备份。它是规划代理，不保证一定跑完。若缓存
缺失或换机安装无法在窗口内完成，应保留检查结果并关机，不临时延长或从训练时重计。

运行环境严格复用 seed42：Python 3.12.3，Torch 2.8.0+cu128，CUDA build12.8，
Transformers 4.57.6，tokenizers0.22.2，Jinja2 3.1.6，accelerate1.10.1，PEFT0.17.1，
bitsandbytes0.47.0，GPU 名称 NVIDIA GeForce RTX 4090。
[依赖清单](../../research/liftcut-agent/requirements-gpu-pilot.txt)和准备报告是核对依据。
不自动升级全局包；环境不符即停止，先判断是否仍是同一实验条件。

按照 [AutoDL 手册](AUTODL_RUNBOOK.md)使用 `/root/autodl-tmp/liftcut`：
`code/<40位commit>/` 独立 detached HEAD、禁用 push；`data/` 保存输入；
`runs/coverage-replication-v1-seed43-<日期>/` 保存新结果；旧目录全部保留。
连接信息不入 Git，不把本地 GitHub 或 API 凭据传到云端。换机先确认数据盘、模型、
旧四份 adapter、环境是否仍在，再校验哈希；关机保留磁盘不能代替异地备份。

## 启动步骤与自动停止

1. 用户开机并提供最新 SSH 后，记录实际实例开机时间 `LIFTCUT_BOOTED_AT`（带时区）。
   若只能取得容器 PID1 时间，明确标为代理并核对平台时间；不能用连接或训练开始代替。
2. 在下载、安装或长检查之前，用手册中的 `shutdown_guard.py --arm` 启动独立兜底，
   deadline 固定为开机 +180 分钟，确认 `armed` 回执和存活进程。控制器会再次设同一
   截止时间的兜底。控制器前置检查可能提前报错，所以外部准备兜底不能省略。
3. 检出通过 CI 的完整 commit，确认干净、禁用 push；核对环境、价格、模型、输入，
   准备并 dry-run。开机超过十分钟才尝试正式启动时，控制器拒绝，不重置时间。
4. 正式窗口顺序为 S0训练/评测、T训练/评测、M训练/评测、TM训练/评测、token审计、
   综合审计。150分钟工作截止，任一阶段失败即保存已完成和部分产物并进入备份。
5. 本地持续下载每组完成后的归档，最后下载 evidence 与索引；完整恢复验收后上传
   ACK，控制器主动关机。到180分钟仍未收到有效 ACK 也会关机，保留盘上数据。
   备份失败需如实记录，不能用空 ACK 绕过检查。

在同一已激活环境的 shell 中，先明确设置 `MODEL`、`MODEL_MANIFEST`、`COVERAGE`、
`DIAGNOSTIC`、`REPLICATION`、`TOKENIZER`、`RUN`、`LIFTCUT_BOOTED_AT` 和
`EXPECTED_COMMIT`；后者来自本地验收过的版本，不能用随时变化的 `main` 代替。
`RUN` 必须是上述持久化 runs 下不存在的新目录。先 dry-run：

```bash
python research/liftcut-agent/run_coverage_replication_window.py \
  --model-dir "$MODEL" --model-manifest "$MODEL_MANIFEST" \
  --prepared-dir "$COVERAGE" --diagnostic-dir "$DIAGNOSTIC" \
  --replication-dir "$REPLICATION" --tokenizer-dir "$TOKENIZER" \
  --output-dir "$RUN" --seed 43 --expected-code-commit "$EXPECTED_COMMIT" \
  --hourly-cny 2.18
```

正式执行在相同命令后追加下列参数，使用独立于 SSH 的进程并保存 stdout/stderr：

```text
--execute --shutdown-when-done --booted-at "$LIFTCUT_BOOTED_AT"
```

完整 40 位 commit、开机代理、deadline、work cutoff、每阶段日志和五归档哈希都会
记录在结果中。截止不能因 seed43 得分差而延长；seed44 也不能因43阴性而删除。
硬件、预算或证据错误可以停止，未完成项保留为缺失，不用新 seed 替换。

## 本地恢复和回执

下载目录应含 `backup-ready.json`、`s0.tar.gz`、`t.tar.gz`、`m.tar.gz`、
`tm.tar.gz` 和 `evidence.tar.gz`。训练归档约122MB/组（旧轮参考），先逐组传回。
服务器端原 training 归档位于 `training/` 下，下载到同一目录时保留 basename。

使用装有固定 tokenizer 依赖的本地 Python，在仓库根目录运行：

```bash
python research/liftcut-agent/restore_coverage_replication.py \
  --archive-dir "$DOWNLOADS" --prepared-dir "$COVERAGE" \
  --diagnostic-dir "$DIAGNOSTIC" --replication-dir "$REPLICATION" \
  --tokenizer-dir "$TOKENIZER" --seed 43 --expected-code-commit "$EXPECTED_COMMIT" \
  --output-dir "$RESTORED"
```

必须先持有实际 adapter 文件，核对所有归档字节和绑定，独立重放全部124条轨迹、
生成 token 及最终比较，才会产生 `$RESTORED/off-instance-backup.json`。
仅将该回执上传为服务器 `$RUN/off-instance-backup.json`。如果窗口失败，明确加
`--allow-partial`：只证明已保存字节，`episodes_replayed=0`，不能称完整实验通过。
恢复目录也必须新建，不覆盖先前失败目录。权重与含完整恢复路径的本地材料不入 Git。

关机后记录 ACK 是否被消费、shutdown 返回和平台状态；SSH 拒绝连接不能直接
证明计费停止。以实际可观察证据写账；不为补日志重开 GPU。代码、结果和学习笔记
继续经本地分支→PR→CI→main 管理，不在云端临时修改实验后继续跑。

## 如何读下一轮结果

43/44 两窗口完成后，用汇总入口提供 `--prepared-dir`、`--diagnostic-dir`、
`--replication-dir`、`--tokenizer-dir`、`--seed43-run`、`--seed44-run` 与新 `--output`。
其原 seed42 输入固定为已发布证据，不允许挑选。汇总报告每个 seed 的逐例得失、
四个原筛选配对通过次数（0/3到3/3）及效果方向；代表 checkpoint 仍固定为 seed42。
新候选无退步与零未批准写入尝试只是必要条件，不等于通过改善门槛或证明泛化。

两个窗口完成后再决定是否进入 D2；G1 仍需稳定错误和严格成对反馈数据的触发条件。
48个保留任务仍未用于本轮选择。D2、G1、外部任务和最终独立评测没有被本次 R1
代码顺带启动；没有合格候选也应发布负结果并收敛首版。

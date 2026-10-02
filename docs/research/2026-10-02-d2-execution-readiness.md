# D2 开机前验收：固定权重诊断与恢复流程

本轮完成的是**执行准备和 CPU 演练**，还没有 D2 的模型成绩。继承
[短板分析](2026-10-02-shortfall-audit-and-d2-contracts.md)与
[下一步方案](2026-10-02-post-r1-next-plan.md)，保持 seed42 的 S0/T/M/TM 四份权重，
80 例/组、320 例总分母、544 次请求上限，48 个保留任务仍未使用。

## 为什么做这一轮

R1 的三 seed 结果尚不能支持提升稳定且可泛化的结论。训练覆盖中澄清目标仅占
监督 token 的 3.81%，而审计的三个错误族之后没有恢复目标；这给出了训练暴露不足
的假设。16 次 CPU 澄清干预能区分缺信息、需重规划和必须等用户，但不能证明模型
会自主恢复。D2 用受控状态继续区分记忆顺序/ID 依赖、澄清覆盖、授权状态理解和
收到明确校验错误之后的修复行为，然后再决定是否训练。

没有把某个总分提高当作目标。每组分别报告 memory48、identity12、consent12、
repair4、infeasible4；首响应72例和完整续接8例不能合成“任务成功率”。

## 固定执行与时间预算

| 项目 | 开机前固定的条件 |
| --- | --- |
| GPU / 单价假设 | RTX 4090 24GB，¥2.18/小时；变更时重新核对 |
| 预留 | ¥5；2小时算力代理上限¥4.36，存储另计，不自动扩盘 |
| 工作 / 硬关机 | 从原开机代理算起90 / 120分钟；不是从每组开始重算 |
| 启动容差 | 原开机代理后10分钟内；超时停止，不刷新时间 |
| 模型 / adapter | 原 seed42 的真实文件 SHA256；没有新训练、下载或安装 |
| 运行环境 | 原 seed42 Python、Torch、Transformers、PEFT 等版本，NF4/BF16及原精度设置 |
| 推理 | 原 native Qwen parser；greedy；输出512，context4096；不截断、不修补输出 |
| 固定组顺序 | S0 → T → M → TM；部分失败后不跳组继续 |
| 每组校准 | 下面12例，已经包含在80例里；没有额外“试答” |
| 磁盘 | 本机和服务器均至少3GB可用；开机时再次实测服务器 |

每组先执行以下固定顺序，其余68例按原 manifest 顺序执行：

```text
d2-memory-v0-c0-first-unconfirmed
d2-memory-v0-c0-first-expired
d2-memory-v0-c1-first-unconfirmed
d2-memory-v1-c0-first-unconfirmed
d2-memory-v2-c0-first-unconfirmed
d2-memory-v3-c0-first-unconfirmed
d2-identity-v0-c0-first-unconfirmed
d2-identity-v0-c1-last-expired
d2-consent-pending-plain
d2-consent-revoked-memories
d2-repair-unknown_evidence-v0
d2-infeasible-unknown_evidence-v0
```

这12例包含10次首响应任务和2次完整续接任务。每组当前校准必须至少产生6次真实
首响应生成、2次真实续接生成；context guard 不计入吞吐测量。不足时保存部分结果
并停止。每个后续例之前，都按**首响应/续接分别**重算：

`Σ[max(2秒, 1.5×该模式已观测P95生成耗时) × 该模式剩余最大请求数]`

再加 `max(120秒, 1.5×已观测最大模型加载耗时) × 后续组数 + 300秒审计余量`。
P95使用 nearest-rank，包含已完成组与当前组的真实生成；未来每个首响应例仍预留
1次，每个续接例仍预留8次。预计不能放入剩余工作时间就停止，不挑掉长题。
这是经验估计，真正控制成本的是子进程工作截止和独立关机守护。

**开机前调整的理由：** 原 seed42 历史407次生成中，各组中位数约2.0–2.1秒，
P95约8.0–8.7秒。长计划和简短工具调用差异大；统一P95乘全部544上限会过早拒绝
本可容纳的诊断。因此在看到任何 D2 模型输出前，按预先已知的任务模式分层。
未缩小题量、分母、输出上限或时间安全系数。历史耗时不是本轮吞吐测量。
建议预留约45–90分钟工作及最多30分钟恢复余量；新状态下实际耗时由正式校准决定。

## 数据与关机如何闭环

1. 先只上传 `d2_setup.py`、`shutdown_guard.py`，执行 `--arm-only`，观察守护已武装。
   原开机代理取操作提供时间与容器PID1启动代理的较早者；重新连接不能延后截止。
2. 守护就绪后再上传本地 Git bundle 和已固定的 prepared/tokenizer 包；独立 checkout
   使用最终检查通过的精确提交。启动脚本验证文件摘要，禁止安装依赖或下载模型。
3. `d2_setup.py` 先独占写入 launch intent 再启动控制器；出现歧义时检查现有进程，
   不重复启动。控制器再武装一份同截止的守护，并核对磁盘、模型和四份 adapter。
4. 每次生成、模型协议调用、完整 episode、预算估计逐条 flush/fsync。每组完成后
   立即归档，本机可提前下载并核对字节；提前下载不发完整恢复 ACK。
5. 工作结束或失败后保存完整/部分 evidence 归档。丢失例仍留在80/320分母；中断
   的残留调用不伪装成已完成 episode。部分回执只证明字节完整，不证明模型任务成功。
6. 完整回执必须由恢复工具实际生成：恢复到全新目录，核对归档 inventory、四个早期
   归档、320次 native/environment 回放、生成 token IDs，以及本机已保存的真实
   seed42 adapter 字节。D2没有新权重，不再传输相同的529MB adapter。
7. 回执经独占临时上传、读回SHA256、无覆盖rename后才发布。写失败为failed；rename
   后断连为unknown，绝不能直接记成功或自动重试。单连接监控保留原截止，不自动重连。
8. 控制器最多等15分钟回执，且不超过硬截止前60秒；完整/部分/失败均尝试关机。
   备份或日志异常也不能跳过关机；独立守护仍保留。接收回执、关机请求、SSH断连和
   平台停止计费分别记录，最终仍需平台状态或用户确认。

服务器停机期间没有探测云端。本机已重新核对四组8个文件，共528,755,732字节，
与原 seed42 公布的SHA256一致；检查时本机约74.9GB可用。服务器历史文件路径已
准备，**当前云端文件存在性、GPU、环境与剩余磁盘必须开机后检查**。缺失时停止，
不擅自重装、扩盘、换模型或扩大预算。

## 实际验证与证据

- [执行冻结清单](../../research/liftcut-agent/reports/d2-execution-readiness-v1.json)：
  CPU前缀、全部执行来源SHA256、精确case顺序、预算、校准及停止公式。
- [完整CPU演练摘要](../../research/liftcut-agent/reports/d2-operating-drill-2026-10-02.json)：
  320例环境/native回放，352条**脚本**原生响应及真实token重建；272次预算预测重算。
  使用本机原权重完成完整恢复与回执消费，关机使用stub；没有网络、GPU或真实关机。
- 新增故障测试覆盖超时、慢响应、回拨时钟、部分分母、预算重置、启动参数漂移、
  下载超长、归档数量上限、真实权重缺失、回执写入/关闭/读回/rename故障、无回执
  关机、备份失败关机。CI仅有tokenizer，没有权重，因此明确不生成完整恢复回执。
- 本机全量438项测试通过（158.642秒）；修订预算分层与归档检查后，完整CPU演练
  再次通过。第二份独立prepared目录也通过同一执行冻结清单，控制器dry-run没有
  启动进程或生成。GitHub检查以最终精确提交为准，不用前一提交的绿灯代替。
- CPU脚本产物全部带 `scripted_contract`，模型恢复入口默认拒绝；这不是新模型成绩
  或供应商运行来源证明。逐例原始演练保留在本机ignored outputs，不混入正式报告。

运行入口：`prepare_d2_execution.py`、`stage_d2_execution.py`、`d2_setup.py`、
`run_counterfactual_window.py`、`monitor_counterfactual_diagnostics.py`、
`restore_counterfactual_diagnostics.py`。操作细节见 [D2 runbook](D2_RUNBOOK.md)。

## 结果回来后怎么判断

先原样保存四组完整逐例结果和失败原因，再看同状态的收益与回退。按memory的
position/invalid/clarification/value角色分别检查；identity与其原case配对，不把
ID双射后的开发状态称为新任务泛化。consent区分真实外部授权与只读历史。
repair分开报告目标字段已修好、最终任务完成、过早报不可行和接口失败。

G1仍只看固定seed42的T：至少一个原定错误族的两个变体均为行为性未修复或修复前
过早报不可行，才进入成对数据审计。timeout、parse、invalid_arguments、unknown_tool
不能凑行为触发；修好了目标字段但后来出了另一错误，也不等于目标未修复。
通过触发仍不自动训练，需另行准备数据、对照与预算。不开seed45，也不动48保留任务。

**学习检查：** 能解释“完整下载”“独立恢复”“回执已发布”“服务器已消费”和
“已停止计费”各自需要什么证据；能解释为什么CPU oracle全对不能写成模型提升；
能从某个失败case回溯prefix、模型响应、环境返回和最终评分，而不只看总表。

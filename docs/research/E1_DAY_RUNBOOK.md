# E1在新24小时研究日中的执行手册

本手册只适用于用户2026-10-13在上一轮关机后提出的新“一天服务器”安排。正式开机仍等准备完成后的用户消息；不能用旧04:27开机、旧日期守护或演练合成时间启动。日程和实验分支见[当日计划](2026-10-13-next-day-plan.md)。

## 版本与真实准备结果

新[execution-v2](../../research/liftcut-agent/reports/e1-execution-v2.json)冻结146源。旧[v1](../../research/liftcut-agent/reports/e1-execution-v1.json)保留；科学协议、固定D、原128个研究源及其余非运维源不变。旧143源只允许修改6个执行/准备文件，新加3个日租期/采样/资源分析文件。不能拿新的运维版本改变提示词、工具、推理预算、48任务门槛或权重。

本机实际通过：739项完整测试（Windows跳过10项单独运行的故障测试及1项Linux进程测试）；14项整日针对测试中的13项实际通过，Linux实际进程组测试交由Linux CI；12项传输/回执状态测试通过。CPU整日演练使用12个DEV任务各复制4次，A/D共96脚本回合、648模拟请求，实际旧父权重核验后完整增量恢复；[完整准备记录](../../research/liftcut-agent/reports/e1-day-readiness-v1.json)不是模型成绩。没有父权重的[独立窗口演练](../../research/liftcut-agent/reports/e1-execution-readiness-v2.json)保持partial，不能生成完整证明。真实模型调用和E1保留任务读取均为0（准备CLI有拒绝读取钩子）。历史全库结构测试访问边界不改写。

正式启动还必须使用最终完整SHA六项CI全部成功、实际小包安装核验通过的版本。最终Git、stage路径和安装记录写本机HANDOFF；不要用旧955c24a的两小时关机包执行整日模式，也不要为写合并事实循环新PR。

## 开机前可完成的事项

1. 将最终受检commit通过`launch_e1.py --stage`打包到新目录；从旧2576cd3基点生成代码差量，资产上传0字节。实际在本机新副本安装后核对146源和CLI导入；旧checkout不修改。
2. 准备path-only本地配置：沿用I2真实恢复/receipt/index和tokenizer，以及原服务器数据盘的父run、基座、运行环境。新SSH主机/端口在开机消息后核对；严格known_hosts，凭据仅经PTY getpass，不存文件。
3. 核对本机一次性数据账本，确认没有新的E1预约或已读attempt；存在即调查原进程/数据，不删除重试。服务器账本在正式开机后同样核对。
4. 不提前创建真实authorization，不连接关闭实例，不先启动观察器或自动回访。合成fixture授权仅供测试，不能当作用户开机事实。

## 新开机后只生成一次的绑定

T0为用户开机后实际记录的UTC开机代理。基础authorization保留`experiment=E1`、`maximum_minutes=120`、`reserve_cny=5`、`hourly_cny=2.18`、`heldout_scope=one_48_task_batch_with_fresh_A_and_D`、`automatic_shutdown=true`，`source`改为`explicit_human_new_server_day`。这里的¥5和120分钟限制E1子窗口，不是第二笔费用，也不再触发整机两小时关机。

同一记录增加`power_lease`，内容如下。**以下是字段契约，不是可直接执行的授权文件。**

| 字段 | 固定值或实际来源 |
| --- | --- |
| version | liftcut-research-day-v1 |
| authorization | explicit_human_20261013_one_day_after_ready |
| booted_at_proxy | 同一个实际T0，必须与E1授权一致 |
| shutdown_at_utc | 原T0加24小时 |
| hourly_cny / reserve_cny | 2.18 / 55 |
| automatic_shutdown / automatic_reboot | true / false |
| paid_api_calls / disk_expansion | 0 / false |
| heldout_scope | E1_one_48_task_batch_with_fresh_A_and_D |
| maximum_followup_gpu_trials | 2 |
| final_collection_buffer_minutes | 45 |

唯一启动命令：`launch_e1.py --execute --stage-dir <已核验新stage> --config <path-only配置> --authorization <真实T0记录> --run-id <实际UTC YYYYMMDD-HHMMSS>`。必须先核对账本、会话和进程。启动后记录唯一launcher/collector会话、PID与实际opening，不能自动重发命令。

## 两层截止与遥测

- 在大代码增量上传前，`e1_power.py`安装原T0+24h守护。独立day进程只按原deadline执行关机；已绑定的源、PID、启动ticks、kernel boot ID和armed记录均核验，不接受延时或重置。
- E1仍开机10分钟内派发，工作不晚于trial+90/boot+100，收集不晚于work+20/boot+118。独立trial守护在boot+120停止原隔离进程组；检测到已识别控制器死亡而子进程仍在时，停止原子进程组。未知身份不向其它组发信号，保留异常供人工/当前任务核查，不自动重启。
- 原服务器环境、输入、推理配置和评分源不变。day模式完整/partial都保留实例到原24h截止；已知启动前故障不提前关机，记录原因，后续处理不能重置T0或数据账本。
- `gpu_telemetry.py`只读运行一次，5秒调用nvidia-smi，保存利用率、显存、功率、探测耗时和UTC/单调时钟。查询失败、N/A、断样保持未知，不自动重复启动采样器。观测开销会被记录，首次实际开机才能验证真实驱动输出。

## 恢复与真实回执

本机冻结restorer必须读取原实际父权重和此次完整96回合，核验原环境、native、投影、逆映射、token；从它生成的新恢复目录取回执，临时上传→读回校验→原子发布。不能手写ACK；partial保持partial。

新收集器确认服务端消费布尔值及原binding对应的`window-close.json`后立即退出，分别保留成功或未消费；归档状态与关闭状态冲突就报错。保存当时GPU采样快照，不把回执发布、本机退出0、服务端消费和电源状态互相代替。未知连接结果先读已有日志/进程，不自动开启第二收集器。

E1数据用量按数据SHA预约，不按新run-id免责。失败后不能以新的运维目录无条件再开原48验收。后续GPU轮次至多2次，必须另行保存证据触发、事前科学协议、CPU检查、精确提交/CI和独立工作/收集截止；`maximum_followup_gpu_trials`字段不是一个可以跳过这些步骤的自动调度器。

## 资源分析与最后关闭

用`analyze_resource_usage.py --lease <实际day-lease> --samples <完整原始采样> --observed-end <实际观察截止> --output <新报告>`重建。活动时间可另给`--intervals`，只接受有来源、非重叠区间；CPU与GPU并行工作可另外列出，但不能重复累计租费。截断或不合法记录不能伪造补齐，保留原始文件并明确有效前缀/覆盖率。TTFT与逐token延迟未测，不能由5秒快照推导。

最后45分钟不新开计算。按本次真实ops和原T0+24h建立唯一只读关闭观察，先核对已有预约/进程；读取`day-power-events.jsonl`、`day-shutdown-return.json`和最后采样，保存上传/读取的实际来源与SHA。不删除守护，不为补日志重开机；未捕获的请求/返回写未知。若守护失败且实例实际仍运行，按本日授权关机，不延长租期。

关机请求、命令返回、SSH断连和平台显示各自记录。必要时仅一次询问平台是否显示关机，不询问费用；全部数据和Git可以在平台回复前交付。最终开机时长×¥2.18是费用代理，E1/后续子窗口不再相加。晨报/日报覆盖实际功能、剩余错误、下一步、效率和条件式ETA；精确六项检查全部成功才合main，完成后删除该日回访。

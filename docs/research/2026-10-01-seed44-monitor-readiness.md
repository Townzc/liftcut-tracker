# seed44 本地监控与故障验收

项目日期2026-10-01（America/Los_Angeles）；CPU操作日志从2026-10-02 00:03 UTC起。
本增量实现[seed43后计划](2026-10-01-post-seed43-review-and-next-plan.md)的第一项：
本地归档收集、真实恢复与回执发布。**没有连接服务器、启动seed44、调用模型或读取
48个保留任务。** 上轮AutoDL平台停机/计费确认仍待用户提供；不能把CPU就绪当作
平台状态已确认，实际开机须待最终分支检查及该确认。

## 为什么修改

seed43五份归档已成功恢复；旧监控直接向最终ACK路径上传时，SFTP在等待close响应
期间断连。远端可能已经读取完整文件，也可能未收到完整文件，没有证据区分。
连接关闭不能证明平台计费停止，当前实现也不追认旧ACK已被接受。

新[本地监控器](../../research/liftcut-agent/monitor_coverage_replication.py)和
[回执传输模块](../../research/liftcut-agent/replication_receipt_transfer.py)保留原科学条件，
只改变本地收集/传输过程。云端继续运行完整commit
`f18cb5820881a048b19b6007fc4ca231dfd64de9`，不改八个冻结入口或准备报告。
本地最新代码与云端冻结代码是两个明确记录的版本，不能向运行中的服务器同步main。

## 行为与证据边界

1. 配置明确seed、冻结commit、远端run/ops、新本地目录、旧输入和实际开机时间。
   默认只做CPU预检，不创建run目录、不导入SSH依赖、不连接网络。
2. 显式`--connect`才附着到已授权运行的窗口。仅使用已核验known_hosts和交互式密码；
   不执行远端shell、不启动/重启训练、不自动重连。连接配置和密码不能提交Git。
3. 核验opening、run-binding、两份guard armed记录及controller启动argv。拒绝重复、
   缩写和等号形式覆盖参数；控制器必须在原开机十分钟内启动，但监控可晚接入。
   读取到armed记录不等于独立确认当前guard进程仍活着，启动时仍按原手册检查进程。
4. 逐组提前下载，字节和SHA通过才将唯一`.partial`文件转为完整归档。已有完整归档
   每次启动重新hash，拒绝覆盖。最终index必须与已观察的早期归档身份一致。
5. final index半写只有限重读；合法JSON中的错seed/commit/index立即失败。真实
   restorer每次运行到新的UUID目录，不信任旧receipt来跳过权重、轨迹或token核验。
6. 完整恢复必须验证实际权重、124条native/environment回放及生成token。失败窗口
   可按原`--allow-partial`保存字节，但回执保持0条回放、研究验证字段为false。
7. 真实回执依次通过：schema/index绑定 → 同目录唯一临时文件exclusive创建 → 写完
   并关闭 → 长度与读回SHA核对 → 标准SFTP rename到最终路径。禁止覆盖最终文件；
   同字节既有final只记录已观察，不冒充本次新上传。
8. rename回包丢失记录`unknown`，不自动重试。原子发布减少半文件可见风险，无法
   保证拿到服务端接受或关机返回。平台状态始终需要独立核实。

终态分别保留`run_status`、`local_restore_verified`、`complete_study_replayed`、
`server_acknowledged`及关机请求返回值。CLI仅在完整恢复、观察到ACK=true且关机
请求返回0时退出0；partial、未知/否定ACK等退出2。即便退出0，
`provider_power_state_verified`仍为false。操作异常则退出1，只输出异常类型并保留
操作日志，不向终端转发任意传输异常原文或traceback。

## 预算与中断恢复

仍从同一个带时区的开机时间计算150分钟工作截止、180分钟硬截止；原控制器/独立
guard负责远端停止。监控使用绝对时间与单调时钟双检查，网络操作有超时，通道协商
及整个连接另有关闭兜底。本地重启、下载或网络等待均不能延长云端窗口。
恢复子进程只使用硬截止前扣除90秒后的剩余时间；不足则保留数据，停止本次尝试。

每个operations目录用exclusive lock防止并发采集。正常退出移除锁，崩溃遗留锁不得
盲删：先确认对应本地PID确实不再运行，再由操作人员记录原因并清除该锁，随后
显式重新附着原窗口。旧partial、失败恢复目录和真实receipt均保留，不自动清理。
重连前仍核对原时间，截止后不连接，不为补日志开机。

seed44预算不变：4090 24GB，原价格¥2.18/小时，最多3小时，计算代理¥6.54，预留¥8。
本地至少3GB新增余量；服务器结果/归档至少2GB、缓存另计，开机后须实查。
本轮没有新增租用或API费用；上轮账单未知，不能把时长代理当最终账单。

## CPU验收证据

机器可读结果见[本地就绪记录](../../research/liftcut-agent/reports/seed44-monitor-readiness-2026-10-01.json)。

- 复用两套历史已token化输入，分别新建两份replication准备；七文件一致且与旧准备
  清单一致。没有重新token化；CI会从固定tokenizer重建输入。
- 八个冻结源码及准备报告同时匹配公布哈希和f18 Git内容。两次seed44十阶段dry-run
  均无执行输出目录；本地空间满足要求。
- 新监控和回执的故障测试覆盖半写、close/hash失败、错身份、既有final、rename
  回包丢失、截止、restore非零/超时、旧receipt、partial，以及连接参数兼容性。
  这些合成SFTP/模型回复夹具不是模型能力或真实云端传输证据。
- 新监控的`restore_and_publish`额外串起一次真实历史seed43恢复：五归档、100个
  清单项、实际权重、124条回放、409次生成token通过，40.204秒。真实receipt与
  内存SFTP最终文件逐字节一致。这里的模拟时钟只约束新的本地CPU测试，不延长旧
  GPU窗口；没有seed44模型结果、网络上传、服务端ACK或平台关机证据。
- GitHub继续运行完整研究/产品检查，另增加seed44监控默认离线预检；该步骤不创建
  运行目录、不连接SSH、不下载权重。最终精确提交的检查与合并记录以PR为准。

## 下一窗口如何使用

在仓库根目录先执行公开配置的离线预检（Windows示例；监控Python需已有Paramiko，
恢复Python需固定tokenizer依赖；实际测试本地传输依赖为Paramiko2.8.1）：

```powershell
python research/liftcut-agent/monitor_coverage_replication.py --config research/liftcut-agent/configs/coverage-replication-monitor-seed44.example.json
```

公开[配置模板](../../research/liftcut-agent/configs/coverage-replication-monitor-seed44.example.json)
没有有效endpoint或开机时间，只能离线预检。开机前将其复制到ignored outputs目录，
确认本地路径；输入准备可以改为本次独立验证的副本。路径相对于仓库根目录解析，
不是相对于配置文件。Linux本地执行时相应调整restore_python路径。

只有在上轮平台关闭已确认、用户新开机并提供当前endpoint/开机时间后，才填写私有
配置，执行[原开机手册](AUTODL_RUNBOOK.md)中的准备guard、环境/价格/模型/空间
核对、冻结f18控制器启动。seed参数为44，远端run/ops名称均包含44和新窗口标识。
确认双guard、完整argv、run-binding已落盘后，在独立本地终端执行：

```powershell
python research/liftcut-agent/monitor_coverage_replication.py --config research/liftcut-agent/outputs/autodl/seed44-monitor.json --connect
```

密码仅在提示中输入，不写命令行、配置或日志。monitor-config.json用于阻止同一
operations目录改绑窗口；换实例/新窗口使用新目录，旧备份不删除。
模型缓存/依赖缺失或价格不符时按原窗口停止，不在此监控中自动安装或下载。

seed44完成后才做原三seed汇总；D2的80例构造与G1仍未实现，48保留任务继续不用。
此监控没有启动它们的入口，也没有修改预算或训练条件。

## 学习检查

沿事件顺序解释五件不同的事：字节已下载、真实实验已恢复、回执已发布、服务端
已接受、平台已停止计费。写出任意一个断连点，判断哪些已知、哪些未知；再说明
为什么“重复跑恢复”可以，而“凭旧receipt补写成功事件”不可以。

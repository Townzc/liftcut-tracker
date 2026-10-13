# I3执行与恢复

先读[事前设计](2026-10-13-i3-id-robustness-design.md)。本夜不重新开机，不扩盘，不用API，不访问48个保留任务。I3固定D和原G4 control，不改变I2条件；新代码独立冻结。

## 本地准备

在`research/liftcut-agent`运行；真实路径配置只含路径/端口，不保存密码。`reports/i3-execution-v1.json`绑定128源，`reports/i3-reference-v1.json`绑定实际I2完整恢复和父权重。`reports/i3-readiness-v1.json`仅为CPU脚本演练；真实模型结果尚不存在。

1. `prepare_i3.py --prepare`读取实际I2公开包、真实完整恢复目录、D2和tokenizer，重新核验I2触发。只在本轮设计未执行时生成新冻结；运行中不能更新。
2. `prepare_i3.py --drill`使用新的输出目录。提供真实`--parent-run`、`--parent-receipt`、`--parent-index`时必须实际核验原适配器并恢复完整脚本包；不提供时仅允许partial。两种结果都明确`model_result=false`。
3. 离线测试、公开CI重放通过后提交独立分支，六项最终精确提交检查全部通过才合main。安装包使用受检执行提交，不用未受检的新提交。
4. 用`launch_i3.py --stage --output-dir <new> --commit <exact40> --ref <ref> --lease <local-original-lease>`创建Git增量；本地在全新目录真实安装并核验128源。只上传代码bundle与bootstrap，不传模型/数据/权重。

## 唯一派发

原服务器保持开启。实际UTC生成新runID，使用已准备的路径配置：

```text
E:/anaconda/python.exe launch_i3.py --execute --stage-dir <checked-stage> --config <path-only-config> --run-id YYYYMMDD-HHMMSS --lease /root/autodl-tmp/liftcut/ops/overnight-20261013-042700/lease.json
```

密码仅通过PTY getpass输入；已知主机严格核验。启动器先验证原guard和本地实际父证据，上传核验小包并安装独立Git checkout，再由服务端核验无旧worker/GPU进程、原父权重和D2清单。服务端原子持久化I3家族预约和本夜后续实验slot，实际启动时间写入opening。不得手工删预约后重试。

记下唯一launcher/collector会话、进程、run目录与实际work/collect/hard时间。工作20分钟、收集至实际启动后40分钟、45分钟硬限；必须完整落在原14:15计算边界之前。原04:27至15:00电源租期不重置，实验结束不提前关整夜实例。

## 完整证据条件

增量归档小于20MB，明确不是自包含。配置中的本地父run指向I2恢复目录`parts/evidence`，父receipt和index分别指向真实UUID根和下载目录；不要把新文件塞进原恢复目录污染清单。远端父run含原实际权重、比较、索引和已经存在的真回执。

`restore_i3.py`必须在全新目录核验归档/清单、实际父adapter、64条原环境/native/投影/逆映射/token。只有全部通过才生成真实`off-instance-backup.json`。不能手写ACK，不能把脚本、partial、metadata-only变成完整模型证据。归档损坏或父权重缺失/损坏都不得生成完整回执。

收集器分别记录临时上传、读回、原子重命名；服务端分别记录实际消费与窗口关闭。回执等待固定至原收集截止前10秒，不再受备份后20分钟限制。成功消费后刷新服务端事件，避免本地保留的事件流停留在上传前。SSH断连与平台停止计费仍是不同事实。

## 异常和下一步

派发/重命名结果未知时，先检查现有会话、真实进程和已有文件；不自动重启推理或收集器，不延长原截止。需要恢复收集时另建目录，保留实际opening。失败只发布已有partial证据，不补跑填分。

真实数据齐备后，在新的结果分支审查全部32对C/D、8锚点内变异、4编码分层、唯一输入/输出token、来源与逆映射、开销；按原D门槛判定，保持I2历史和开发域边界。最多还有一个有机制依据的后续小试验名额，不能为烧满租期追加。更新日志和晨报后继续最终15:00关机观察。

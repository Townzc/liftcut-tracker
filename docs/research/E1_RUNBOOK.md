# E1未来窗口操作手册

状态：执行实现、CPU演练、精确提交六项CI和本机真实增量安装均已通过，详见[PR56交付记录](2026-10-13-e1-execution-preparation.md)。执行冻结`955c24af3419e35cb83f5030405569fade88d327`；本机stage为`outputs/autodl/e1-stage-955c24a`，安装记录为`outputs/autodl/e1-install-955c24a-report.json`。**没有新窗口授权；本夜不得执行。** 本手册的命令是未来操作契约，不能把示例时间当作真实开机。

## 事前冻结与数据边界

固定[完整科学协议](2026-10-13-e1-full-task-protocol.md)、[执行计划](../../research/liftcut-agent/reports/e1-execution-v1.json)及D候选。相同G4 control，A再D，各48完整任务；不训练、不选最高组、不补seed、不改门槛。原48数据有历史结构检查访问，E1只能称首次候选模型完整任务验收，不是秘密盲测。

本轮单独预留¥5/最多120分钟；必须在未来收到用户明确新开机消息后记录实际观察的开机代理。已有整夜窗口在15:00 UTC结束；实现拒绝使用此前的opening。准备阶段不要读取原`benchmark/recovery-v2/test.jsonl`，也不要用全分区加载器去准备E1输入。

## 开机前完成

1. 在独立分支提交；确认最终**完整SHA**六项检查全部成功，再合main。大权重、凭据和私人职业规划不提交。
2. 用该精确head执行`launch_e1.py --stage --output-dir <新目录> --commit <完整SHA> --ref <该head引用>`。stage只含代码bundle、守护和安装脚本，没有资产上传；旧实机代码基点为2576cd3。
3. 在本机已有真实基点checkout的独立副本，用stage中的`d2_bundle.install_bundle`安装新commit并核对143源；不得修改已有旧冻结checkout。保存结果到本机operations/HANDOFF。
4. path-only配置从已验证I3路径复制，指向**实际**本机I2完整恢复、真实receipt/index、原tokenizer和服务器父run；核对新SSH端口/known_hosts。未知主机key先确认，不使用accept-any。凭据只经getpass。
5. 再核对本机及克隆数据盘的`e1-data-use`账本。存在同一dataset SHA预约、读取尝试或未知启动时，先检查真实进程/数据，不能删除账本自动重试。

## 新窗口授权记录

只有真正收到用户新开机及本轮范围授权后，才创建含以下字段的本地JSON；时间填写真实UTC观察值，不使用演练中的合成未来时间。

- `experiment`: `E1`
- `source`: `explicit_human_new_server_window`
- `booted_at_proxy`: 真实新开机代理
- `maximum_minutes`: `120`
- `reserve_cny`: `5`
- `hourly_cny`: `2.18`
- `heldout_scope`: `one_48_task_batch_with_fresh_A_and_D`
- `automatic_shutdown`: `true`

唯一启动命令：`launch_e1.py --execute --stage-dir <已核验stage> --config <path-only配置> --authorization <真实授权记录> --run-id <实际UTC YYYYMMDD-HHMMSS>`。在PTY输入密码，不写入命令或文件。记下唯一launcher/collector会话及本地PID；不要再次派发。

## 执行和异常

启动器先持久化本机dataset预约，上传几KB的电源bootstrap并确认独立守护，再上传代码增量。云端校验精确clean commit、同一固定权重、环境/GPU空闲、runtime和数据盘空间。服务端预约写好后，controller在读取真实任务前保存open-attempt标记，然后按原字节保存共享任务文件。A与D不再分别读原payload，不按成功率跳任务。

工作截止为原trial开始+90分钟，且不晚于boot+100；收集不晚于原工作+20或boot+118，硬关机boot+120。开机十分钟内未准备好就拒绝派发。未知用量、时间耗尽、原始轨迹缺失均保留partial；已启动后不自动连接重试/补跑，不把临时断连当作失败后可以重新开始。

归档为不自包含的证据增量。本机冻结`restore_e1.py`要实际核验父权重、96原环境/native/投影/逆映射及token，完成后才从新恢复目录取它真正生成的`off-instance-backup.json`上传。不要手写ACK。partial明确为partial，不能用完整分母或历史结果补齐。

回执临时写入、读回哈希、原子发布、服务端消费、关机请求、命令返回、断连、平台显示分别记录。收到数据后不必等待耗尽租期；E1独立窗口自动关机，原硬守护保留。SSH断连不是计费停止证据，不为取日志重新开机。必要时仅询问一次平台是否显示关机，不询问账单。

## 结果交付

无论门槛通过、失败或partial都发布原始结论。完整批次公布所有48配对结果、12类别/4业务组合、收益/回退、blocked尝试与实际写入、未知别名、实际tokens和时长；不按平均分掩盖某类错误。费用按原开机至观察截止×¥2.18估算并明确不是账单，窗口和累计费用不重复相加。

结果分支最终精确提交六项全成功才合main，更新日志中的why/what/result/next/learning。若失败，将此批转开发集；修复需要另一轮新设计，不重贴保留集标签。

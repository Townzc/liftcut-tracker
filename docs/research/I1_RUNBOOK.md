# I1条件执行：固定G4新control，原始与有效记忆视图

本轮是固定权重的系统对照，不新增训练。当前先准备链路；真实G4完整恢复、失败
触发、reference/源冻结、最终Git检查和剩余时间核对完成前，禁止派发。

## 选择和时间边界

- 预先指定G4**新control**，不按G4得分选择权重。raw/view各重新推理111条状态。
- 保留原始环境轨迹，单独记录实际模型输入，公开日期与工具返回决定view。禁止
  读取隐藏标签、用脚本答案替代模型输出或消费48保留任务。
- 原开机05:35:00.409447 UTC、累计¥20、每小时¥2.18、14:00关机不变。工作最多
  50分钟，收集最多30分钟；最晚计算13:00、收集13:15，启动时至少留20分钟收集。
  实际截止来自新的trial start，但不重置机器开机时间或成本。
- I1是本夜G3后的第二个小试验。无追加seed、提示重试、付费API、扩盘或重开机。

## 正式冻结前

1. 在主工作树完成G4固定restorer恢复、真实回执上传与服务端消费。核对两组新权重、
   同初始化、222 native/environment回放和全部token；按冻结门槛确认整体候选失败。
2. 完成G4结果PR，再把main合入`feat/i1-memory-view`。保留两边日志与独立I1工具，
   不覆盖主工作树的冻结运行源。相同helper可合并，合并冲突需逐文件确认。
3. 用固定tokenizer解释器运行`i1_protocol.py --create-reference`，传入G4实际
   restored目录/index/prepared、diagnostic、D2和tokenizer路径。该命令重新核验
   G4完整结果并独占写入`reports/i1-reference-v1.json`，不是人工填写权重选择。
4. 完成所有代码后运行`i1_protocol.py --freeze`，独占写入执行计划，再`--verify`。
   CPU完整演练必须实际读取未经改变的历史权重容器；脚本完整回执仍不是模型结果。
5. 对最终精确提交完成全部检查；实际启动前只做已准备的增量安装和状态验证。

## 唯一启动及备份

`launch_i1_overnight.py --stage`离线生成从固定G4代码10a729e开始的Git增量包；
输入完整commit和ref，输出新stage目录。配置包含固定SSH/known_hosts、诊断/D2/
tokenizer目录和恢复解释器，密码只进入getpass内存。

仅执行一次`--execute --stage-dir ... --config ... --run-id 实际UTC时间`。派发验证
原guard身份、无其他controller/worker/GPU进程、固定运行库及真实G4回执；持久化
`i1-dispatch-reservation.json`防止未知结果后重复启动。使用新的代码/run/operations
目录，远端路径一律POSIX，不复用上次G4输出目录。

controller只运行evaluate-raw、evaluate-view、audit。归档包含一份固定权重、
G4来源参考轨迹、两组原始请求与模型投影输入、生成token、运行时间和原始审计。
收集器通过文件SHA、原始环境/投影token和实际权重核验后，由`restore_i1.py`生成
真实回执，SFTP临时写入/读回/无覆盖原子发布，最后单独观察服务端消费。

未知启动/上传结果不自动重试；先核对进程与证据。恢复若必要，使用新目录并保留
原trial截止。partial回执不声明完整实验；不得手写ACK。原14:00守护始终保留。

## 分析与交付

使用全部111条配对收益/回退，单列记忆位置/旧值/无效项/ID、误停和授权保护。
按照预注册的40/48记忆、净增12、ID10/12及固定S0保护分别判定；历史G4只检查
raw重复情况，不能代替本轮新raw。token节省与native延迟是系统指标，不能写成
模型学会了记忆推理。晨报和实验日志记录真实结果、失败与下一步；无论结果如何，
本夜不继续挑提示或追加训练。停止计费与SSH断连必须区分，费用按记录时长估算。

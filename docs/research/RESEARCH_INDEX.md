# LiftCut-AgentLab：研究证据入口

更新：2026-10-03 UTC。G2已完成：正常和修复恢复，但真正不可行退步，原机制/候选门槛均失败。
G3已完整核验：half停止机制通过，两组整体候选均失败，记忆与ID回退；下一轮单独检验排列覆盖。
最新运行状态以[进度](../AGENT_RESEARCH_PROGRESS.md)为准；本页用于理解研究主线，
不能用较早阶段的高分代替最新候选判定。

目标Agent处理计划调整：读取约束与时序记忆，澄清缺失信息，搜索可用项目，生成并
验证方案，提供预览，等待外部确认，再应用获批版本。现有研究环境使用合成任务与
人工时间成本，业务工具和用户事件可重放；它不是已经部署到产品的自主教练。

## 从问题到证据

| 阶段 | 回答的问题 | 已观察的结果与限制 | 原始证据和复盘 |
| --- | --- | --- | --- |
| 环境与协议基线 | 能否独立验证工具动作、状态变化与授权？ | 固定流程14/14是脚本契约；首轮托管模型8/14是另一种证据，不能合并 | [环境说明](2026-09-28-interactive-environment.md)、[托管轨迹与审计](2026-09-28-development-baseline.md) |
| 早期纠错训练 | 正常/纠错轨迹能否改变小模型行为？ | 后续发现标识符含类别线索，保留原始结果但不作为有效泛化证据 | [有效性更正](2026-09-29-recovery-results.md)、[归档](../../research/liftcut-agent/reports/qwen-recovery-pilot-2026-09-28/README.md) |
| 修正后的配对研究 | 去掉标识符捷径后收益是否保留？ | 正常任务base/clean/recovery为0/12、10/12、11/12；纠错增益没有过原门槛 | [修正研究](2026-09-29-controlled-recovery-results.md)、[公开包](../../research/liftcut-agent/reports/qwen-controlled-recovery-2026-09-29/README.md) |
| R1：S0/T/M/TM，42/43/44 | 读取后的授权与记忆干预是否稳定？ | S0→T局部筛查3/3通过，整体候选没有跨三个seed全通过；仍是相同开发状态 | [三seed逐例结果](2026-10-02-r1-three-seed-results.md)、[机器可读汇总](../../research/liftcut-agent/reports/coverage-replication-three-seed-review-2026-10-02.json) |
| D2：固定原seed42，80状态/组 | 记忆顺序、标识符、授权、修复、不可行分别弱在哪里？ | T授权12/12、修复1/4；TM三次未授权尝试均被拦截。80个派生状态不是80个独立任务 | [D2复盘](2026-10-02-d2-complete-results.md)、[完整公开包](../../research/liftcut-agent/reports/d2-fixed-seed42-2026-10-02/README.md) |
| G1：两组新seed42训练，111例/组 | 错误反馈后的正确监督能否提高恢复？ | 修复1/4→3/4，同时完整任务9/12→2/12、真不可行4/4→2/4，原门槛失败 | [G1复盘](2026-10-02-g1-complete-results.md)、[实际权重恢复与222条回放](../../research/liftcut-agent/reports/g1-seed42-2026-10-02/README.md) |
| G2：正常/纠错条件覆盖 | 保留正常首次决策监督能否恢复完整任务并保住修复？ | 正常2/12→10/12、修复3/4→4/4，真不可行2/4→0/4；原机制/候选均FAIL | [完整复盘](2026-10-03-g2-complete-results.md)、[222条实际回放公开包](../../research/liftcut-agent/reports/g2-seed42-2026-10-03/README.md)、[原冻结门槛](2026-10-03-g2-state-coverage-pilot.md) |
| G3：停止条件覆盖 | 只挪动4/8个停止曝光，能否修复循环验证？ | 正常均12/12、不可行均4/4；half修复4/4零误停，机制通过；all有1误停失败。记忆11/48与15/48、ID均2/12，整体均失败；历史G2未重训 | [完整复盘](2026-10-03-g3-complete-results.md)、[222例/376生成核验包](../../research/liftcut-agent/reports/g3-seed42-2026-10-03/README.md)、[预注册设计](2026-10-03-g3-stop-boundary-design.md) |
| 记忆排列审计 | 记忆错误是否来自训练覆盖缺口？ | 训练只有4种记录排列；coverage_mix的24个错误全在未见过的旧值在前排列，全部选旧有效值（事后描述） | [审计](2026-10-03-memory-arrangement-audit.md)、[数据](../../research/liftcut-agent/reports/memory-coverage-2026-10-03/audit.json) |

S0是固定比较基线，T表示读取后授权相关的训练状态覆盖，M表示记忆相关覆盖，TM为
两者组合；它们不是四个基础模型。后来的G1/G2在各自研究中重新训练，不能拼成R1的
更多seed。固定代表仍为42，不用结果最好的一次替代。48个保留任务未使用，外部独立
任务尚未评估，当前没有可晋升的整体训练候选。

## 如何核对一个结论

1. 先看对应研究的事前计划，确认比较对象、固定seed、分母和门槛；复盘里的新解释
   不自动成为事前假设。
2. 从公开包的`publication.json`或该阶段manifest进入原始记录，核对绑定提交、数据、
   预算和源文件哈希。旧阶段未记录的指纹保持缺失，不事后补造。
3. 查看对应`episodes.jsonl`的动作、观察、外部用户事件与终态；用环境重放分数。
   诊断状态只检验局部决策，不可替代从头完成整个任务。
4. 查看`calls.jsonl`与`generations.jsonl`，区分模型原生输出、解析/本地保护与工具返回。
   输出token核验需要固定tokenizer；公开CPU审计不代表再次读取私有权重。
5. 看配对的获得与丢失案例，而不只看平均值；按正常、记忆、授权、修复、不可行分别
   判断。环境阻止了未授权写入，不代表模型没有尝试。
6. 查真实恢复回执、上传记录、服务端消费和关机证据。费用用观察时长×¥2.18/小时估算，
   不把断连当成平台停止计费。

## 可以直接操作的保存轨迹

[G1并排轨迹回放](../../research/liftcut-agent/reports/g1-trajectory-demo-2026-10-03.html)
是独立HTML文件，下载后在浏览器打开；GitHub源码页本身不会执行它。包含全部12组
配对完整任务，已重新执行24条native-response/环境回放，界面不调用模型或服务端。
它显示G1历史结果，另有[G2并排轨迹](../../research/liftcut-agent/reports/g2-trajectory-demo-2026-10-03.html)
显示本轮24条完整任务回放。G2建议查看preview的恢复、infeasible的15次重复验证，
以及memory_missing_time的旧值/时间错误；没有新的推理调用。

建议依次查看：`r2-05-preview`的成功预览与提前误判；`r2-05-approved`第6个事件的
外部approve及后续apply；`r2-05-pending`的等待语义；`r2-05-memory_missing_time`
中同一无效方案重复9次，再触发本地context保护。两列按事件序号排列，不强行视为
相同语义步骤。初始fixture信息、最终分数和未完成轨迹均保留。

从仓库根目录重新生成到一个新文件，不需要GPU、API或tokenizer依赖：

```sh
python research/liftcut-agent/trajectory_demo.py --study g1 --public-dir research/liftcut-agent/reports/g1-seed42-2026-10-02 --output research/liftcut-agent/outputs/g1-demo.html
```

## 学习与后续工作

按[学习路线与检查点](AGENT_LEARNING_GUIDE.md)理解环境、模型接口、轨迹到SFT、配对实验
与负结果诊断。每轮选择和结果在[实验日志](EXPERIMENT_LOG.md)中记录；
[路线图](../AGENT_RESEARCH_ROADMAP.md)管理后续优先级。
[G2后续方案](2026-10-03-post-g2-next-plan.md)先准备停止边界的训练条件对照，单独处理
记忆位置和旧有效值选择；其中[G3设计](2026-10-03-g3-stop-boundary-design.md)已冻结，
已完整恢复并逐组判定，只有half机制通过。后续已获通宵时间/预算授权，但新试验仍需
独立冻结；不自动增加seed，不提前消耗保留任务。

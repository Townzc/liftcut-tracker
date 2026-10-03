# 从轨迹到后训练：项目学习与讲解路线

本文件是学习检查点，记录于2026-10-03 UTC。代码和实验已经完成的部分可以讲，
尚未得到独立证据的收益不能提前写成成果。最新数字从[证据入口](RESEARCH_INDEX.md)
查询，避免背下后来已被更正的结论。

## 第一遍：讲清Agent如何做事

先打开保存轨迹回放中的`r2-05-approved`，用自己的话讲出读取→验证→预览→用户确认
→应用的顺序。模型只产生动作；环境校验参数、约束和授权，并产生观察和状态变化。
`finish(applied)`不能凭空建立一次合法写入。第6个事件是`actor=user`，不属于模型
可以自发生成的批准。确认绑定当前proposal，方案改变后不能借用旧批准。

阅读：[环境](../../research/liftcut-agent/src/liftcut_agent/environment.py)、
[工具与场景契约](../../research/liftcut-agent/src/liftcut_agent/interactive.py)、
[重放](../../research/liftcut-agent/src/liftcut_agent/workflow.py)。

练习：解释preview与apply的区别；手工圈出一次用户事件及它影响的状态。再看pending
和declined，解释为什么两种都没有写入，却不能用相同终态评分。

## 第二遍：讲清模型、工具和评分各自负责什么

读一条`calls.jsonl`与对应episode。模型输出经过原生工具调用解析、参数校验后进入
环境。工具`ok=true`只是调用完成，里面的`valid=false`仍然意味着方案不可用。
评分依据最终环境状态和完整约束，不以模型宣称成功或JSON合法代替任务成功。

阅读：[模型策略](../../research/liftcut-agent/src/liftcut_agent/model_policy.py)、
[模型运行与重放](../../research/liftcut-agent/src/liftcut_agent/model_runner.py)、
[完整任务审计](../../research/liftcut-agent/coverage_rollout.py)。

练习：从G1最后一个repair任务指出`expected_single_tool_call`与实际`context_limit`
之间的关系。前者是接口最终记录，后者发生在本地模型调用前；此前重复无效方案
才是更早的行为短板。不能直接称为模型格式错误、CUDA OOM或网络失败。

## 第三遍：讲清一条轨迹如何变成训练样本

一个训练样本包含当时可见的消息与一个正确assistant目标。历史工具观察进入上下文，
最后目标的token进入监督，其他位置被mask。正确目标一致，并不意味着条件分布一致：
“首次搜索后应该验证”与“报错后应该重新验证”是不同状态。

阅读：[轨迹导出](../../research/liftcut-agent/src/liftcut_agent/trajectories.py)、
[token与loss mask审计](../../research/liftcut-agent/tokenize_decisions.py)、
[G1条件覆盖分析](../../research/liftcut-agent/analyze_g1_contexts.py)、
[G2准备](../../research/liftcut-agent/prepare_g2.py)。

练习：在一对样本中标出输入、最后目标、监督mask及前一个工具响应；说明G1的64条
clean首次validate为什么变成0。再画出G2同一目标在两个epoch的clean/repair分配。
504个唯一pair、1008次曝光、126次更新、41,788监督token是四种量，不能互换。

## 第四遍：讲清QLoRA训练与公平比较

本项目用固定基础模型与tokenizer、量化基础权重和LoRA参数进行有监督微调。
长样本探针先跑前反向而不更新，用来检查内存与初始化完整性；正式训练记录累计
目标量、输入量、loss、梯度及最终权重。权重保存、重载、归档和本机恢复各有证据。

阅读：[实际训练入口](../../research/liftcut-agent/gpu_train_g2.py)、
[冻结执行计划](../../research/liftcut-agent/reports/g2-execution-v1.json)、
[研究条件说明](2026-10-03-g2-state-coverage-pilot.md)。

练习：列出本轮固定的基础权重、初始化seed、目标、顺序、更新次数、解码预算。
解释为什么输入token仍相差约1.41%，只能称监督预算匹配。解释loss变低为什么不能
直接推出完整任务成功率提高。LoRA/SFT已经做过，DPO、Agent RL和多模态尚未完成。

## 第五遍：讲清一个负结果如何产生下一轮试验

G1观察到局部修复提高，但完整任务严重退步。事后检查发现正常首次决策监督消失，
且多条任务没有验证就误判无解。这是支持条件覆盖假设的关联，不是所有回退的完整
因果解释。G2恢复clean曝光来检验这个具体机制，仍需使用本次新repair_only作对照。

阅读：[G1失败复盘](2026-10-02-g1-complete-results.md)、
[G2门槛](2026-10-03-g2-state-coverage-pilot.md)、
[G2判定代码](../../research/liftcut-agent/audit_g2.py)。

练习：先不看结果，写下机制通过和候选通过各需满足什么。假设正常任务恢复但记忆
低于固定S0，能否宣布整体改进？若本次对照不复现上一轮退化，为什么不能换历史
对照来算收益？如果某组生成更少token却因为提前错误结束，能否称推理效率提高？

## 数据与评测检查表

| 检查维度 | 本项目中的具体检查 | 它不能保证什么 |
| --- | --- | --- |
| 标签与监督 | 正确目标、mask、目标序列、累计监督量匹配 | 条件状态分布一致 |
| 状态覆盖 | clean首次决策、报错后、真不可行、授权和记忆上下文分别统计 | 学会全部组合或长程规划 |
| 划分与泄漏 | 公共ID修正、训练与评估身份核对、保留48不读取 | 开发模板复用之外的泛化 |
| 面板与分母 | 正常12、旧诊断19、D2派生80分别核验，遗漏不静默删除 | 将111当111个独立样本 |
| 稳定性 | R1原42/43/44，G1/G2各自新seed42；保留每个案例进退 | G1/G2三seed复现或显著性 |
| 权限 | 外部确认与当前proposal绑定；记录所有自主未批准尝试 | 环境拦截等于模型没有越权意图 |
| 可恢复 | 原始SHA、实际权重、原生/环境/token回放、真实回执 | 本机断连证明云平台停止计费 |

## 讲解与简历边界

建议准备三段独立讲解：三分钟解释Agent任务与工具闭环；五分钟用一个轨迹定位失败；
十分钟解释G1→G2假设、对照、预算、门槛和局限。每段都展示一个真实文件或轨迹，
不要只念流程图。

现阶段可以描述：构建可重放工具环境，完成小模型QLoRA与配对消融，审计监督mask、
训练状态覆盖和记忆/授权回退，并建立实际权重恢复及原生token核验流程。
应按实际分工说明使用AI协助编码，自己需要能复现与解释关键设计。
不能描述为已部署的自主业务Agent、已证明的通用能力提升、独立泛化、DPO/RL收益，
也不能把局部面板涨分包装成全系统提升。G2已完整复盘，后续独立验证仍未开展；
引用G2数字必须同时说明停止退步与原门槛失败。

## G2结果练习：从失败链提出下一假设

阅读[G2复盘](2026-10-03-g2-complete-results.md)和
[保存轨迹](../../research/liftcut-agent/reports/g2-trajectory-demo-2026-10-03.html)。
先解释正常2/12→10/12为何是9获得、1丢失，再看不可行任务15次相同validate。
从原约束算出8+10>17，说明正确动作应停止；不要把外层接口标签当成根因。

再看memory_missing_time：澄清得到23分钟，却用了旧barbell记忆和25分钟方案。
区分错误器材、超时和错误证据ID三个问题。结合记忆首/中/末16/16、0/16、8/16，
解释过滤无效记录与选择最新有效记录的差别。

最后重建`boundary-review.json`：为何错误之后只有正确validate、没有正确finish？
阅读[下一方案](2026-10-03-post-g2-next-plan.md)，写出一个能否证该解释的对照设计，
以及即使停止修好了仍不能宣布整体候选成功的条件。该练习没有调用模型。

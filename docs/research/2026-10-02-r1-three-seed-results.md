# R1 三个训练 seed：局部授权收益复现，整体候选仍不成立

2026-10-02 UTC 完成原先登记的 seed42/43/44 × S0/T/M/TM。**S0→T 的读取后授权
原筛选在三个 seed 都通过，但 T/M/TM 均不满足跨三个 seed 的必要不退步条件。**
这是同一批开发状态上的训练随机性复查，不是三份独立任务测试，不证明泛化。
固定代表权重仍为 seed42，48 个保留任务未使用；没有追加 seed45。

证据入口：[seed44 的81文件归档](../../research/liftcut-agent/reports/qwen-coverage-replication-seed44-2026-10-02/README.md)、
[seed44 逐例复盘](../../research/liftcut-agent/reports/coverage-replication-seed44-review-2026-10-02.json)、
[原三seed汇总](../../research/liftcut-agent/reports/coverage-replication-three-seed-review-2026-10-02.json)、
[运行与费用](../../research/liftcut-agent/reports/coverage-replication-seed44-operations-2026-10-02/README.md)。
本次交付由 [PR26](https://github.com/Townzc/liftcut-tracker/pull/26)记录最终检查与合并状态。

## 条件与核验

云端保持 `f18cb5820881a048b19b6007fc4ca231dfd64de9`，没有部署后来添加的本地分析代码。
Qwen3-4B-Instruct-2507 固定 revision、4090 24GB、NF4/LoRA、final-only、greedy解码
及数据均不变。每组126次更新、1008次样本使用、41,788个监督token；S0/M输入含目标
1,827,888 tokens，T/TM为1,851,664。**监督量匹配，输入计算量不相等。**

seed44四组初始化相同，且与43不同；零步探针未改参数，最终重载最大logit差为0。
seed42未记录初始指纹，不补造。初始化和shuffle随训练seed共同变化，不能单独归因
为某一种随机因素。四组纯优化分别1414.251、1445.750、1417.127、1446.418秒，
合计95.392分钟；不包含加载、探针、保存、推理和计费等待。

五份归档的100个inventory条目、实际权重、124条native/environment回放及358次
真实生成的prompt/output token已在本机核验。公开包不含权重；CPU公开重放明确
只复核可公开证据，不能冒充再次读取实际权重。旧42/43分别407/409次生成，不将
44的较少调用称作效率提升：本轮多条失败轨迹提前终止。研究分母保持124条。

## 各 seed 的完整结果

读取后授权是全部授权的子集；主要记忆不含单独时长对照。不同面板不能相加成
独立成功率。写入列仅统计模型自主未批准尝试，所有已记录尝试均被环境拦截。

| seed | 组 | 完整任务 /12 | 读取后授权 /3 | 主要记忆 /8 | 全部授权 /10 | 自主未批准写入 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 42 | S0 | 10 | 0 | 6 | 6 | 0 |
| 42 | T | 9 | 3 | 4 | 10 | 0 |
| 42 | M | 11 | 1 | 3 | 8 | 0 |
| 42 | TM | 9 | 2 | 5 | 7 | 3 |
| 43 | S0 | 11 | 0 | 4 | 7 | 0 |
| 43 | T | 11 | 3 | 6 | 10 | 0 |
| 43 | M | 12 | 1 | 2 | 8 | 0 |
| 43 | TM | 11 | 3 | 2 | 10 | 0 |
| 44 | S0 | 7 | 0 | 4 | 7 | 0 |
| 44 | T | 7 | 3 | 3 | 10 | 0 |
| 44 | M | 7 | 0 | 4 | 7 | 0 |
| 44 | TM | 9 | 3 | 6 | 9 | 0 |

![seed42与44分面结果](../assets/coverage-replication-seed44-2026-10-02.png)

## 原筛选与整体候选分开判断

| 配对 | 原筛选通过次数 | 完整任务净变化42/43/44 | 主要记忆净变化42/43/44 |
| --- | ---: | --- | --- |
| S0→T | 3/3 | −1 / 0 / 0 | −2 / +2 / −1 |
| M→TM | 2/3 | −2 / −1 / +2 | +2 / 0 / +2 |
| S0→M | 0/3 | +1 / +1 / 0 | −3 / −2 / 0 |
| T→TM | 1/3 | 0 / 0 / +2 | +1 / −4 / +3 |

S0→T在三个seed都修正同三个pending/declined/revoked读取后状态，局部现象重复出现。
但是主要记忆两次变差，完整任务也曾变差；原筛选通过不能替代整体候选条件。
T→TM记忆净变化的均值恰为0，却包含−4到+3的反转；只报告均值会隐藏风险。
M→TM完整任务也有负到正的反转；S0→M的−3/−2/0不称为正负反转。

必要保护条件要求相对同seed S0：完整任务、主要记忆和全部授权无净退步，不能丢失
原正确授权案例，且没有自主未批准写入。T只在43通过、M只在44通过、TM全部失败。
**没有任何处理组跨三个seed全部通过，更没有整体晋升。** seed44 TM三项总数均
高于S0，仍丢失`sd1-consent-pending-blocked`，所以不能用净增抵消这项回退。
seed42 TM的三次越权尝试继续保留，后两轮为零不撤销历史记录。

![三个seed逐例得失与两套门槛](../assets/coverage-replication-three-seed-2026-10-02.png)

## seed44 原始调用复盘

以下为看到结果后的诊断，不补写成事前预测。原始调用位于公开包
`evaluation/{s0,t,m,tm}/{normal,diagnostic}/calls.jsonl`，动作与观察均已独立回放。

**缺失信息处理是本轮主要完整任务失败。** S0/T/M都失败于同五项：`missing_time`、
`unanswered_time`、`missing_equipment`、`missing_days`、`memory_missing_time`
（共同前缀`r2-05-`）。它们都没有请求澄清，直接get_context→get_memories→
search_exercises→validate_plan，收到`valid=false, issues=[wrong_action]`后
finish为infeasible。不是HTTP/tool异常，也不是未知引用或次数错误。

在[环境](../../research/liftcut-agent/src/liftcut_agent/environment.py)与
[评分器](../../research/liftcut-agent/src/liftcut_agent/benchmark.py)中，缺失必要字段时
正确动作应先澄清；提前交计划得到wrong_action。该业务校验以`ok=true`返回，所以
`tool_errors={}`不能解释成“没有决策错误”。缺少信息与约束确实无解必须分开。
本轮`memory_missing_time`四组都已选择正确dumbbell并引用当前memory，却未澄清
时长而失败，不能再沿用43“选择barbell”的解释。

**TM获得三例、丢失一例。** 相对T/M，TM补回missing_time/equipment/days，
却在原可解的preview例读取8分钟与10分钟的dumbbell练习后直接finish infeasible，
没有validate/propose；完整任务净增2不等于没有退步。unanswered_time虽请求了
时长，但得到awaiting_user后错误结束为infeasible。memory_missing_time仍未澄清。

**授权回退有具体形态。** seed44 TM在pending-blocked前缀后finish declined，
正确应为awaiting_user。它没有再次自主越权写入，仍是错误终态；不能把“0次越权”
等同于授权语义全部正确。S0/T/M在此例均正确。

**记忆净分掩盖了位置交换。** S0→M的4/8→4/8由两例收益与两例损失组成：
M修好无澄清/有澄清的first-expired，丢失对应last-expired；M在first四例全对、last
四例全错，错误选择barbell。其过期干扰子组从42/43的0/4变为44的2/4，不能再写
“三个seed均0/4”。这提示要继续做值/位置诊断，不证明内部注意力或检索机制。

S0→T唯一记忆损失是`sd1-memory-0-first-unconfirmed`，dumbbell变为machine。
T→TM记忆新增此例及无澄清/有澄清的last-unconfirmed，共3例，无记忆损失，但丢失
上述pending-blocked授权例。M→TM记忆新增四个last状态、丢失两个first-expired，
净+2；所有案例ID和旧seed得失见三seedJSON，不删除失败或换分母。

## 关机、成本与交付边界

容器启动代理00:59:23.910 UTC；03:06:31完成真实恢复，03:06:32完成临时回执回读
校验，03:06:33收到原子重命名成功返回，随后SSH断开。本地监控因此以SSHException
退出；研究恢复和回执发布已成功，服务端ACK消费/关机命令返回未捕获，不能手写。
另一次只读TCP检查被拒绝，不能单凭断连断言平台停止计费。

用户随后确认AutoDL **已关机，本轮费用¥4.60**。这条用户报告独立保存，未读取平台
API或发票，不捏造精确停机时间/存储分项。启动代理到断连为127.159分钟，按原单价
¥2.18/小时算得代理¥4.6201；与用户报告分开，预留¥8。原工作/硬截止未延长，没有
为取关机日志重新开机。

## 下一步和学习检查

下一步是[CPU准备D2与首版收敛方案](2026-10-02-post-r1-next-plan.md)，不增加训练seed，
不按44的分数选择代表权重。先把80例构造、参考执行、token、时限与恢复工具准备好，
经分支验收后才另报开机方案；G1仍按原错误族条件触发，未因44换题。

建议先独立解释四件事：为什么3/3局部门槛不等于可靠模型；为什么TM所有总分提高
仍被拒绝；为什么`ok=true`与`valid=false`能同时出现；为什么引用正确memory仍会
因未澄清失败。然后选一条公开calls逐步写出“当前状态→动作→返回→正确下一步”。

# D完整系统冻结与E1离线准备

I2和I3结果已交付，PR54精确`eba484078685c81f4b7cd5a7df5827c5ff3814be`全部六项检查成功后合入main `48c175f22ad061a15c8d97aa882a194c7ea5d0e4`，受检树与合并树相同。本次是离线可复现性和下一次验收准备，没有新增模型推理、训练或保留任务结果。

## 为什么冻结整套系统

I2/I3的收益来自同一权重上的系统改动。因此仅记录adapter SHA不足以复现D：若来源优先级、提示词、工具参数、批准条件或ID逆映射变化，系统行为也可能变化。本次把这些内容共同固定，避免下一轮把系统变化误归因于模型。

[候选快照](../../research/liftcut-agent/reports/candidate-d-v1.json)的契约digest为`75cfc533932cee78c473c5c3f67a576ffc5717f6270906e6192de4a2d68ec6cc`。它包含：

- 事前G4 control的adapter哈希与容器信息、基座revision及历史实际文件清单、tokenizer文件哈希、真实I3运行软件版本。
- 原生解析、NF4/BF16、贪心seed42、4096上下文和512输出上限、完整系统提示词及协议预算。
- 最新有效记忆、用户修正优先的来源解析、稳定证据别名和严格逆映射；未知新证据ID拒绝执行。
- 8工具schema、环境版本、外部批准的提案/上下文版本、同一动作和幂等键重试规则。
- 原128份冻结源、catalog和真实I2/I3发布证据，开发资格与尚无外部分布验证的边界。

创建时实际读取了本机恢复的132,187,888字节adapter及tokenizer文件，并核对父回执/索引。基座大权重此次没有重新读取，保留先前实机验证的来源，不能声称本机重新审计了全部基座。公共`--check`核对源码、公开原始证据、契约内容及创建记录，不读取私有权重。它不是第三方签名或生产安全证明。

## 实际执行与结果

[candidate_d.py](../../research/liftcut-agent/candidate_d.py)已完成真实创建和公共核验；更改提示词、工具、视图开关、权限或精度后，即使重算普通digest，也不能通过旧快照校验。缺失实际父权重不能创建新快照。

[prepare_e1.py](../../research/liftcut-agent/prepare_e1.py)仅使用原12个开发完整任务，A/D各走一次，共24个完整脚本回合、162次模拟请求。两组均12/12通过原环境重放、0阻止写入尝试；每次投影输入、原生模拟回复、逆映射和原环境动作逐项核对。进程级文件打开检查拒绝任何`test.jsonl`载入，演练没有访问48个保留任务内容。

这24次是确定性脚本与模拟token计数，**不能当作新模型24/24或E1通过**。原始8.8MB脚本记录在本机`outputs/e1-development-rehearsal-v1/scripted-development.json`；公共[准备报告](../../research/liftcut-agent/reports/e1-offline-readiness-v1.json)绑定文件SHA，CI在新目录实际重建并逐字段对比。686项完整测试在156.767秒内通过；12项新增针对测试通过，覆盖高总分掩盖类别回退、配对顺序/分组篡改、partial分母、脚本冒充模型、非法写入和未知别名。

命令从仓库根目录运行：

```powershell
python research/liftcut-agent/candidate_d.py --check
python research/liftcut-agent/prepare_e1.py --output-dir research/liftcut-agent/outputs/e1-dev-new
```

输出目录必须新建。命令没有GPU或保留集选项，不能启动正式E1。

## 下一步及尚缺内容

[E1科学协议](2026-10-13-e1-full-task-protocol.md)现已明确候选、全量新对照、48完整任务、工程门槛、预算与停止规则。下一步实现一次性保留集预约/只在正式派发后读取、实际GPU执行器、完整/partial增量恢复和故障演练；最终精确提交检查通过后，才有可执行版本。**目前`can_launch=false`，本夜不能打开保留任务，也不为此新增GPU计算。**

实际应用仍需完成[接入契约](2026-10-13-application-agent-contract.md)，不能把Python模拟环境的权限证明直接当作Web数据库已实现。学习时应能解释：系统快照、科学协议、CPU准备、真实模型结果与线上产品验收各自证明什么。

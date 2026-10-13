# Agent research progress and handoff

## 2026-10-13 19:52 UTC：E1完整验收通过，用户确认关机

[E1完整结果](research/2026-10-13-e1-complete-results.md)：新A/D均48/48，固定D七项原门槛PASS、0收益0回退；96完整任务回合/648实际模型生成，原父权重和全部环境/native/投影/逆映射/token已由冻结恢复器核验，发布时再次读取实际父权重。A是最新有效记忆视图，不是raw；D增加来源解析/稳定ID。原48共享模板且曾被结构解析，本轮已用于效果评估，不能称秘密盲测或独立泛化。无训练、无新窗口。

真回执19:46:02.335229原子发布，原服务端事件19:46:05.003930实际消费；collector因关闭竞态留下的server_consumed:null保持原样，由独立捕获的原事件补证据。19:46:06.250645通道失效；关机请求/返回未捕获，意向事件不当作命令完成。用户已回复“已关机”，[确认记录](../research/liftcut-agent/reports/e1-power-2026-10-13/user-confirmation.json)与精确计费时间分开，不再问平台或费用、不重连。唯一69085/32960均结束0。

429个GPU样本覆盖87.57%租期，覆盖区间加权利用率35.05%，最大观测显存9824MiB（非真实峰值）；租期中评估进程占比92.01%是另一指标。约40.80分钟×¥2.18/h=¥1.48255代理，预留¥5，不加重叠子窗口。D少8次读取，但输入token增加4.60%，耗时基本相同；两组各4次不可行计划经校验反馈后正确停止，不能改记为终态失败。

[下一步计划](research/2026-10-13-post-e1-plan.md)优先P1真实应用批准/撤销/幂等事务、任务覆盖与工具反馈审查；下一模型联调24任务/90分钟/预留¥4仅草案，尚未实现或开机。当前服务器保持关闭，先CPU/开发存储验证。全745本机测试和6针对通过、真实公开回放重建通过、两图已渲染检查；独立feat/e1-results包含41原始文件SHA、全48配对和完整复盘，最终精确六项CI通过后合main。146运行冻结源不改。下列“运行中/尚无E1结果/24小时保留”均为历史状态。

## 2026-10-13 19:07 UTC：E1已在独立两小时窗口真实启动

用户比较租期效率后改回“设计完成一段再开机”，并明确提供新开机消息执行E1；此前24小时保留计划不适用于本次。PR60精确`9e9387c1a4bac03b1363e38a379816cfe6cf3436`六项SUCCESS后合main`8f5b5af`，146个冻结源不变。实际只上传434804字节代码和守护（模型资产0），核验安装后唯一派发`20261013-190625`。

开机代理19:05:18、绑定trial19:06:34.568853、服务器opening19:07:24.058770、A开始19:07:24.757757（UTC）；工作20:36:34.568853、收集20:56:34.568853、最晚关机21:05:18（洛杉矶14:05）。预留¥5，¥2.18/h；完成真实备份后自动关机，不保留到午夜。原48任务的数据预约和首次读取已真实发生，不能重新派发。

A/D各48完整任务，无新训练，原门槛和实际父权重不变。结果尚未完成，不能用CPU脚本演练当成绩。额外只读观测已开始记录GPU/显存/功率与原关机文件；采样晚于A启动，起始缺口会保留，不能拿早期快照当全程平均或峰值。分析工具在独立结果分支准备，冻结restorer和推理条件不改。唯一会话、进程、原截止及现场证据路径持续写入本地HANDOFF。

## 2026-10-13 新研究日准备：E1完整任务、应用闭环、实际资源测量

用户在关机确认后提出准备好再开一个完整4090研究日。[新计划](research/2026-10-13-next-day-plan.md)按实际新opening+24小时、¥2.18/h（¥52.32时长代理，预留¥55）安排；没有新开机消息、真实授权文件或云端进程。上一晚关闭PR59已六项成功合main e885985c，旧回访保持删除。以下“未来窗口未授权”仅指当时旧状态；当前已获新研究日准备和后续迭代安排，实际启动仍等用户开机。

独立feat/e1-day-preparation将E1原120分钟试验与整机24小时截止分离。新146源执行计划只改旧143中的6个运维文件并加3个日租期/采样/分析源，科学协议、固定D、原研究源、旧v1报告不变。独立试验进程组守护包含真实armed确认和已识别孤儿子进程处理；5秒GPU采样保留缺失未知；收集器记录真实消费/关闭后立即退出，不空等。见[整日手册](research/E1_DAY_RUNBOOK.md)。

实际本机739项全套检查成功（Windows跳过11项；其中10项原生token/恢复故障已另行全部通过，1项真实Linux进程检查由CI运行），26项运维/整日针对检查中25项实际通过。96个DEV复制脚本回合、648模拟请求、实际父权重完整恢复571121字节及无权重partial均通过，0新模型调用；不是E1成绩。最终精确六项CI及新代码包实际安装后才通知开机，实际Git事实写HANDOFF。

[历史时长重建](../research/liftcut-agent/reports/prior-lease-efficiency-20261013.json)确认评估进程含加载2593.0166秒，占37979.2307秒租期6.8275%；未记录GPU采样，不能称GPU利用率。最后收集后的保留时间费用代理¥13.8883已在整夜¥22.9985内。企业一手报告的方法已落实到完整终态验收、批准/幂等、条件实验和资源指标。开机后先E1 A/D完整48任务；CPU同时做P1应用路径，后续最多两轮需真实结果触发和各自冻结/验收，不追加重复满分诊断。

## 2026-10-13 17:14 UTC：用户确认平台已关机，通宵事项闭合

用户对唯一一次平台询问回复“已显示关机”，[独立记录](../research/liftcut-agent/reports/overnight-close-2026-10-13/user-power-confirmation.json)标注本机记录时间17:14:16（洛杉矶10:14）与用户来源，不当作关机时间或平台API结果。原七份观察与summary不变；请求/返回仍未捕获，计费时间和账单不再追问。没有SSH、重开机或新实验。

PR58精确07494472f636dd4900724a82aa746af407997ec0全部六项SUCCESS，15:34:08合main6db01f647add207ad46eac6ce959130983f38f34，受检/合并树1bc435379c8de46b3f7565d18f3a74ba6b8e0d54一致；回访i2已删除。晨报/关闭说明同步后续确认，143源及I2/I3结果不改。本次确认不是新E1窗口授权，下一研发安排不变。以下“平台待回复”为当时的历史状态。

## 2026-10-13 15:03：通宵研究已交付，关闭观察完成

PR57精确52053a89024cff1e135514399a8a61dc4e4b2be8全部六项SUCCESS，10:52:49合main3d3ff639cac3a6a4b448a85d1e2709b311b941b0，树620a7bc9d4a9553b7031e395070a5bd496ea55b1一致。晨报、E1准备、真实案例学习已在截止前交付；以下旧条目的“待Git/待启动观察”是历史状态。

只启动一次61710/PID15328只读观察器，14:53:13服务器核验原guard1552和15:00截止；本机14:59:59.230673记录SSH返回-1/transport inactive，观察器结束0。随后一次无登录TCP检查被拒绝；未捕获关机请求/返回，平台电源和计费仍未知，已仅问一次是否显示关机。没有重开或重复观察器。本夜同一04:27起点至断连的成本代理¥22.998534，约¥23.00，非账单，不与I2/I3子窗口重复相加。

[关闭原始证据、哈希与局限](research/2026-10-13-overnight-closure.md)在独立docs/overnight-closure-20261013分支交付，精确提交六项全成功才合main；平台回复缺失不阻塞Git，交付后停止无效回访。原143冻结源不改，I2/I3结果与两次ACK边界不改；E1仅准备，未来独立120分钟/¥5窗口尚未授权，没有新模型/48任务评估。下一步仍为固定候选完整任务验收和真实应用闭环，条件式ETA见[晨报](research/2026-10-13-morning-agent-report.md)。

## 2026-10-13 10:34：E1执行准备已交付，真实案例学习核对

PR56精确955c24af3419e35cb83f5030405569fade88d327全部六项SUCCESS，10:30:23合main b55cd33e3ff04c7b9ad214cd4511507fecd0fc70，树一致249437ddf3096fcbb382d9b0d45fdfb575107a53；watch45619结束0。实际stage332,089字节、0资产上传，本机新目录143源/5CLI安装通过，旧基点未变。原冻结143源不改；没有新E1云端调用或授权。未来120分钟/¥5方案已准备，等待独立窗口。

当前独立docs/agent-evidence-walkthrough核对9条已发布案例/28次既有模型决策，两份公开归档哈希通过；[教学拆解](research/2026-10-13-agent-case-walkthrough.md)给出原始行号、来源/ID前后值、完整澄清、批准与撤销，以及可本机运行的只读代码。首决策正确但完整score为false的诊断范围明确说明；学习路线同步历史结构测试访问48payload的准确边界。本次没有重新读私有权重、调用模型或访问云端。晨报已有真实功能/困难/优先级/ETA，原15:00守护与14:45唯一观察器安排不变，最终电源证据未发生。

## 2026-10-13 10:15：E1完整任务执行准备；尚无E1模型结果

PR55精确d2f0837六项SUCCESS后09:43合main23d8394，树一致。当前独立feat/e1-execution-preparation新增143源执行计划，原128及PR55的3源不变。数据SHA预约先于读取、结果未知不自动重试；新未来120分钟窗口使用独立守护，不能重用本夜opening。实际96个开发复制脚本回合/648模拟请求、原父adapter读取、570170字节增量完整恢复通过；无权重演练保持partial。33项针对检查包含10项真实token故障验证；全库720检查通过（默认跳过该10项，另行跑）。最终精确六项CI/实际增量安装继续，无E1新GPU/48任务模型评估。

[原因、实现、结果、局限与下一步](research/2026-10-13-e1-execution-preparation.md)，[操作手册](research/E1_RUNBOOK.md)。静态数据访问审查发现历史load_frozen全分区结构检查会读取保留payload；修正为“未用于候选模型训练/效果评估”，不称从未读取的秘密盲测。新E1命令有拒绝test.jsonl的准备审计钩子，实际只演练DEV复制。未来规划4090最多120分钟/¥5，真实I2时长推算66.55分钟，非保证、不叠加本夜成本。原04:27..15:00/guard1552不变，14:45观察器尚未启动，实例按授权保留。


## 2026-10-13 09:21：I3已交付，完整D快照与E1科学协议完成

PR54精确eba484078685c81f4b7cd5a7df5827c5ff3814be六项SUCCESS后合main48c175f22ad061a15c8d97aa882a194c7ea5d0e4，受检/合并树一致。新feat/candidate-d-readiness冻结完整D系统，实际本机adapter及tokenizer再次核验；公共核验明确不重读私有权重/基座。[快照与准备](research/2026-10-13-candidate-d-freeze.md)绑定原128源、来源/ID投影、原生解析、8工具、权限、预算和真实I2/I3来源，科学条件没有变化。

[E1协议](research/2026-10-13-e1-full-task-protocol.md)定义新A/D各48完整任务、D至少44/48、各类3/4/各组合10/12、回退≤2及0非法写入尝试/提交/未知别名；这是共享模板保留组合迁移，不是外部分布泛化。本夜不开保留任务。下一新窗口建议4090最多120分钟/¥5，未获新开机授权，不加到本夜成本。执行器/一次性预约/恢复仍缺，can_launch=false。

实际24个DEV脚本完整回合/162模拟请求、环境/投影/逆映射回放PASS，打开test.jsonl会被准备进程拒绝；不是模型结果。12新增针对测试和686全套156.767秒PASS。[应用接入契约](research/2026-10-13-application-agent-contract.md)核对现有单次JSON生成/手工保存与新Agent批准/幂等链的缺口，尚无Web接通声明。新分支待精确六项CI；随后继续补执行准备。原15:00关机、14:45唯一观察器未启动，实例保持。
## 2026-10-13 08:42：I3真实完成，固定D通过，新ID触发C一例回退

PR53最终2576cd3六项成功后08:31:39合main48aa89d，树一致；原失败预约按实际无派发证据保存后受控启动一次。唯一19321/PID53348/controller8137/run083235已结束0，原trial08:33:45/收集09:13:45和机器15:00均不重置。28文件、64环境/native/投影/逆映射/token、实际I2父权重核验完整；真回执08:37:35.998原子发布，服务端08:37:37.512实际消费，窗口结束保留实例。原I2消费false不改写。

[I3真实复盘](research/2026-10-13-i3-complete-results.md)：C31/32、D32/32，1收益0回退。a07/uuid-739的C实际有效设备是dumbbell却选旧context machine；其它编码正确，D8组输入/输出均各自恒定。候选D按原五项门槛PASS。C32种输入、D8种各重复4，不是64独立任务/完整任务或泛化验证。全675测试149.422秒、5发布针对测试通过，实际私有权重再次核验及公开重建通过，图表实渲。

本轮代理¥0.1448包含在整夜至08:37:44的¥9.1103内；至原15:00约¥22.999，不重复相加。当前feat/i3-results准备结果交付，最终精确提交六项全成功才合main。[后续](research/2026-10-13-post-i3-plan.md)默认不再刷相同ID或seed，先做系统候选冻结、独立验收/应用接入契约和学习材料；第二GPU名额未使用，48保留任务未读取。晨报已补真实结果，最终电源仍待15:00。以下较早“无I3结果”为历史快照。
## 2026-10-13 08:08：I3首次派发前失败，已实际核对无运行残留

PR52精确62d1342六项SUCCESS后合main d3afcb1，树一致。唯一2608/run080401在第一条守护校验时发现Windows CLI把远端lease转成反斜杠，尚未上传/派发，退出1。本地原预约保留。随后一次只读核查65524结束0，服务器08:07:56实际核验原guard/15:00截止、无worker/GPU进程、无旧stage/run/ops和后续名额目录；没有新增模型调用，名额0/2。详见[失败原因、测试缺口和继续条件](research/2026-10-13-i3-startup-recovery.md)。

仅修正launch_i3的本地/远端路径类型边界，新增真实CLI及实际生成远端参数回归；14项针对检查通过。全套与完整/partial脚本恢复重新验证中，最终修复提交全部六项CI和新目录真实安装通过才受控继续一次。科学配置/旧116源/原04:27开机及15:00关机不变。当前没有I3模型结果，旧62stage不能再次执行。

修复验证补记：670项全套168.139秒通过，完整实际父权重64脚本恢复和无私有权重partial演练再次通过，新包208615字节。原失败14份文件哈希绑定、只改1源且科学字段逐项一致。当前待最终修复提交CI与增量安装，仍无新模型调用。

## 2026-10-13 07:35：I2已合并，I3执行准备

PR51精确b6a2b1615cc2b441251adef4fac51ad91dd81d79全部六项SUCCESS，于07:13:19合入main6a26c93b4db29d0cf99314d3e09f7ab0917e092e，树一致9132235543aaa84fae2a8214ea2e2d91de6cb905。无需继续轮询该PR。新独立分支准备[I3事前设计](research/2026-10-13-i3-id-robustness-design.md)和[操作手册](research/I3_RUNBOOK.md)：固定原D/G4control，C/D各32次首决策，8个既有业务锚点×4无关ID编码，不读取48保留任务。C32独特输入，D8种各重复4次；不是64独立任务。

实际I2完整证据再核验后冻结128源，原116源不变。新增量归档明确依赖原I2实际权重；新消费者等待原收集截止，保留I2原消费失败。完整和partial的64条CPU脚本演练已通过，完整恢复实际读取原权重，归档208594字节；无私有权重的演练保持partial。最初归档复制目录错误及配置解析兼容问题已在离线阶段定位修正，没有云端新调用。13项针对测试通过，全套和故障检查继续；最终精确提交六项CI及真实增量安装通过前不派发。I3当前没有模型结果、无新SSH/collector，后续实验名额已用0/2。原15:00电源及14:15计算边界不变。

准备检查补记：669项全套测试165.631秒通过，实际脚本数据的6项篡改/缺失依赖检查全部拒绝，后三项恢复故障均未产生完整回执；原始证据未变。下一步为最终Git检查和代码增量实际安装，不重新运行已通过且未修改的整套测试。

## 2026-10-13 06:55：I2完整结果与剩余证据缺口

四组真实A/B/C/D为99/105/111/111，五条配对边均0回退；预选D原机制门槛与固定S0保护均通过。D记忆48/48、ID12/12，C同分，因此不能主张N在R之上额外提高准确率。实际权重、124文件、444条环境/native/投影/逆映射回放和754次生成token恢复通过；真回执06:45:53原子发布，唯一collector20301结束0。原消费者在06:36:55因内部20分钟上限提前结束，原状态false保留；06:46:56在原收集截止内单独只读核验现存真回执与权重，未写远端文件/新ACK或修改实验。两种状态明确区分。

[完整复盘](research/2026-10-13-i2-complete-results.md)与[晨报阶段稿](research/2026-10-13-morning-agent-report.md)已填入真实功能、困难、资源和分层ETA；[下一步](research/2026-10-13-post-i2-plan.md)为预选D/C的新ID扰动小试验，目前只有CPU草稿，无新模型结果，须独立准备/冻结/CI后执行。48保留任务未使用，原I2的116源不变。12项针对测试及656项全套离线测试通过，原始发布138文件SHA绑定，两幅图已渲染核查；结果分支待最终精确提交六项CI后合main。实例按授权保留至原15:00UTC，原开机04:27与累计成本不重置。以下均为历史快照。

## 2026-10-13 05:34：I2四组已实际启动，结果待恢复

PR50精确acbba44全部五项SUCCESS后于05:33:45合并main1c3bf77，合并树与受检树相同。真实新run053401、唯一collector20301、云端controller3216；75KB代码增量实际上传/哈希核验/安装，31个已准备资产复用。A于05:34:47开始；固定116源、四组顺序、原候选D与所有门槛不变。计算/收集/实验硬截止分别06:34:46/06:54:46/07:04:46，实例保持至原15:00。运行中不修改训练或推理条件；真实444条回放、投影/逆映射/token与实际权重核验后才发布结果。新[晨报工作稿](research/2026-10-13-morning-agent-report.md)尚未填写模型结果；独立结果分支已准备发布、五条配对比较、因子交互、逐例来源/ID失败分析及图表。

## 2026-10-13 05:10：I2上传前失败已定位，准备受控继续

PR49精确99c29d6五项SUCCESS后合并ac992de；首启动050255在上传前因日志回调参数冲突退出1，没有模型派发。只读实机检查确认空暂存、无worker/GPU进程/远端预约/run，新旧数据完整；原guard1552与15:00截止保留。仅修复一个运行源，新增整条上传/核验/派发路径的离线回归，旧回调确实复现错误。保存原预约、失败冻结与真实检查后，等待修复提交检查通过，再用新实际runID启动原四组。**尚无I2效果结果**。[原因、修复、验证与下一步](research/2026-10-13-i2-transfer-failure.md)。

## 2026-10-13 整夜窗口：I2执行方式准备，尚无新模型结果

用户打开4090并明确保留到洛杉矶10月13日08:00（15:00UTC）。04:27开机代理不重置；独立guard1552已实际保护原截止，约¥22.999时长代理/规划¥25。原CPU准备及数据保留，0新I2调用。四组科学条件不变，60/20/90分钟实验时限与整夜电源分开；643测试、实际权重444条脚本恢复与partial演练通过。先最终精确提交CI再唯一启动；最多两轮有依据后续小实验，48保留任务不使用。详见[整夜事前计划](research/2026-10-13-i2-overnight-plan.md)。本夜晨报覆盖真实功能、困难、未来及分层ETA。

## 当前：2026-10-13，无卡准备已完成，等待正式4090新开机

实际准备run014645/唯一session24406退出0。PR47受检执行32fbbac五项SUCCESS后
合并main9aa7064，最终增量包3.434MB；云端31资产、114源、固定Python/七项包、
基座模型哈希、实际预选权重与输入全部通过。真正prepared.json于01:48:59上传核验。
没有I2模型调用，没有改变四组/固定权重/门槛，48保留任务未使用。

01:48:59请求关机；原始stdout实际捕获辅助返回0，SSH通道返回-1；一次TCP复核
超时后，用户确认平台显示关机。无卡费用按原01:22:28至通道返回估算¥0.04426，
非账单；原03:22:28截止及¥0.20预留没有重置。两个守护均保留至关机。
[详细why/what/result/next与局限](research/2026-10-13-i2-no-gpu-preparation.md)。

当前只待文档/证据分支最终检查交付，再通知正式4090开机；不重开无卡、不重复准备。
新GPU实际开机后使用执行32fbbac和i2-prep-20261013-014645-operations/prepared.json，
零资产上传、重核部署/CUDA、一次启动原I2四组，仍按90分钟/¥4预留并自动关机。
先前记录包含空CLI实机失败与本地PowerShell时间转换错误，均保留原事实，后者没有
SSH或预约副作用。现有I1 FAIL和泛化边界不变；以下均为历史快照。

## 当前：2026-10-13，无卡实例已开，处理平台空CLI

用户已新开无卡。开机代理01:22:28UTC，截止03:22:28、预留¥0.20不变。唯一初始
准备78239在nvidia-smi执行格式错误后退出1，尚未安装/派发；实际检查为/usr/bin/
nvidia-smi零字节、无NVIDIA设备节点、无worker/guard/准备ops。单独启动并实际
核验原截止守护1245，以保护兼容修复期间的租期；不删除或延长。

修复仅接受真实空占位文件+无GPU设备的ENOEXEC，其它错误仍拒绝；CPU准备允许
在原截止内保留至少30分钟余量的受控继续，GPU10分钟预检和所有科学条件不变。
详细观察、回归与后续触发见[无卡记录](research/2026-10-13-i2-no-gpu-preparation.md)。
先完成新源核验/精确提交检查，再检查已有进程并受控继续一次；不自动重试或重开。
当前还没有真实prepared.json，不能通知正式GPU开机。以下均为历史快照。

## 当前：2026-10-13，I2未派发，修复两阶段部署

新4090窗口首先遇到非交互PATH缺少python3，核验缓存环境/无派发后受控继续一次；
实测125MB资产上传仅约52.7kB/s，不能满足原10分钟预检。主动停止上传、核对无
worker/新run后提前关机；辅助命令返回0、SSH通道-1，用户已确认平台显示关机。
同一开机窗口时长费用代理约¥0.2815。**没有I2模型结果**，不能记为算法失败。
[完整原因、时间线和证据](research/2026-10-13-i2-startup-recovery.md)。

新流程先无卡准备（最多120分钟/¥0.20），复用核验过的实际原权重与I1 Git底座，
传增量代码/小文件；真实安装记录生成后关机，再通知用户新开4090执行原90分钟方案。
GPU阶段不上传资产，重核实际部署后唯一派发。只改3项部署源码，114源重新冻结，
四组/预选D/固定权重/门槛不变，48保留任务未用。7项部署回归及636项全套测试通过
160.554秒；444脚本回放/752脚本生成、含实际旧权重115文件完整恢复及partial边界
通过。[新准备证据](../research/liftcut-agent/reports/i2-startup-readiness-v2.json)。

精确实现提交dff058a的新包已在独立目录真实安装：31资产/114源/实际原权重全部通过，
原底座与权重不变，待传文件约3.42MB（旧包约159MB）。最终交付提交另打包复核，
最终Git检查通过才通知开无卡。尚未执行云端无卡
准备，也没有重复连接/新模型/付费API；旧窗口已关闭，未来两次开机分别记录真实时间。
[操作手册](research/I2_RUNBOOK.md)和[日志](research/EXPERIMENT_LOG.md)同步。
以下是历史进度，不能把其“等待开机”理解成跳过无卡准备直接打开GPU。

## 当前：2026-10-12，I2 离线准备

承接用户继续晨报的要求，完成[I2事前设计](research/2026-10-12-i2-source-id-design.md)
与[操作手册](research/I2_RUNBOOK.md)。四组为A=I1视图、B=稳定证据ID、C=显式来源
解析、D=两者，事前选定D。固定相同实际G4 control，各111开发状态，共444；没有
新训练、付费API、额外seed、48保留任务或服务器连接。

I1实际权重/222条native、环境与token回放已重新核验。20项针对检查和629项全套
离线测试通过175.419秒。最终CPU演练恢复115个文件（含实际原权重）、444脚本回放
及752脚本生成，消费恢复器生成的SCRIPTED回执并模拟一次关机；114源哈希与冻结
方案一致。12对历史ID输入在B/D完全一致；12个旧错的R解析值均匹配公开有效记忆。
这些是管道/表示检查，不是I2模型结果。同历史路径D输入比A多9.62%，新路径用量
与真实收益仍待测。证据见[准备记录](../research/liftcut-agent/reports/i2-readiness-v1.json)。

建议**新窗口¥4**，¥2.18/小时，准备≤10分钟、计算≤60分钟、收集≤20分钟，
从新开机代理时间起最多90分钟（费用代理≤¥3.27）。独立早期关机守护、唯一派发、
完整Git bundle/资产哈希、真实恢复后ACK、完成/失败自动关机已实现。本地新目录安装
已核验31项资产、实际权重和114冻结源，见[安装记录](../research/liftcut-agent/reports/i2-install-readiness-v1.json)。
代码与材料由[PR45](https://github.com/Townzc/liftcut-tracker/pull/45)交付；正式启动的
前置条件为该PR最终精确提交全部检查成功、新提交的迁移包核验以及用户提供新开机状态。
下一个外部动作是用户开机，不沿用10月3日旧时钟或预算。

I1机制/候选FAIL不变。D须记忆≥40/48且对新A无净退步，ID≥10/12且净增≥4，
其它能力及固定S0保护全部过关。历史I1只作复现参考；实验后审查全部111配对、
四条因素边、ID翻转、来源/记忆位置与权限错误。[日志](research/EXPERIMENT_LOG.md)
保留每步原因、实际检查、局限和下一步。以下各条是历史状态，不代表仍在运行。

## 2026-10-03 14:00 UTC：原守护已核验，截止附近断连，关闭证据缺口明确保留

唯一只读观察器54085于13:50启动，服务器实际核验原guard3560及14:00截止。
本机13:59:59.254246观察SSH返回-1、transport inactive，观察器保存记录后退出0；
单次TCP复核超时。关机请求/返回未捕获，平台电源/计费未知，已仅询问一次平台
是否显示关机，不问费用。不得把本机退出0或断连写成服务器关机返回成功。
[关闭记录](research/2026-10-03-overnight-closure.md)链接六份原始证据与哈希。
原开机至断连加早期失败，累计代理¥18.7106；非账单，窗口费用不能重复相加。
I1/G4无新增计算，48保留任务未用；后续2×2仅离线方案。晨报在14:00前已随PR43
交付，当前docs/overnight-closure补最终观察，等待本分支精确提交检查与合并。
仅剩平台状态时保留缺口、停止回访，不重开取日志。

## 2026-10-03 11:38 UTC：I1证据与晨报已合入main

PR43最终f9f99e90b1a28ece93bd15066ce0ed56da9af9e8全部五项检查SUCCESS，
包括公开I1原环境/投影/token与失败定位重建；11:38:33合并main e48af3f。
合并树与受检树1121a993a44ae140cfd03a87faacc375bc711b18一致。
全部原始证据、复盘、晨报、下一步方案已交付；本夜不再调用GPU。
原14:00UTC守护和最终关机观察仍待发生，费用与平台状态不提前确认。

## 2026-10-03 11:20 UTC：I1完整交付准备，收益明确但仍未过整体门槛

[完整复盘](research/2026-10-03-i1-complete-results.md)、
[晨报](research/2026-10-03-morning-agent-report.md)、
[下一步方案](research/2026-10-03-post-i1-plan.md)。新raw/view全111状态62→99、
37收益0回退；记忆11→42/48、旧记忆6→8/8、ID2→6/12，正常/授权/修复/停止保留。
原ID门槛10/12未过，固定S0 ID7→6也失败，所以机制与候选均FAIL，不晋升。
111状态含首决策诊断，不是111个完整独立任务；48保留任务未使用。

剩余6个记忆错误是原始context覆盖筛选后的有效值；6个ID错误则在投影输入只改
记录/记忆ID后产生，12对中6个成败/动作翻转。raw仍无翻转，不改写G4历史结论。
实际输入350550→341220 token，两组各189次生成；不声称稳定延迟改善。

冻结restorer已检查实际固定权重、222回放、378生成/token、投影输入和55文件。
11:04:38原子发布真实回执，服务器11:04:40消费，本地11:04:45收集器40727结束0。
窗口代理¥0.8408；含早期失败的累计至此¥12.3441，重叠不相加，非最终账单。
本地发布/实际权重复核/公开metadata重建通过，2幅图已实际渲染核查；607全测试加
2项新ID规范化检查通过。PR43待本次最终精确提交的全部检查，不能提前合并。

原14:00UTC电源守护保留；本夜不再跑第三个试验、不重启或用保留任务。
下一步仅离线准备来源优先级与稳定证据别名的2×2对照，新GPU窗口另行开机。
关机请求/返回/断连/平台状态与Git最终交付仍待实际记录。

## 2026-10-03 10:53 UTC：I1唯一派发，原始组完成、视图组正在推理

PR42精确2bf816a全部5项检查SUCCESS后合并63a84c0，合并树与受检树一致。
冻结98源保持原样；唯一collector40727从隔离工作树派发run104045，云端10170。
实际start10:41:37.327382，工作11:31:37.327382、收集12:01:37.327382 UTC；
evaluate-raw于10:41:49开始，evaluate-view于10:51:57开始。
未见完整I1结果、恢复或回执，不能提前写成功率。
启动实际核对原guard、空闲GPU、G4真实ACK、事前control权重及唯一reservation。
原14:00关机与¥20累计预留不变，48保留任务不用，也不追加第三轮实验。

独立结果分支准备发布、全111配对分析和图表；6项发布边界测试通过，
全套607项测试通过（171.559秒），实际数据集成待收集。
真实恢复之后才填入结论、晨报和下一步。
新raw/view均有模型调用；同状态反事实token不能替代新raw实际成本。
此轮是确定性工具视图的系统干预，不是新增训练或模型学会了时序推理。

## 2026-10-03 10:22 UTC：G4已合main；I1真实参考已冻结，等待最终检查

PR41最终bae5723五项SUCCESS，合并7b810a8且树一致。I1独立分支合入main，保留双方
全部CI与日志；98源再次核验与原CPU演练一致。实际G4完整恢复重新审计通过后生成
reference，固定预注册新control权重adb76deb…；原机制/候选失败为真实触发。
raw/view各111新推理，40/48记忆、净增12、ID10/12及S0保护不变；系统干预不冒称
新训练。完整CPU合同595测试与222脚本回放的边界保留，最终精确Git检查待过。
尚未派发I1；路径配置已准备，不含密码，后续唯一派发仍检查原guard/无worker/实际
G4服务器ACK和时间。原14:00UTC/累计¥20、48保留任务未用；无第三轮实验。

## 2026-10-03 10:05 UTC：G4真实结果已恢复，整体候选失败

[G4完整复盘](research/2026-10-03-g4-complete-results.md)：新control/permuted记忆11/48→20/48，
旧记忆6/8→4/8，ID2/12→4/12；正常12/12、授权、修复/不可行4/4和零误停均保留。
全111状态13收益/4回退，62→71；最新记录首16/16、中4/16、末0/16，剩余28记忆错误
全部选旧有效项。两组ID改名均无成败翻转，不能把低绝对分等同于ID捷径。
原机制与固定S0整体保护均FAIL，不晋升模型。完整126步/最终权重复现历史G3，但正式
比较采用本次新control；48保留任务未用，无独立泛化主张。

固定恢复已检查2实际权重、222 native/environment回放、378生成及token；09:51:04
真实回执消费，唯一collector7427结束0。原14:00 guard保留，服务器依授权仍ON。
累计至收集代理¥9.6670（含先前失败），与G4窗口¥2.9610重叠，不相加，也非最终账单。
图表已实际渲染核查，原始文件/全111逐例表已发布；PR41最终精确检查与合并待完成。

下一步按事前I1条件：固定G4新control做raw/view各111条新推理，确定性最新有效记忆
投影属于系统干预；真实参考/独立冻结/CPU/Git全检查和时间条件齐备才唯一启动。
晨报已更新G4事实，I1与最终关闭仍待实际证据。历史状态按时间保留下方。

## Offline follow-up preparation while G4 is still training

2026-10-03 08:45 UTC. G4 sole collector7427/PID37388 remains live; no new model
result yet. PR41 preparation heada37ae9d passed all5 checks but remains draft.
Independent I1 projection transport now records both raw policy and actual model
inputs.3 focused checks reject missing/tampered/wrong-arm inputs and token counters;
the pinned-tokenizer CPU drill replays222 scripted native/environment episodes and
376 generation records.79 view requests change. These are protocol checks, no model
benefit and no complete weight/archive recovery. Running87 G4 sources stay unchanged.
I1 still requires the real G4 trigger, preselected control weight hashes, separate
freeze and full recovery readiness, enough original time and a unique authorized
dispatch. See the conditional pre-plan and journal. No cloud intervention occurred.

## Current: G4 train-control started under the original overnight power guard

2026-10-03 UTC. PR40 passed all5 checks at10a729e, merged678e3dc, merge/head tree
verified equal. Corrected single launcher/collector7427 installed frozen87 sources
and26 prepared files, then dispatched controller6321 in newrun082710. Actual trial
start08:29:35.210056; work cutoff10:29:35.210056, collection11:14:35.210056 UTC.
The actual cloud event records train-control starting08:29:57.076904. No G4 outcome
is available yet. Old failed080715 attempt is retained, not relabeled as training.

Existing independent guard3560 still protects14:00 UTC/07:00 Los Angeles. Original
05:35 boot, cumulativeCNY20 and rate2.18/hour remain unchanged. No duplicate launcher,
extra seeds, expansion, paid API, reboot or reserved48. Running frozen conditions
must not change. Full artifacts/true local restoration precede any complete claim.

The independent result branch prepares publication, all111 paired case comparisons,
memory-role/position and false-stop analysis, figures, and a
[morning report draft](research/2026-10-03-morning-agent-report.md). The report explicitly
keeps G4 results and final shutdown pending.6 publication-boundary tests pass; the full591-test suite passes174.449s.
A [conditional I1 pre-plan](research/2026-10-03-i1-memory-view-draft.md) is saved before
seeing G4 results; its pure memory-view helper is not imported by any G4 runner.
3 unit checks and an offline projection of189 historical G3 requests pass;79 requests
change. This is no new inference/performance evidence and authorizes no immediate I1
dispatch. Next: actual G4 restoration, pre-registered gates, then decide whether an
independently frozen system comparison fits the original lease.

## Current: inspected G4 pre-dispatch path failure; portable fix awaiting final checks

G4 PR39 passed all5 checks at389527f and mergedbe528c3. Attempt080715 ended before
training at08:08:12: Windows serialized a remote path with backslashes, so the first
remote hash command returned127. [Original evidence](../research/liftcut-agent/reports/g4-startup-2026-10-03/README.md)
includes08:12:26 read-only inspection: no reservation, no G4 run, no workers or GPU
compute processes; guard3560 still alive to14:00. No unknown training outcome.

Fix branch separates explicit POSIX remote paths from host paths.8 focused tests
pass, including Windows/Linux path assertions and compiled bootstrap commands.
A new execution-source hash is frozen; training data/order/gates are unchanged.
Final-source full CPU restoration passed; next is exact-head CI then one new
staging/operations directory, not automatic relaunch. Originalboot/CNY20/hard14:00
remain. Morning report draft is prepared; G4 outcomes are still pending.



## Current preparation: G4 fresh paired memory-order coverage under the continuous lease

G3 PR38 passed all five checks at8db43ba and merged02069c4; merge tree verified equal.
The separate `feat/g4-memory-order` branch freezes the
[G4 design](research/2026-10-03-g4-memory-order-design.md) and
[operating procedure](research/G4_RUNBOOK.md). Both new seed42 arms retain the G3
stop_half recipe; only memory list order changes. Historical G3 never replaces the
new complete control. Two full preparations match26 files;248/1008 exposure contexts
change while target/order,126 updates,41,788 supervised and1,879,075 input tokens match.
The paired primary gate and every stopping/consent/fixedS0 protection are pre-registered.

CPU production phases replay222 scripted native episodes/376 generation records;
local restoration uses unchanged historical T weights as a container, not G4 training.
580 offline tests pass175.137s, with7 final focused operating tests passing after the
launcher review. Real G4 weights/performance, cloud transport and final exact-head CI
remain pending. Frozen execution covers87 sources; completed G3 sources stay unchanged.

The continuous lease retains the real05:35 boot and separate trial timestamp. One
durable dispatch reservation prevents automatic duplicate launch; existing14:00
guard identity must be alive. Work<=11:45 and collection<=12:30, original cumulative
CNY20 unchanged. New bounded archive reads are unit-tested, not yet a measured network
speed improvement.48 reserved tasks remain unused. Next: exact-commit checks, isolated
dispatch, actual restoration and paired case analysis; morning report by14:00 UTC.

## Current: G3 complete and restored; overnight lease continues for the next isolated pilot

2026-10-03 UTC. [Complete G3 review](research/2026-10-03-g3-complete-results.md):
stop_half passes the original stopping mechanism gate, stop_all fails with one false
stop; BOTH fail overall candidate guards. Normal12/12 each, true infeasible4/4 each,
repair4/4 vs3/4, D2 memory11/48 vs15/48, ID2/12 each. Historical G2 is not a fresh
complete control; identical initialization/shared12 steps remain prefix evidence only.
All111 comparisons preserve half8 gains/19 losses and all9 gains/17 losses. No promotion.

Frozen restoration verified two actual132,187,888-byte/504-tensor weights,222 native
episodes and376 generations/tokens. Recovery49175 ENDED0; genuine receipt atomically
published07:13:23 and consumed by the separate overnight handoff07:13:24. Old controller
consumption remains unobserved. [Public evidence](../research/liftcut-agent/reports/g3-seed42-2026-10-03/README.md)
preserves copied bytes, original collector history and inspected handoff failure/repair.
Figures rendered and visually checked. Cumulative boot-to-collection proxyCNY3.575,
prior failed openingCNY0.363 separate; server deliberately stays ON under the authorized
14:00UTC/07:00Los_Angeles guard and cumulativeCNY20 lease. No shutdown/billing-stop claim.

Next: keep the stop_half recipe, prepare a fresh complete control plus a train-only
memory permutation intervention. Preliminary CPU rebuilds are identical for32 memory
scenarios/12 orders and unchanged targets; this is not new model evidence. Freeze the
new design/continuous-lease controller before launching.48 reserved tasks stay unused,
no paid API/expansion/reboot. Finish exact-head PR38 checks/Git delivery, then the new
focused branch; deliver the requested capability/shortfall/development/ETA report by14:00.

## Historical: authorized overnight window; G3 recovery collector and new power guard active

The maintainer explicitly confirmed Los Angeles 2026-10-03 07:00 / UTC14:00 and a
cumulative CNY20 reserve at2.18/hour. [Overnight plan](research/2026-10-03-overnight-plan.md)
supersedes the old end-of-G3 shutdown policy, not the frozen G3 scientific conditions
or its08:05 compute cutoff. Subsequent evidence-driven pilots are authorized inside
this continuous lease, after preparation and a new Git freeze. No expansion, paid
API, reboot or reserved48; leave the last45 minutes for backup and the morning report.

At06:28 the tool no longer recognized8131; a06:30 process inspection found no old
Python collector. Its exact loss time/cause is unknown. The06:31 cloud observation
confirmed training continued: stop_half126 updates/111 evaluation episodes written,
stop_all85 updates. Both shared12-step records match; complete local replay is pending.
The101,777,408-byte old partial and original events are retained untouched.

Inspected recovery49175 started in a NEW064210 directory, without launching training.
At06:49:10 the replacement14:00 guard3560 and completion watcher3561 were actually
armed outside the frozen checkout. The monitor validated the original binding,
verified the retained archive prefix against the cloud, and resumed a copy. It reports
evaluate-stop_all started06:39:27. Actual final restoration/receipt and controller
handoff were initially pending. Watcher3561 then failed because it misclassified the
old power guard child as a training worker. An inspected correction exempts only that
exact saved guard identity; real workers/PID reuse remain blocked. One foreground
repair completed the actual handoff06:58:51; guard3560 remains, no collector/training
restart. Original failure evidence is retained. Full573 tests pass170.865s;9 publication
tests cover the additional separate-consumer evidence. Final exact-head CI and complete
local model restoration are pending. Frozen74 source files are unchanged; draftPR38 remains open.

## Historical: G3 second opening is training; result publication tools prepared

2026-10-03 UTC. After the first opening was closed, the user explicitly reopened.
New opening20261003-053547 uses checked eaa1325 unchanged. Assets resumed only after
matching the remote prefix, installation verifies30 assets, launch returned0 at
05:38:12, train-stop_half started05:38:28. Actual boot05:35:00.409447 fixes
work08:05:00.409447/hard08:35:00.409447 UTC; CNY8 reserve and2.18/hour unchanged.
Sole launcher/collector8131, quiet g3-seed42 heartbeat active. Never launch twice.

[Original startup snapshot](../research/liftcut-agent/reports/g3-seed42-window-2026-10-03/README.md)
at05:49:49 shows55/126 updates, GPU100%,16141MiB, both hard guards alive. stop_half
shared12-step reproduction and initialization match G2; this is prefix evidence,
not a freshly retrained complete historical control or a model-quality result.

New publication/analysis/plot tools preserve raw evidence, omit only model weights,
require the genuine complete restore receipt and replay, and retain all111 per-arm
case comparisons (including the one diagnostic control omitted from110 gate-panel
cases). Original mechanism/candidate gates remain unchanged. Eight focused tests
pass; full suite565 tests pass in348.347s. Final exact-head CI and complete model
evidence remain pending for this new result branch.
Both real complete results remain pending;48 reserved tasks unused. First startup
failure/estimateCNY0.36 stays in history; PR37 passed all5 checks and merged27541b6.

## Historical: G3 ready for a new opening; first setup window failed before training

Updated2026-10-03 UTC. PR36 merged; all five checks passed exact execution commit
eaa132538fefdf28973d808dd56a159e19b86d67, including real-tokenizer reconstruction.
Final local delta installation now verifies30 assets/74 frozen sources, original
4041159 base unchanged. [Startup failure](research/2026-10-03-g3-startup-failure.md)
records the first user-opened window: offline known_hosts sandbox access initially
failed, then passed with authorized access; local installation rehearsal consumed
paid setup time. Sole launcher77742 connected at05:18:55; actual earlier boot
05:09:28 fixed setup cutoff05:19:28. Asset transfer ended on EOF05:19:27.877189,
launch_issued=false, no dispatch file, zero training/evaluation/model calls.

Hard/prelaunch guards were armed, shutdown execution was not retrieved; later user
confirms AutoDL OFF. Cost proxy599.458175s×2.18/hour=CNY0.3630, excludes storage/not
invoice. No active collector or heartbeat; no restart or fee/status question needed.
Preserve failed-opening evidence and partial staging. The next NEW opening can use
the existing checked bundle directly through one maintained launcher; do not repeat
local clone/rehearsal while billed or reset deadlines. Existing CNY8,10/150/180-minute
conditions remain. G3 model outcomes are still unrun;48 reserved tasks unused.

## Historical: G3 data, gates and execution chain ready on CPU; only exact-head CI precedes a server request

Updated 2026-10-03 UTC. [G3 design](research/2026-10-03-g3-stop-boundary-design.md) implements
local stage A of the post-G2 plan. `prepare_g3.py` replays the four train-only infeasible
scenarios with one really executed invalid `validate_plan` (visible result: only
`wrong_action`) before the unchanged `finish(infeasible)` target; the injected call is
not supervised. Two arms: stop_half (4 clean / 4 after-invalid stop exposures) and
stop_all (0 / 8). Decisions 1008, updates 126, supervised tokens 41,788, target
sequence and sample order equal G2 coverage_mix; input tokens +0.03%/+0.06%.
Only 4/8 exposure offsets change; the first changed optimizer step is 13.

Plan changes, written before training: the control reuses the complete G2
coverage_mix run instead of retraining it, because G1 repair and G2 repair_only
reproduced all 126 losses and identical adapter weights. Reuse is valid only if each
G3 arm reproduces G2's first 12 logged losses/gradient norms bit-for-bit; otherwise the
comparison is historical only. The saved arm becomes the stop_all dose arm.
Per-arm mechanism and candidate gates and the carry-forward rule are frozen in
`prepare_g3.gates` and [g3-preparation-v1.json](../research/liftcut-agent/reports/g3-preparation-v1.json).

[Memory audit](research/2026-10-03-memory-arrangement-audit.md): training contains only
VOU/VUO/OXV/XOV record orders (V latest valid, O older valid, U/X distractors). All 24
coverage_mix D2 memory errors fall in unseen OVU/OVX/OUV and all choose the older valid
record; S0/T show the same pattern. Interpreted post hoc as a position template, not
revision comparison. Training-coverage and deterministic-view routes stay separate.

Verification: a pure-Python tokenizer stand-in (development only, not committed)
reproduced the published mask audit and regenerated all nine G1 pool files matching the
G2 freeze; G1/G2 pools and the G3 stop pool are byte-identical across two builds;
CI regenerates everything with the real tokenizer.

Execution chain ([runbook](research/G3_RUNBOOK.md)): G2's proven runner, collector,
restore and launcher are reused with G3 arms and a pool/+stop/ prepared layout.
`gpu_train_g3.py` writes `control-reproduction.json` after step 12; `audit_g3.py`
scores each arm against the published G2 evaluation and forbids paired claims without
reproduction. CPU drill: 222 scripted episodes, 376 real token reconstructions, early
archives, container restore with unchanged historical T bytes, local receipt and stub
shutdown; synthetic logs correctly fail reproduction. Controller dry-run, offline monitor
preflight and a delta-bundle install rehearsal from G2 commit 4041159 pass. 23 targeted
and 557 full regressions pass. [Readiness](../research/liftcut-agent/reports/g3-readiness-v1.json).
No GPU, model call, paid API or reserved-48 read. Next: push the branch, exact-head CI,
merge, final local stage, then request a new window (estimate 85-90 min, CNY3.1-3.3,
CNY8 reserve, 150/180-minute limits).

## Historical: G2 complete; stopping regression blocks both original gates

Updated 2026-10-03 UTC. [Complete G2 review](research/2026-10-03-g2-complete-results.md)
publishes both actual new weights' restoration provenance,222 native/environment
episodes and439 generated-token records plus3 local context refusals. Frozen4041159
and all57 sources remain unchanged. Normal2/12→10/12, repair3/4→4/4 and premature
false-infeasible8→0 improve, but true infeasible2/4→0/4. Original mechanism FAIL;
candidate FAIL also retains fixed-S0 memory24/48<26/48 and ID6/12<7/12 protections.
The current control reproduces historical G1 repair weights and111 outputs exactly;
it is not another training seed and does not replace the current paired comparison.

Post-hoc scheduled coverage has64 clean and64 after-error validation targets, but
all8 infeasible target exposures remain clean-search-only. Four D2 infeasible
cases loop8 times; normal infeasible loops15 times before a local context refusal.
Memory first/middle/last16/16,0/16,8/16: all24 wrong selections choose older-valid
records. [Next local plan](research/2026-10-03-post-g2-next-plan.md) isolates stopping
contexts before any new GPU request, and tracks memory as a separate intervention.
No G3 training, extra seeds, paid API, reopening or reserved48 evaluation.

Full genuine receipt atomically published02:20:03.957246UTC; collector ended on
connection loss02:20:04.704871 after successful backup. Server ACK consumption and
shutdown return remain unobserved. Later user confirms AutoDL OFF, recorded separately.
Compute proxy5062.821401s×2.18/hour=CNY3.0658≈3.07; excludes storage, not invoice.
There is no active cloud run and no further platform/fee question is needed.

Evidence, plots, saved G2 trajectory viewer, research journal and next plan are
delivered through [PR35](https://github.com/Townzc/liftcut-tracker/pull/35).
Final exact-head checks precede merge; operational closure proof is kept locally.
The [research index](research/RESEARCH_INDEX.md) links all experiments and the
[learning guide](research/AGENT_LEARNING_GUIDE.md) now includes G2 failure exercises.

## Historical: G2 seed42 running; result tools prepared without changing frozen execution

Updated 2026-10-03 UTC. User opened the server for the bounded G2 pilot.
[Execution record](research/2026-10-03-g2-seed42-window.md) preserves the actual
opening, launch and read-only observation. Exact checked4041159 runs on4090 with
the original dependencies;25 assets verified. Earlier container boot00:55:41.883470
fixes work03:25:41.883470/hard03:55:41.883470 UTC, CNY8 reserve at2.18/hour.
Sole launcher/collector15554; train-repair_only started00:58:05.474359. Snapshot
01:03:00 shows23/126 updates, GPU100%/16139MiB,3126-token no-update probe passed and
both hard guards alive. No complete G2 training/evaluation result yet.

Publication, paired-case/normal-chain/history-repeat analysis and figures are
prepared on the result branch.8 focused checks and527 full regressions pass (613.921s); all57 frozen G2 sources remain
unchanged. Real-weight/222-case/native/token restoration must precede publication;
partial/scripted evidence is rejected. Preserve the fresh current control even if
it differs from historical G1. Quiet heartbeat follows this window only. Complete
or fail means automatic shutdown and persistent data retention, then review and
final exact-head checks before merge. Fees use duration estimates, not invoice requests.
No new seed, API, expansion, reopening or reserved48 evaluation.

Local learning delivery: the [research index](research/RESEARCH_INDEX.md),
[guided learning checks](research/AGENT_LEARNING_GUIDE.md) and saved G1 trajectory
viewer now connect the experiment history to24 audited paired normal episodes.
Browser checks exercised preview, external user approval, end-of-trajectory and
repeated-invalid/context-guard displays.3 additional focused tests pass; the HTML
is rebuilt byte-for-byte in CI. These are saved G1 traces, not new G2 results.

## Historical: G2 state-coverage pilot prepared locally; waiting for a new server opening

Updated 2026-10-03 UTC. Following the user's new instruction to continue improving
until GPU is needed, [G2](research/2026-10-03-g2-state-coverage-pilot.md) tests a
specific G1 failure hypothesis. A fresh repair-only control sees each correct
target twice with repair history; a fresh coverage-mix arm sees it once with clean
history and once with repair history. First-epoch scenario assignment is balanced
within category/error strata and reverses in epoch2. Targets, index order,1008
exposures,41,788 supervised tokens and126 updates are matched. Input tokens differ
by1.41%; no claim of exactly equal compute. T remains on, M remains off.

Two independent CPU preparations match all9 original G1 pool files. Coverage-mix
restores64 clean first-validation targets and retains64 after-error validation
targets.21 focused regressions and519 full regressions passed;222 scripted
native/environment episodes and376 generation records passed the production-path
drill, including actual historical-weight container restoration and stub shutdown.
These are CPU contract checks, not new G2 training/performance or a live GPU probe.
[Readiness evidence](../research/liftcut-agent/reports/g2-readiness-v1.json) and
[runbook](research/G2_RUNBOOK.md) record the operating boundaries.

The mechanism screen requires full-task recovery, fewer premature false-infeasible
stops, preserved repair, all true infeasible/consent cases and zero unapproved
write attempts. Candidate eligibility additionally retains original fixed-S0
memory/normal/ID protections. G1 remains a failed historical result; no automatic
additional seeds. All111 cases are reused development states, reserved48 unused.

Final exact-commit checks/merge and actual local staged-bundle installation precede
the new opening request. Reserve CNY8 at2.18/hour; planning proxy131 minutes/CNY4.76,
work150/hard180 minutes from original boot proxy, ten-minute setup allowance.
No current cloud run, server connection or model calls. G1 PR33 merged, platform OFF
is user-confirmed and its heartbeat is paused. Fees use recorded duration estimates;
do not repeatedly request invoices. Keep the research index/demo/learning deliverables.

## Historical: G1 pilot complete; original gate failed, stop expanding training

Updated 2026-10-02 UTC. [G1 complete results](research/2026-10-02-g1-complete-results.md)
publish both fresh seed42 adapters' actual restoration, 222 native/environment
evaluations on 111 reused development cases, and 384 true generation token audits
plus one local context refusal. Frozen execution29d8d7f and all36 source files are
unchanged. Repair improves1/4→3/4, but full tasks9/12→2/12 and true infeasible4/4→2/4;
D2 memory27/48→19/48. No unapproved write attempts, yet no candidate passes protections.
G1 fails its original pilot gate. No G1 seeds43/44, G2, seed45 or held-out48 run.

Post-hoc CPU audit found all64 clean first-validation targets moved behind error
feedback; clean-search supervision retains only4 infeasible targets. Eight full
tasks falsely terminate infeasible before validation. This supports a conditioning
coverage hypothesis, not proven causality or an explanation of every memory error.
One repeated-invalid-plan trajectory ends in a local context refusal, not OOM.

Genuine recovery receipt atomically published22:34:50UTC, connection ended22:34:56.
User subsequently confirms platform OFF; server ACK consumption/shutdown return
remain unobserved. CNY2.9962 compute estimate uses boot-to-disconnect4947.849707s
at2.18/hour, excludes storage, not an invoice. Per user preference, estimate from
recorded duration rather than repeatedly requesting actual fees. No active cloud run.

[Next CPU work](research/2026-10-02-post-g1-release-plan.md): research evidence index,
saved-trajectory demonstration, data/state coverage checklist and learning report.
S0 stays the fixed comparison baseline; publish negative findings with limits.
Independent evaluation remains unfinished; 48 reserved tasks stay untouched.
Current result delivery is [PR33](https://github.com/Townzc/liftcut-tracker/pull/33);
merge only after all checks pass on the final exact head, then close the G1 heartbeat.

## Historical: G1 seed42 paired pilot prepared; final Git/launch staging before new opening

Updated 2026-10-02 UTC. D2 [PR31](https://github.com/Townzc/liftcut-tracker/pull/31)
merged after all five checks passed exact33ebe5806401418ff09c5937b2d44c8c1a1b0639;
main23aa8a6 has the same tree. [G1 preparation and operating plan](research/2026-10-02-g1-pilot-readiness.md)
now implements the original triggered T-control/T-repair pilot, both fresh seed42
from the pinned base, both error families retained, T on/M off. Two independent
preparations match all9 files. Each arm has504 correct decisions,41,788 supervised
tokens across two epochs,126 updates; input tokens differ by2.9% and are reported.

The shared production/drill path passed222 environment episodes and376 scripted
native/token records. A complete recovery drill used unchanged historical T bytes
only as container artifacts, synthetic training/probe counters and stub shutdown;
these are not G1 weights, GPU memory measurements or performance.18 focused checks
passed;488 full local regressions passed in170.088s. Offline launcher preflight and
the five-phase no-output dry-run passed. Final exact-head CI belongs to the delivery PR.

Next: final checked bundle installation and a NEW user-opened4090 window. Reserve
CNY8 at2.18/hour; expected about two hours, work150/hard180 minutes from the earlier
user/container boot proxy, ten-minute setup allowance; no storage expansion/API.
Use [G1 runbook](research/G1_RUNBOOK.md), a new run/ops ID, genuine actual-weight/
222-case/token restoration, then automatic shutdown and analysis. Original pilot
gates, fixed representative42 and48 untouched reserved tasks remain; no G1 result,
seed43/44 training authority or independent generalization claim yet.

## Historical: complete D2 audited; G1 paired-training readiness next

Updated 2026-10-02 UTC. Frozen3e4d8e2 completed all four original seed42 arms.
The real restorer verified51 inventory files, original adapter bytes,320 native/
environment episodes and340 generations/tokens. [Complete review and next plan](research/2026-10-02-d2-complete-results.md)
retain every paired gain and regression. Memory S0/T/M/TM=26/27/25/22 out of48;
consent=6/12/8/9 out of12; repair=1/1/1/1 out of4; infeasible=3/4/4/1 out of4.
TM made3 unapproved apply attempts, all blocked with writes0. No treatment is promoted.

Fixed T prematurely declares both unknown-evidence repair variants infeasible;
the original G1 behavior trigger is met for that family only. Next prepare two
fresh T-control/T-repair training runs from the pinned base, with identical correct
target tokens and both original error families. Freeze schedule,111 evaluations
per arm, recovery/controller/launch checks and CNY8 reserve before a new opening.
Original pilot gates and48 untouched reserved tasks remain. No G1 model result yet.

Real receipt was atomically published18:12:18 UTC and SSH then disconnected.
Server ACK consumption/shutdown and provider billing remain unobserved/unconfirmed;
user confirmation is pending. This opening's compute proxy is CNY0.7297, separate
from prior failures, not an invoice. No active cloud window or deadline extension.
Local publication audit rechecks actual weights;470 regression tests passed before
the final descriptive additions. Final precise-commit checks are in the delivery PR.

## Historical: D2 partial S0 audited; controller/CPU integration repaired

Updated 2026-10-02 UTC. The new opening successfully deployed06654db and completed
S0: memory26/48, identity7/12, consent6/12 (defer4), repair1/4, infeasible3/4.
Archive registration then failed due to a duplicated `path` argument; T/M/TM
never ran. The real partial archive and integrity-only receipt were recovered
and published before connection loss. Platform shutdown/billing remain unconfirmed;
this window's compute proxy is CNY0.2620, separate from the earlier CNY0.6463.
See the [full analysis and repair](research/2026-10-02-d2-partial-results-and-repair.md).

Subsequent local audit verified80 native/environment episodes,84 generations and
original weights; it did not upgrade the partial receipt. Latest valid memory in
first/middle/last positions scores16/16,2/16,8/16. Twenty of22 memory errors choose
an older valid value. ID renaming produces two opposing case flips despite equal
totals. These are fixed-seed S0 development observations, not treatment effects.

The v2 repair shares the production phase/archive loop with the CPU drill and
supports offline incremental Git installation from the existing clean06654db base.
All scientific conditions remain identical to v1; only reviewed control/deployment
sources change. The320-case CPU drill passes real archive registration, native/token
replay and full scripted recovery. All465 local tests passed in157.652 seconds;
the exact CI metadata-only path also reproduced all80 S0 cases and84 generations.
Final exact-head CI and an actual final bundle
roundtrip must pass before another opening. Next: a new complete four-arm D2 window
with CNY5 reserve and unchanged90/120-minute limits, preserving this partial run;
no result selection, G1, extra training/API or reserved48-task use.

## Historical: D2 startup failed before inference; local startup fixes prepared

Updated 2026-10-02 UTC. The first D2 opening ended before any controller/model
launch. A wrong local tokenizer interpreter and slow/repeated bundle upload
exhausted the original ten-minute launch allowance. The operator requested
shutdown at07:44:15 UTC after observing no launch/run and GPU0%/0MiB. Shutdown
helper stdout0 and SSH disconnect are recorded; platform-off/actual billing remain
unconfirmed. Compute proxy to the RPC return is CNY0.6463, excluding storage.
See the [failure review and evidence](research/2026-10-02-d2-startup-review.md).

A maintained local launcher now separates pinned tokenizer Python from transport,
verifies/resumes matching remote prefixes, shares one connection with collection,
and arms an additional boot+10-minute prelaunch shutdown guard before bulk upload.
Eighteen new CPU regression checks passed; real local preflight reverified the
eight original adapter files. All456 local tests passed in160.914 seconds, and the
frozen execution plan passed source/actual-weight verification. Exact-head CI
evidence belongs to the delivery PR. Mock transport tests are not live-server
integration evidence.

The checked cloud execution remains06654db287a5d51c4aad6bf57fcee40d21555afc;
local startup changes do not refreeze inference conditions. No D2 results,
new training, API calls or reserved-task reads occurred. After final checks and
Git delivery, request a new user-opened window using the updated
[runbook](research/D2_RUNBOOK.md), fresh ops/run paths and verified old staging
bytes. The new CNY5 reserve is additional to this failed opening's actual or proxy
cost; original90/120-minute limits remain. Analyze actual D2 evidence before any G1.

## Historical: D2 execution and recovery ready for the bounded server window

Updated 2026-10-02 UTC. The [D2 operating readiness record](research/2026-10-02-d2-execution-readiness.md)
and [operator runbook](research/D2_RUNBOOK.md) now cover fixed calibration, actual
adapter/runtime binding, boot-relative deadlines, partial denominators, staged Git
deployment, per-arm collection, independent restore and real receipt publication.
The final checked PR commit is the cloud execution input; merge only after every
check passes. Historical f18 R1 code and evidence remain unchanged.

The CPU operating drill replays320 episodes and352 scripted native responses with
the real pinned tokenizer; it independently recomputes272 forecasts and rechecks
the original eight adapter files (528,755,732 bytes). Complete archive restoration
and local receipt consumption use the actual restorer, with a stub shutdown.
These are oracle contract checks, **zero new model calls**, not improved agent
scores. CI metadata mode has no weights and cannot emit a complete restore ACK.

Next: notify the user to open the same4090 for the fixedseed42 four-arm D2 window,
after final GitHub checks/merge and local staging. Reserve CNY5 at2.18/hour,
90-minute work/120-minute hard cutoff from original opening; no expansion,
downloads, new training, paid API, seed45 or reserved-task evaluation. Remote disk,
assets and runtime are still conditional live checks because the server is off.
After launch, collect complete/partial evidence, shut down, review paired gains and
regressions and only then assess the unchanged G1 gate. Platform billing remains
distinct from an SSH disconnect or successful shutdown request.

## Historical: R1 shortfalls audited; D2 CPU contracts verified

Updated 2026-10-02 UTC. The [shortfall audit and D2 contracts](research/2026-10-02-shortfall-audit-and-d2-contracts.md)
replay all144 normal traces and bind each training arm's504 decision/token pairs.
Planning with unresolved fields occurs0/0/16 times across seeds42/43/44. Sixteen new
CPU interventions preserve each emitted plan and request only fixture-permitted
clarification:10 plans become valid,3 require day re-planning,3 still lack a user
answer. These are environment interventions, not autonomous model recovery.

Each arm has32 clarification targets (time/equipment/days24/4/4),1,592/41,788
two-epoch supervised tokens, and zero decisions after any of the three audited
validation-error families. Exposure gaps are hypotheses, not proven causal effects.

D2 now has80 deterministic states with actual prefixes, ID bijections, feasibility
proofs, reference execution/replay and first-response/continuation scoring. Two
independent preparations match byte-for-byte; the pinned tokenizer's longest
handoff/reference request is2,295 tokens (2,807 including output reserve). This
is CPU contract evidence only. Fixedseed42/320 planned episodes/544 maximum calls
and48 untouched reserved tasks remain unchanged. No new model calls or rental.

Next complete the bounded GPU controller, fixed calibration, partial-result
collection, recovery receipts and shutdown drills; **do not open a server yet**.
The existing staged D2 reserve remainsCNY5,90-minute work/120-minute hard limit;
G1 still requires the original D2 behavior trigger. No training intervention was
silently substituted for G1.

## Historical: original three-seed study complete; CPU D2 preparation queued

Updated 2026-10-02 UTC. The frozen f18 seed44 four-arm window completed; five
archives, actual weights, 124 native/environment episodes and 358 generations
passed local restoration and token reconstruction. Public evidence and the
original42/43/44 review are available in the [complete R1 results](research/2026-10-02-r1-three-seed-results.md).

| seed44 arm | Full task | Read-history consent | Main memory | All consent | Blocked writes |
| --- | ---: | ---: | ---: | ---: | ---: |
| S0 | 7/12 | 0/3 | 4/8 | 7/10 | 0 |
| T | 7/12 | 3/3 | 3/8 | 10/10 | 0 |
| M | 7/12 | 0/3 | 4/8 | 7/10 | 0 |
| TM | 9/12 | 3/3 | 6/8 | 9/10 | 0 |

Original screens S0→T/M→TM/S0→M/T→TM pass3/3,2/3,0/3,1/3. No treatment passes
the necessary candidate guard across all three seeds. T's memory effect is−2/+2/−1;
T→TM is+1/−4/+3. Seed44 TM gains net task/memory counts but loses the previously
correct pending-blocked consent case. Preserve every failure, the fixed seed42
representative, and48 unused reserved tasks. These are repeated development states,
not independent-task generalization or a promoted model.

The genuine receipt passed temporary-upload/readback/hash checks and atomic rename
at03:06:33 UTC; SSH then disconnected. Server ACK consumption and shutdown return
were not captured. The user subsequently confirmed AutoDL was off and this run
cost CNY4.60 (reserve8), separately recorded as user evidence, not an inspected
invoice. The boot-to-disconnection compute proxy is CNY4.6201; exact shutdown time
and storage breakdown remain unknown. No reboot or deadline extension occurred.
[Closure evidence](../research/liftcut-agent/reports/coverage-replication-seed44-operations-2026-10-02/README.md).

Next: [CPU clarification audit and D2 construction/readiness](research/2026-10-02-post-r1-next-plan.md),
then a separately bounded fixed-seed42 inference window. D2/G1 remain unimplemented
and unexecuted; do not request opening yet. No seed45, paid model API or held-out
evaluation was added. Local regression passed384 tests in154.069s; the real public
replay and three-seed derivation passed. Final exact-head CI/merge are tracked by
[PR26](https://github.com/Townzc/liftcut-tracker/pull/26).

## Historical: seed44 launch and late seed43 closure evidence

Updated2026-10-02 01:16 UTC (project date2026-10-01 America/Los_Angeles).
The user explicitly opened the instance for the prepared seed44 window. Frozen
f18 controller started01:04:03 UTC,279.291392s after the container-start proxy;
S0 is training. Work cutoff03:29:23.910 UTC, hard shutdown03:59:23.910 UTC;
CNY8 reserve and prior CNY2.18/hour assumption, storage separate. The local PR25
collector and seed44 heartbeat are active. No completed seed44 score is available.
[Execution record and evidence](research/2026-10-01-seed44-execution.md).

Read-only acquisition on this newly user-opened instance also found the old
seed43 server ACK=true and shutdown-command returncode0 at20:59:18.321598 UTC.
[Late evidence](../research/liftcut-agent/reports/coverage-replication-seed43-late-closure-2026-10-02/acquisition.json)
supplements, rather than rewrites, the original observations. Platform power/billing
stop and actual invoice remain unverified; the new opening does not prove them.

Next: authentic actual-weight/124-episode/token restore, genuine receipt, shutdown
observations, seed44 publication and the original42/43/44 descriptive review.
Do not change frozen conditions, extend the window, add a seed or run D2/G1 yet.
Representative seed42 stays fixed and48 reserved tasks remain unused.

## Historical: seed44 local collector verified before the user opened the instance

Updated2026-10-01 America/Los_Angeles (CPU logs2026-10-02 UTC). The
[seed44 local monitor and handoff](research/2026-10-01-seed44-monitor-readiness.md)
implements explicit seed/window bindings, early verified downloads, fresh actual
restoration on every attempt, and genuine receipt temporary upload/readback/hash/
atomic publication without overwriting a final receipt. Ambiguous publication,
server acceptance, shutdown request and provider state remain separate facts.
The cloud continues to use frozenf18; only the local collector is new.

Two freshly generated replication preparations match all seven historical files;
the eight frozen sources matchf18; two seed44 ten-phase dry-runs create no output.
Local full regression passed359 tests before the final review fixes; all32 final
monitor and15 receipt tests then passed. A real historical seed43 restore through
the new orchestration verifies actual weights,124 replays and409 token records,
followed only by simulated in-memory SFTP publication. No real SSH/GPU/model call
or reserved-task read occurred. [Readiness evidence](../research/liftcut-agent/reports/seed44-monitor-readiness-2026-10-01.json).
Final exact-head CI and merge must pass before launch; use the associated PR record.

The next GPU work is original seed44 four-arm replication: RTX409024GB, current
price confirmation, CNY8 reserve,150-minute work/180-minute hard deadline from
the newly authorized opening. First obtain the already-requested previous
AutoDL power/billing confirmation and the user's new endpoint/opening time.
No automatic reboot/reconnect, disk expansion or change of experimental conditions.
Old r1-seed43 heartbeat stays paused. D2/G1 remain unimplemented;48 reserved tasks
unused; representative seed42 fixed. D2/G1 follow the plan after the R1 review.

## Completed seed43 and subsequent planning (historical record)

Updated 2026-10-01 UTC. The frozen `f18cb5820881a048b19b6007fc4ca231dfd64de9`
four-arm experiment completed. Five archives, actual weights, all124 native/environment
replays and409 recorded generations passed local recovery/token verification. The
[results and next steps](research/2026-10-01-coverage-replication-seed43-results.md),
[81-file public evidence](../research/liftcut-agent/reports/qwen-coverage-replication-seed43-2026-10-01/README.md)
and [single-seed review](../research/liftcut-agent/reports/coverage-replication-seed43-review-2026-10-01.json)
retain every gain and regression. This is the second completed training seed, not
three-seed replication or an independent-task evaluation.

| seed43 arm | Full task | Read-history consent | Main memory | All consent | Blocked writes |
| --- | ---: | ---: | ---: | ---: | ---: |
| S0 | 11/12 | 0/3 | 4/8 | 7/10 | 0 |
| T | 11/12 | 3/3 | 6/8 | 10/10 | 0 |
| M | 12/12 | 1/3 | 2/8 | 8/10 | 0 |
| TM | 11/12 | 3/3 | 2/8 | 10/10 | 0 |

Both original T pairs pass in seed43; neither M pair does. S0→T main-memory effect
changes from−2 in seed42 to+2 in seed43. M→TM has net-zero memory with two gains and
two losses; T→TM loses four memory cases. T meets the necessary candidate protections
in seed43 only; seed42 regressions remain. Do not promote a version or replace the
fixed seed42 representative checkpoint with the more favorable seed43.

Local restoration completed20:59:18 UTC. The connection dropped during genuine
receipt upload; client confirmation, remote ACK consumption and shutdown return
were not captured. A subsequent SSH-port check failed. **Provider power/billing
stop remains unverified**, and user platform confirmation is pending. No reboot for
logs. Boot-to-disconnection compute proxy≈CNY4.80 at CNY2.18/hour, or≈CNY5.01 through
the later failed-port-check observation bound; neither is an invoice or final cost.
Storage is unknown/separate. Original150/180-minute deadlines were not extended.
[Operation observations](../research/liftcut-agent/reports/coverage-replication-seed43-operations-2026-10-01/observations.json).

Publication/review code passed322 local tests; real public replay independently
passes124 episodes and token reconstruction while explicitly omitting private
weights. CI now checks the new evidence and exactly reproduces the derived review.
Final exact-head CI and merge status are recorded by [PR #23](https://github.com/Townzc/liftcut-tracker/pull/23).
The GPU never ran the later CPU analysis changes.

PR23 merged at21:21:42 UTC after all five checks passed exact head4deaf997; main
feff1b1 has the same checked tree. The old heartbeat is paused; no live monitoring
or server transport remains. Platform confirmation is still pending, not inferred
from connection loss.

The [post-seed43 review and next plan](research/2026-10-01-post-seed43-review-and-next-plan.md)
now details the execution order: local atomic receipt/seed44 monitor preparation →
original seed44 four-arm window → D2 on the fixed seed42 adapters → conditional G1 →
frozen validation and release. Only S0→T can still reach the original3/3 pair screen;
all current treatments already fail the across-seed necessary candidate guards
because of seed42. Do not cancel44, replace the representative seed, or erase a
regression based on44's result.

D2's60 memory/ID cases will share30minutes, including any clarification answer,
to avoid confounding equipment-value changes with infeasible tasks. Old23-minute
cases remain unchanged. Formal80-case construction, token/state audit and the new
receipt-transfer CPU checks are not implemented in this planning increment; do not
request a GPU opening yet. The original two G1 error types have not both repeated
across observed normal-task seeds, so G1 remains conditional on D2 and paired data.
The plan adds an explicit pre-D2 budget trigger: both fixed variants in at least
one intended error family must show valid failure-to-repair behavior in old T,
with executable references and paired-data audits. This is a new planning rule,
not a retroactive claim about v2 or evidence of cross-seed stability.
Remaining R1+D2 reserve is CNY13; with all conditional G1 windows it is CNY37, not
blanket spending authorization, and excludes H1/storage. Seed44 alone remains CNY8.
No new model call or reserved-task read occurred during this review.

## Pre-launch R1 handoff (historical record)

The following readiness and earlier study entries are retained as historical
context. Their “next” and “not yet run” statements describe those earlier stages;
the section above is the current handoff.

Recorded 2026-10-01 before launch. Milestone then: **R1 versioned seed43/44
execution implemented; CPU/Git verification before the next GPU window**.

The [R1 execution handoff](research/2026-10-01-coverage-replication-execution.md)
records commands, runtime pins, seed/arm/source bindings, automatic budget cutoff,
actual-weight restoration and learning checkpoints. The new paths preserve all
historical runners and reports. Seed42 is an equivalence check only; GPU launch
accepts 43/44. See the [CPU readiness evidence](../research/liftcut-agent/reports/coverage-replication-readiness-v1.json)
and the dated journal for verification results; CPU tests do not prove new model
performance. No new server connection, training, inference or paid API call occurred.

Local validation: **302 tests passed (448.131s)**; two independent preparation
outputs match across all seven files; both ten-phase dry-runs create no execution
directory; 244 documentation links pass. GitHub CI/merge evidence is the increment's PR.

Next window: seed43 × S0/T/M/TM on an RTX 4090 with the original runtime, then a
separate seed44 window. Each requires a newly confirmed endpoint and opening time,
at most three hours from boot / CNY6.54 compute proxy / CNY8 reserve at CNY2.18/hour.
Storage is separate. Work stops at minute150; backup and automatic shutdown follow.
Do not reopen the old server to finish local publication or change historical logs.

Current next-experiment authority: [follow-up design v2](research/2026-09-29-followup-experiment-design-v2.md).
The new CPU audit reproduces memory subgroups (expired distractor S0/T/M/TM:
4/4, 3/4, 0/4, 2/4), a single correct equipment value in all eight main probes,
and zero training decisions following unknown-evidence or session-count validation
errors in each exact 504-row pool. There are four genuine infeasible finish targets
per arm. These are coverage observations, not causal explanations or new model results.
[Machine-readable analysis](../research/liftcut-agent/reports/state-coverage-followup-analysis-2026-09-29.json).

Decision: retain all four arms for seed43/44 replication, separate old screening
from prospective candidate admission, then conditionally run 80 new development
probes per existing adapter and a paired feedback-repair training study. Future
candidate admission vetoes any autonomous unapproved-write attempt and requires
no net loss across full-task/memory/consent panels, with no lost correct consent case.
Old scores and gates remain unchanged; no existing treatment qualifies as an overall
improvement. No new paid run or reserved evaluation has started. New CPU runner,
manifests and budget dry runs are implemented; use only a final CI-passed commit
when opening a new window. D2/G1 remain later conditional stages.

| Arm | Complete dev task | Read-history consent | Main memory | Autonomous blocked writes |
| --- | ---: | ---: | ---: | ---: |
| S0 | 10/12 | 0/3 | 6/8 | 0 |
| T | 9/12 | 3/3 | 4/8 | 0 |
| M | 11/12 | 1/3 | 3/8 | 0 |
| TM | 9/12 | 2/3 | 5/8 | 3 |

Only S0→T passes the original T screening gate; neither M pair passes. TM attempts
unapproved writes in three related pending cases, all blocked by the environment;
do not promote TM as a reliability candidate. Complete-task regressions, all paired
gains/losses and descriptive interactions are retained. Single seed42 and reused
development states remain limitations; the 48 reserved tests are unopened.

All four adapters have 126 updates and 41,788 exactly matched target tokens each.
Five archives / 88 files, actual weights and 124 native/environment replays passed
off-instance verification before ACK upload by 08:31:34 UTC. All 407 actual generations
also pass pinned-tokenizer prompt reconstruction/output decoding; no context guards.
The server executed immutable `30fd396` and passed 264 tests. Publication/analysis
code passed **281 local tests in 95.671 seconds**; its changes were not deployed into
the running GPU experiment. Four explicit scripted proposal repairs pass validation
but add zero model successes or writes.

SSH/SFTP closed after ACK; a subsequent connection was refused by the 08:32:21 UTC
observation. ACK consumption, shutdown return and provider power/bill were not
independently observed. Boot-proxy-to-check compute proxy ≈¥4.75 at ¥2.18/hour,
within the three-hour ¥6.54 compute cap / ¥8 reserve; storage unknown and separate.
No server job or connection remains under management; do not reopen for CPU work.

Read the [full results](research/2026-09-29-state-coverage-results.md),
[what/why/result/next journal](research/EXPERIMENT_LOG.md) and
[case walkthrough](research/RECOVERY_STUDY_WALKTHROUGH.md).
Publication and remote checks: [PR #20](https://github.com/Townzc/liftcut-tracker/pull/20).
The [replication proposal](research/2026-09-29-coverage-replication-plan.md), now clarified
by [design v2](research/2026-09-29-followup-experiment-design-v2.md), needs versioned
seed43/44 implementation and CPU/CI gates before another server window.
Two proposed three-hour windows imply ¥13.08 compute / ¥16 reserve, not new spending.
The separate proposed inference diagnostic reserves ¥5; conditional repair training
reserves ¥8 for its pilot and ¥16 for two more seeds only if it passes. The proposed
cumulative ceiling through those stages is ¥45 plus storage, excluding held-out and
external evaluation. This is staged planning, not a blanket spending authorization.
[External transfer preflight](research/2026-09-29-external-transfer-preflight.md)
remains a future independent-source validation option; no external dataset/model run.

Previous fixed-state diagnostics are completed, restored and reviewed.
C/R consent decisions: 5/10 and 6/10; memory decisions: 2/9 and 1/9. These are
first-decision development diagnostics, not complete-task or held-out scores.
All 38 continuations replay; 44 actual model generations in that earlier increment.
The 21-file archive was verified locally before acknowledgment; actual v2 adapter
backups were rehashed. SSH/SFTP then closed; provider power/billing remains
unverified. Boot-to-connection-check compute proxy ≈¥0.42 at ¥2.18/hour.
That increment passed 248 local CPU tests; the executed frozen server code passed 240.
Read the [research journal](research/EXPERIMENT_LOG.md),
[results](research/2026-09-29-state-diagnostic-results.md) and
[next design](research/2026-09-29-state-coverage-next-plan.md).
That design has now executed as the four-arm study above; its new results do not rewrite earlier conclusions.
See the [release criteria and schedule](research/2026-09-29-research-release-criteria.md)
for the remaining 3–5 week first-release estimate and evidence gates.

P2 recovery-v2 remains completed and backed up.
U/C/R normal success: 0/12, 10/12, 11/12; controlled continuation: 1/9, 8/9, 9/9.
The recovery gain is one case in one error family, below the preregistered gate.
All 63 episodes replay and 42 archive files, including both actual adapters, were
verified off-instance before the shutdown acknowledgment. Connections closed;
provider power/billing was not independently observed. See the
[results](research/2026-09-29-controlled-recovery-results.md) and
[next diagnostic design](research/2026-09-29-state-diagnostic-plan.md).
The hosted protocol matrix remains pending.
Canonical plan: [research roadmap](AGENT_RESEARCH_ROADMAP.md).
P0 delivery: [PR #7](https://github.com/Townzc/liftcut-tracker/pull/7).
P1 offline delivery and remote check status: [PR #8](https://github.com/Townzc/liftcut-tracker/pull/8).
Model adapter and hosted pilot delivery: [PR #9](https://github.com/Townzc/liftcut-tracker/pull/9).
Full hosted baseline, audit and remote checks: [PR #10](https://github.com/Townzc/liftcut-tracker/pull/10).
Protocol revision, data/tokenizer audit and remote checks: [PR #11](https://github.com/Townzc/liftcut-tracker/pull/11).
Portable AutoDL workspace, GPU pilot and diagnostic evidence: [PR #12](https://github.com/Townzc/liftcut-tracker/pull/12).

## Implemented in the first increment

- [x] Persist the technical roadmap and repository instructions for future sessions.
- [x] Keep personal career preparation in a local, Git-ignored companion document.
- [x] Audit historical measurements and document missing evidence without changing
  reported numerical results. [Audit](research/2026-09-28-evaluation-audit.md)
- [x] Author 30 synthetic **development** seeds across six categories.
- [x] Implement strict proposal evaluation, alternative-valid-answer acceptance,
  missing-result accounting, group overlap checks, and input hashes.
- [x] Implement a deterministic structured-input baseline and JSONL score/export CLI.
- [x] Add regression tests and a Python CI job alongside existing product checks.

## Verification evidence

- Current follow-up increment: all **286 local CPU tests pass (404.204 seconds)**,
  including five new regressions for the secondary analysis. Its `--check` reproduces
  from hash-matched 504-row training pools; 147 local documentation links were checked.
  No new model execution or score changes. The CI tokenizer job now checks this analysis.
- Previous publication: all 281 CPU tests pass. All 124 real episodes and 407 native
  generations replay, five archives / 88 files and actual weights were verified off-instance.
  Public inventory excludes weights; tokenizer CI independently checks every saved prompt
  and output ID. Grounding/session-count script repairs explicitly add no model success.
- Previous CPU-preparation increment: all 264 tests pass (16 new). Four training arms execute
  and replay 72 scripted episodes each, with 504 identical correct targets. T/TM
  add 80 context-only reads and 64 terminal/apply targets after reads; M/TM balance
  position × invalidity at eight scenarios per cell (two per training bundle).
  Two independent real-tokenizer preparations match exactly, with target masking,
  sample order and per-update target budgets verified. A synthetic native-response
  fixture audits all 124 planned evaluations and five-archive restore/ack; this is
  CPU contract evidence, not GPU execution. Tests reject altered native text, weights,
  training counters, missing archives, forged comparisons and added blocked-write
  cases hidden by aggregate counts. The bounded controller dry run makes no GPU call.
- Previous increment: all 248 CPU tests pass (8 new). Published synthetic evidence
  has an exact hash inventory, complete native/environment replay and a reproducible
  descriptive review. Tests reject changed evidence and forged review summaries.
  The server executed frozen commit `992ac9a`, passed 240 tests and reproduced the
  diagnostic preparation. All 38 continuations and 21 backup files were verified
  off-instance before acknowledgment. Both actual v2 adapter backups were rehashed.
  A retrospective audit of SHA-matched training pools reproduces missing read-to-finish
  transitions and correlated memory coverage; these are hypotheses, not causal proof.
- Previous increment: all 240 CPU tests pass (25 new). Two independent fixed-state
  preparations match all file, prefix and real-tokenizer hashes. The reference
  contract passes 19/19 and replays; this is scripted verification, not model
  performance. New tests exercise a synthetic 38-state native-response audit and
  archive/restore/ack flow, plus unknown usage, denied writes, complete read-batch
  execution, source-value attribution, tampering, missing cases and deadlines.
  The one-hour controller dry run makes zero GPU calls. Both restored recovery-v2
  adapter weights and configurations match their recorded SHA256. New GPU entry
  points are implemented but have not yet executed on a server.
- Previous increment: all 215 local CPU tests pass, including saved real-episode
  replay, restoration-index, clarification-order and tamper checks. The executed GPU source passed all 208
  server tests and all GitHub checks before launch.
  Two independent local preparations and server preparation matched all frozen
  data/token hashes. All 63 real episodes and raw generations now replay; actual
  adapter hashes and 42 restored files were verified. Publication inventory and
  the complete descriptive review reproduce locally. See the
  [execution specification](research/2026-09-29-controlled-recovery-experiment.md).
- Previous increment: 197 local CPU tests pass; the new forensic report reproduces
  from both previously prepared directories and replays all 144 recovery/probe
  episodes. No new GPU/API execution or adapter-file verification. The previous
  increment verified 87 full-backup files off-instance. See the
  [deeper review and next plan](research/2026-09-29-recovery-review-and-next-plan.md). The entries below retain
  their historical verification scopes rather than replacing earlier results.
- Python 3.11.5: `python -m unittest discover -s research/liftcut-agent/tests -v`:
  155 tests passed locally and on AutoDL Python 3.12.3 before shutdown. Subsequent
  offline audit and shutdown-path regressions expand the local suite to 161;
  neither suite needs GPU execution for unit tests.
- `python research/liftcut-agent/benchmark/build_dev_seeds.py --check`: authored
  definitions match all 30 checked-in rows.
- `python research/liftcut-agent/run.py validate`: 30 valid cases, all in `dev`.
- `python research/liftcut-agent/run.py baseline`: 30/30 deterministic contract
  checks passed. This is **not model or multi-turn Agent performance**.
  [Saved report](../research/liftcut-agent/reports/proposal-contract-baseline-2026-09-28.json)
- `python research/liftcut-agent/benchmark/build_interactive_seeds.py --check`:
  all 14 authored interactive development fixtures match.
- `python research/liftcut-agent/interact.py run`: fixed workflow 14/14 passed;
  no-memory control 12/14; no-retry control 11/14. These are scripted environment
  checks, **not model performance or training ablations**.
- All 14 saved traces replay with identical observations, state digests and scores.
  [Experiment and artifacts](research/2026-09-28-interactive-environment.md)
- Model adapter: 14/14 offline smoke tasks and replay, through 97 synthetic replies.
- Authorized hosted pilot: `deepseek-flash`, non-thinking, `interactive-008` only:
  1/1 passed and replayed, 8 API calls, one write, no blocked attempts, and recovery
  from the injected response-loss timeout. Reported usage: 15,579 input and 513
  output tokens; conservative rate-based cost estimate $0.0052893, reservation
  $0.0371136 against a $0.30 guard. This is not a reconciled bill or broad model result.
  [Protocol, executed experiment and raw evidence](research/2026-09-28-model-policy.md)
- Full hosted development run: **8/14 passed**, fixed workflow 14/14; 70 API calls,
  129,573 input and 3,769 output tokens, estimated $0.0433947, reserved $0.3177774
  against a $0.75 guard. All 14 raw-response/environment traces replay, including
  failures. Five responses violated the single-call contract; one termination
  label failed without a write. No prompt/grader changes or reruns during the run.
  [Full analysis](research/2026-09-28-development-baseline.md)
- Offline audit of pilot and full run: 78 distinct requests, usage complete,
  combined estimate $0.0486840. Accuracy stays separate per run. This is neither
  a provider bill nor an account balance; duplicated artifacts are rejected.
- Four protocol profiles each completed 14/14 workflow mock tasks through 97
  synthetic responses; all four arms audited and compared offline. The mock emits
  single calls; separate protocol tests exercise accepted/rejected real batches.
- Exported 59 development decision rows from eight verified successful hosted
  episodes; six failed episodes remain excluded. Invalid decisions in otherwise
  successful recovery traces remain context, not positive targets.
- Pinned Qwen3-4B-Instruct-2507 tokenizer revision
  `cdbee75f17c01a7cc42f958dc650907174af0554`: CPU audit verified 104,177 masked prompt
  tokens and 2,766 supervised tokens across 59 decisions; max sequence 2,973/4,096,
  no truncation. That increment used no weights or training job; the subsequent
  GPU pilot is described below. [Pipeline evidence](research/2026-09-28-protocol-and-data-pipeline.md)
- The four-arm paid comparison was blocked before process creation by the local
  execution-policy gate, including after budget confirmation. It has no live
  results or additional spend; the previous 8/14 baseline is unchanged.
- Previous increment's local product checks: `npm test` passed 47 existing tests.
- Previous local `npm run lint`: zero errors; two existing unused-variable warnings in the legacy
  `generate_seed_cases.ts` script.
- Previous local `npm run build`: successful production build, including TypeScript and 21 pages,
  using public placeholder authentication configuration.
- Relative documentation links and `git diff --check` passed. Remote verification
  is recorded by the pull request's `agent-research` and `quality` CI jobs.

The seed suite covers schedule, equipment, time budgets, missing information,
infeasible constraints, and evidence IDs. Catalogue time costs are artificial.
No model/API or paid GPU training was used in the first two increments.

## Implemented in the second increment

- [x] Reset/step/observation/terminal-state contract with bounded agent steps.
- [x] Eight typed tools for context, memory, lookup, clarification, validation,
  preview, confirmed application and termination.
- [x] Separate simulated user events; confirmation bound to preview/context
  versions, revocation, and idempotent application after response loss.
- [x] Highest confirmed unexpired preference revision, with explicit user
  corrections taking precedence.
- [x] Before-call and after-commit timeout injection with bounded workflow retry.
- [x] Full action/observation traces, strict replay and separate reporting of
  attempted invalid calls, blocked writes, tool errors and final outcomes.
- [x] Fixed workflow and intentionally limited controls; checked-in reports and
  full fixed-workflow traces; CI run/replay checks.

## Limitations and open evidence gaps

- The hosted reference has one complete public-development run. A real 20-step
  QLoRA compatibility pilot and corrected local-model development comparison have
  run; neither establishes generalization. Repeated training, a larger SFT data
  study, external evaluation, DPO and online RL remain pending. The revised
  protocol has local GPU evidence; its paid hosted four-arm matrix remains blocked.
- The environment is an in-process synthetic harness. It is not a production
  authorization layer or a sandbox for untrusted Python policies.
- Structured constraints are supplied; natural-language extraction is not measured.
- Evidence IDs are checked for existence, not semantic relevance or entailment.
- The baseline shares constraint helpers with the grader. Regression mutations and
  alternate valid answers test the contract, but are not an independent research
  validation or an expert review of the scenario design.
- All 30 proposal and 14 original interactive seeds remain public dev data.
  Recovery-v1 freezes 24 train / 8 dev / 16 test scenarios by constraint/persona
  bundles, but all 48 contain category hints in visible record/memory IDs. Its
  original scores are contaminated diagnostics. The opaque-ID probe reuses tasks
  and already-trained adapters; it is not corrected training or independent/OOD
  validation. Shared authorship, behavior templates and catalog also limit claims.
- Token usage and latency instrumentation is implemented; mock values are
  synthetic. Repeated live-model reliability remains unmeasured. Fixed-workflow
  controls are not model ablations.
- Historical 293-case results and training artifacts remain unreproduced in this
  increment; follow the audit recovery checklist before using stronger claims.

## Implemented in the third increment

- [x] Native single-function-call model policy; strict JSON parsing without repair,
  truncation/refusal/multiple-call errors and unchanged environment arguments.
- [x] Shared request, output-token and monetary reservation limits; unknown usage
  stops further requests without disappearing from task denominators.
- [x] Credential-redacted raw responses, request histories, model/config identity,
  usage, estimated cost, latency and per-request incremental logging.
- [x] Recorded-response replay rebuilds requests and environment transitions;
  paired fixed-workflow counts and failure categories are reported.
- [x] 14/14 mock tasks and replay through 97 synthetic responses; local loopback
  HTTP and failure tests; credential-free CI smoke and replay.
- [x] Preflighted, executed and replayed a hosted reference pilot for interactive-008
  under the maintainer-authorized $0.30 reservation guard. Saved all eight request/
  response records and the environment trace from a clean source commit.

Detailed protocol, commands and limits: [model adapter](research/2026-09-28-model-policy.md).

## Implemented in the fourth increment

- [x] Committed protocol/config before the full 14-case hosted run; unchanged
  prompt, tools, scoring and task order; preserve all original failures.
- [x] Saved all 70 raw response records and 14 traces from clean source
  `e9ebb2111c09cc8d2b995b52275d8b9ae497eab8`; full offline replay is consistent.
- [x] Diagnosed five initial `get_context` + `get_memories` responses rejected by
  the single-call parser, plus a pending-approval outcome-label failure.
- [x] Added replay-backed report audit and deduplicated spending ledger; no pooled
  task accuracy, mock spending, or zero-cost substitution for unknown usage.
- [x] Added 18 audit regression tests and credential-free CI artifact auditing.

## Implemented in the fifth increment

- [x] Backward-compatible versioned single/read-batch protocols and separate
  pending-approval prompt factor; one tool step per call, no batched mutations.
- [x] Frozen four-arm experiment, aggregate-budget preflight, sequential runner,
  unknown-usage stop, complete-arm audits and paired comparison CLI.
- [x] Offline workflow matrix, historical replay and 14 protocol regression tests.
- [x] Replay-verified decision export, family/persona lineage and positive-target
  filtering; 17 data/comparison tests, including invalid-decision recovery.
- [x] Actual CPU tokenizer/mask check with hash-pinned public files and isolated
  dependencies; optional CI job reproduces the published report without weights.
- [x] Detailed [GPU pilot and budget](research/2026-09-28-small-model-pilot-plan.md):
  proposed 4090/24GB, four-hour maximum, CNY 30 ceiling. Subsequently executed on
  a maintainer-started instance as recorded in the sixth increment.
- [ ] Execute the frozen paid protocol matrix: already authorized aggregate USD
  2.40 reservation, but the execution environment rejected launch twice. Do not
  repeatedly request the same authorization or work around the execution gate.

## Implemented in the sixth increment

- [x] Connected to the maintainer-started 4090; verified 16 vCPU / 120GiB cgroup
  limits, 50GB data disk, CUDA/BF16 and pinned isolated dependencies.
- [x] Immutable per-commit server checkouts, push-disabled origin, relative cache
  setup, environment inspection and explicit data/run SHA-256 handoff manifests.
  SSH endpoint configuration stays locally ignored; no credentials in Git.
- [x] Downloaded 8.06GB of pinned public model files; checked LFS hashes and
  reproduced the exact 59-decision tokenizer report on server Python 3.12.
- [x] Ran 20 NF4/QLoRA steps in 218.47s; 504 adapter tensors updated, finite loss/
  gradients, 11.50GiB peak allocated memory (23.04GiB reserved), identical logits
  after adapter reload. This is compatibility evidence, not generalization.
- [x] Preserved the initial native-interface defect and its raw outputs; fixed
  mapping of assistant prose plus tool calls without repairing free-form actions.
- [x] Backed up the final adapter, optimizer/RNG state and experiment inputs/logs
  off-instance; verified both archive SHA-256s and all 39 selected artifact hashes.
- [x] Corrected native-interface development replay: unadapted 6/14; adapter 10/14.
  Training-overlap group: 4/8 to 8/8; remaining public dev group: 2/6 to 2/6.
  Adapter adds three blocked write attempts and repeated unnecessary clarifications;
  do not claim generalization or uniformly improved reliability.
- [x] All 32 saved episodes replay; offline audit links raw generations, messages,
  token/report counts, adapter identity and deterministic training sampler totals.
- [x] Executed platform shutdown through Bash at 22:50 UTC; command returned 0,
  SSH closed and a follow-up connection was refused. Approximate GPU fee CNY 1.77,
  no expansion; actual provider bill remains unverified. Added a guard fix for the
  platform's no-shebang shell script; the original timer was not a verified hard cap.

The stopped server retains experiment checkouts `d399e8e` and `ef865ed`. The final
offline audit/runbook/shutdown guard were committed after shutdown. On the next
boot, prepare the reviewed full commit from main before using the updated guard;
do not assume the cloned instance automatically pulled newer GitHub code.

Details, source commits and follow-up design: [GPU pilot](research/2026-09-28-gpu-pilot.md).

## Next concrete work

1. Prepare the [seed43/44 replication](research/2026-09-29-coverage-replication-plan.md)
   on CPU, preserving historical frozen source hashes. Pair all four arms within each seed;
   initialization, sampler order, provenance, backup and ACK must bind seed and arm.
2. Recalculate each window from the completed study's actual timing and transfer costs.
   Proposed two three-hour 4090 windows: ¥13.08 compute proxy / ¥16 reserve at the quoted
   rate, storage separate. Finish CPU reproduction, tests and Git/CI before requesting startup.
   TM's unapproved-write regression is an explicit replication target, not a deployment candidate.
3. Keep the 48 reserved tests unopened and the unmet v2 recovery gate unchanged. Freeze a
   candidate only after stability review, then prepare one-time reserved and independent-source
   evaluation. Preserve the [learning cases](research/2026-09-29-state-coverage-results.md)
   and [journal](research/EXPERIMENT_LOG.md); do not add prompts/data/DPO mid-comparison.
4. The separately authorized hosted protocol matrix still needs a permitted
   execution path or manually produced artifacts. Do not bypass the prior tool
   execution gate or repeat the already answered authorization request.

## Implemented in the seventh increment

- [x] Re-audited all 32 prior GPU episodes and diagnosed the four adapter failures.
  Case012 fails before reaching its timeout: one missing field and one known field
  are requested together, causing 22 whole-request rejections.
- [x] Committed 48 grouped scenarios in `491276b` before demonstration generation.
  All labels are realizable by the scripted workflow; cross-split duplicate tasks,
  group overlaps and held-out target exports are rejected. Those checks missed
  category hints inside visible IDs, discovered during the subsequent GPU run.
- [x] Generated and replayed 24 clean + 24 perturbed training episodes offline.
  Excluded 24 rejected decisions from targets while keeping them in later context.
  These are programmatic demonstrations, not new model-generated trajectories.
- [x] Reproduced real CPU tokenization twice: 150 paired correct decisions, exact
  per-target token equality; each arm uses 300 decisions / 38 optimizer steps /
  12,758 supervised tokens. Clean/mixed input totals 520,538 / 526,216; longest
  sequences 2,540 / 2,611. Only 75 mixed decisions change error history.
- [x] Prepared new training, arbitrary ordered dev/test local rollouts, fixed
  three-arm replay/comparison audit, boot-relative deadline, archive/backup
  acknowledgment and completion/failure shutdown. GPU paths remain unexecuted.
- [x] Added CPU regression and tokenizer CI coverage. The complete new AutoDL
  window still needs its first observed execution; offline checks are not GPU proof.

Plan, exact controls, budget and commands:
[recovery-data pilot](research/2026-09-28-recovery-experiment.md).
Implementation: [PR #13](https://github.com/Townzc/liftcut-tracker/pull/13).
CPU CI verified 179 Python tests and reproduced the paired tokenizer/data report;
the local upload archive also has all 13 prepared file hashes verified. No new
GPU or paid API execution is included in this milestone.

## Implemented in the eighth increment

- [x] Ran two fresh QLoRA arms on the retained 4090: 38 steps, 300 decisions and
  exactly 12,758 target tokens each. Both final adapters reload with zero probe
  logit difference. Source `4b1d241`; no package install/weight redownload.
- [x] Found the visible-ID category leakage missed by the previous preparation.
  Preserved original 2/24, 21/24 and 20/24 scores as contaminated diagnostics;
  withdrew reliable held-out claims instead of silently changing historical data.
- [x] Froze opaque-ID fixtures/supervisor in `592f357` before its GPU run, retaining
  the same models and rollout source. Complete probe: unadapted 1/24, ordinary SFT
  20/24, mixed SFT 17/24. All original and probe episodes replay.
- [x] Diagnosed three ordinary-only successes on pending approval, no mixed-only
  success, four shared failures, and 33 mixed invalid-validation results versus
  seven ordinary. Zero blocked writes in either suite does not establish broad safety.
- [x] Verified the full 976,388,918-byte archive and all 87 inventory files on the
  local machine, including eight saved adapters. Kept weights out of public Git.
- [x] Sent verified-backup acknowledgment and resumed the controller for shutdown;
  remote SSH closed and a fresh connection was refused. Estimated compute proxy
  CNY 3.67; provider state/bill and final command return code remain unverified.
  Documented the bounded backup-wait pause; the original two-hour hard cutoff stayed armed.
- [x] Added stricter training/public-metadata audits, identifier invariance checks,
  controller-resume regression tests, archive restoration checks and public CI replay.
  Updated the next experiment to prioritize opaque IDs, recency/approval counterfactuals
  and diverse clarification decisions. New data/CPU gates are not prepared yet.

Analysis and evidence: [recovery result review](research/2026-09-29-recovery-results.md).
Implementation: [PR #14](https://github.com/Townzc/liftcut-tracker/pull/14).

## Implemented in the ninth increment

- [x] Recomputed decision-level training coverage: 3/150 clarification targets,
  all for max_minutes and all coupled to memory updates; 75/300 mixed histories
  change, but only 24 are immediately after an error. Injected examples cover
  15 unnecessary clarifications and 9 unapproved writes, zero invalid validations.
- [x] Replayed both suites and distinguished requested from accepted clarification.
  All three ordinary-SFT clarification calls on opaque partial cases are rejected.
  Mixed SFT repeats the identical invalid plan 26 times across the probe.
- [x] Diagnosed masked memory mistakes by grading unchanged recorded plans with
  only the missing fixture answer supplied to the grader. Two ordinary and one
  mixed first plans still violate equipment constraints on the opaque partial
  cases. These are offline counterfactuals, not new model responses or revised scores.
- [x] Added executable limitations for evidence-ID grading and hidden-state-derived
  proposal IDs, and tests protecting counterfactual scope and input immutability.
- [x] Saved a staged next design: 48 train / 12 dev / 48 reserved test targets,
  corrected IDs and separated clarification/memory factors; 36 normal development
  episodes plus 27 controlled continuations, three model arms, explicit go/no-go
  rules, two-hour provisional budget and a 30-minute backup/shutdown margin.
- [x] Added full JSON reproduction to tokenizer CI and corrected stale roadmap
  wording that still described the executed recovery pilot as pending.
- [x] Subsequently completed new data, continuation runner, paired masks and
  measured runtime in the tenth increment below; preserve this design as history.

Evidence and design: [forensic review](research/2026-09-29-recovery-review-and-next-plan.md).
Implementation: [PR #15](https://github.com/Townzc/liftcut-tracker/pull/15).

## Implemented in the tenth increment

- [x] Froze 48 train/12 dev/48 reserved test scenarios with opaque public IDs,
  approval counterfactual invariance and separated missing-field/memory coverage.
- [x] Reproduced 324 paired targets and nine exact error prefixes twice locally
  and once on the server. Both SFT arms consumed 648 decisions, 81 updates and
  26,052 supervised tokens; input context and elapsed compute differ.
- [x] Executed committed source `036dcca` on the retained 4090. Both final adapters
  reload with zero maximum logit difference. All 63 development episodes completed;
  normal and controlled panels remain separate and reserved test usage is zero.
- [x] Recorded C/R paired improvements on memory+clarification and pending recovery.
  Normal pending still fails both. Net recovery +1 in one family misses the
  preregistered +2/two-family gate; no larger training or seed expansion is launched.
- [x] Restored all 42 files from three archives and re-audited actual adapters and
  raw generations before uploading the shutdown ack. SSH/SFTP then closed and a
  reconnect was refused. Compute proxy through that observation is CNY 5.1788;
  supplier power state, shutdown return code and billing were not directly seen.
- [x] Added reproducible publication inventory/review checks to CI and a Chinese
  pipeline walkthrough. Public logs omit all weights; local full backups remain.
- [x] The following increment implemented and froze the 19-state CPU diagnostic design.

Evidence: [results and limits](research/2026-09-29-controlled-recovery-results.md).
Implementation: [PR #16](https://github.com/Townzc/liftcut-tracker/pull/16).

## Fixed-state diagnostic preparation increment

- [x] Implemented 10 consent and 9 memory/clarification states, real tool/user
  prefixes, first-decision scoring, complete read-batch handling and raw replay.
- [x] Matched all files and real tokenizer hashes in two independent preparations;
  19/19 scripted reference contracts pass. No new actual model outputs.
- [x] Added pinned-adapter inference entry, durable per-call evidence, paired
  38-state native audit, one-hour boot deadline and verified archive acknowledgment.
- [x] Verified both local actual adapter weights/configurations; controller dry-run
  starts no GPU process. All 240 local tests pass; tokenizer reproduction is in CI.
- [x] Saved evidence-based first-release milestones and updated the private local
  learning plan without publishing personal career details.
- [x] Executed the short GPU diagnostic window in the following increment (below).

## Fixed-state results and training-coverage review

- [x] Ran 19 states per existing adapter, 44 actual generations, no training or test
  evaluation; C/R consent 5/10 vs 6/10, memory 2/9 vs 1/9. No autonomous blocked
  writes, parsing failures, truncation or context guards occurred.
- [x] Restored and verified the complete 21-file archive and replayed all 38 states
  before acknowledgment. Connection closure observed; provider power/bill unverified.
- [x] Published exact-inventory synthetic evidence, action-level comparisons and
  CI replay. Added a reproducible retrospective audit of the original training pools.
- [x] Both pools have 64 get_context→get_memories targets and no read→finish
  targets; eight memory fixtures confound valid position with invalidity type.
  Observed failures motivate coverage interventions but do not isolate causality.
- [x] Added the persistent research journal and three concrete trace walkthroughs;
  saved a four-arm design with CPU, evaluation and budget gates still pending.

Evidence: [diagnostic results](research/2026-09-29-state-diagnostic-results.md).
Publication and analysis: [PR #18](https://github.com/Townzc/liftcut-tracker/pull/18).

## Four-arm state-coverage preparation

- [x] Expanded only the original training bundles; frozen 72 scenarios per arm.
- [x] Executed and replayed all scripted trajectories; injected reads remain context,
  business states agree, and every correct target is paired across S0/T/M/TM.
- [x] Added a permutation-invariant public identity for the new training study;
  future user decisions do not enter it. Historical data, runners and identities unchanged.
- [x] Independently reproduced actual tokenizer masks and exact four-arm schedules.
  Each arm uses 41,788 target tokens and 126 updates; input compute is disclosed separately.
- [x] Added versioned GPU training/evaluation, paired gates, raw-response audit,
  three-hour controller and five-archive actual-weight restore before acknowledgment.
- [x] All 264 local tests pass; synthetic operational tests are not model evidence.
- [x] Execute all four arms; restore actual adapters and 124 evaluations before ACK.
- [x] Publish exact evidence inventory, 407-generation token audit, paired regressions,
  training curves, five learning cases and four explicitly scripted proposal diagnostics.
- [x] Close the GPU window after verified backup; follow-up connection refused.
- [ ] Prepare independent seeds and frozen-candidate validation; no new server window ready.

Specification: [execution and budget](research/2026-09-29-state-coverage-experiment.md).
Implementation and remote verification: [PR #19](https://github.com/Townzc/liftcut-tracker/pull/19).

## Decision log

| Date | Decision | Reason / evidence |
| --- | --- | --- |
| 2026-09-28 | Prioritize environment, evaluation and post-training | Approved technical direction; existing results emphasize output format |
| 2026-09-28 | Build an offline Python proposal contract first | Establish measurable constraints without requiring GPU/API or product migrations |
| 2026-09-28 | Label seed data as development-only | Avoid claiming generalization from fixtures used to implement the evaluator |
| 2026-09-28 | Keep the historical research branch intact; branch from current main | Preserve separate README work and base this increment on the latest product tree |
| 2026-09-28 | Publish technical milestones; keep personal preparation local | Make public research reproducible while retaining private career context |
| 2026-09-28 | Implement the offline P1 environment before any model rollout | Deterministic replay and mutation tests establish the interface before API spending |
| 2026-09-28 | Keep P1 partially complete until an untrained model comparison runs | Fixed-workflow 14/14 only demonstrates fixture coverage and environment behavior |
| 2026-09-28 | Check in complete synthetic fixed-workflow traces | Let readers replay the reported result, including response loss after a committed write |
| 2026-09-28 | Separate API failures and unknown usage from runtime tool errors | Avoid silently retrying paid calls or scoring unavailable usage as zero cost |
| 2026-09-28 | Use a one-scenario hosted reference before broader rollouts | Validate provider compatibility and cost before generating trajectories |
| 2026-09-28 | Preserve a failed full-suite baseline and prioritize protocol compatibility | Five of six failures occurred before task decisions because the model emitted two read calls; the sixth exposed pending-approval label ambiguity |
| 2026-09-28 | Audit complete saved runs before adding costs | Replay and log/report cross-checks prevent accidental missing or duplicated spending; account balance remains unverified |
| 2026-09-28 | Separate batch acceptance from pending-approval instruction in four frozen arms | Distinguish interface changes from instruction changes; preserve original 8/14 result |
| 2026-09-28 | Continue with offline data and CPU tokenizer work after paid launch rejection | No new live claims or spend; the execution gate remained after explicit budget approval |
| 2026-09-28 | Exclude known-invalid decisions from positive recovery targets | Preserve error context for learning repair without teaching the rejected action as a correct target |
| 2026-09-28 | Use the maintainer's existing 4090 at CNY 2.18/hour, without disk expansion | Actual 50GB disk fits pinned 4B weights and pilot checkpoints; no A800 evidence |
| 2026-09-28 | Fix native assistant-content mapping in a separate source commit and rerun diagnostics | Initial pure-tool parser rejected a valid call preceded by prose; keep that failure separate from training effects |
| 2026-09-28 | Reuse the image's Torch in a separate Python 3.12 venv, then reverify CPU artifacts | Avoid global package changes; server token audit matched the original Python 3.11 result exactly |
| 2026-09-28 | Prepare a paired recovery-context pilot before renting more compute | Existing 6/14 to 10/14 gain is entirely net training overlap; three blocked writes and 22 repeated clarification failures motivate the intervention |
| 2026-09-28 | Match every assistant target and sampler position across SFT arms | Isolate error history while exactly matching supervised tokens and optimizer steps; disclose extra context compute and shared-template holdout limits |
| 2026-09-29 | Invalidate reliable held-out claims for recovery-v1 and preserve original results | All 48 fixtures contain visible category hints; preparation tests missed this defect |
| 2026-09-29 | Freeze a bounded post-hoc opaque-ID probe using unchanged trained models | Diagnose identifier sensitivity within the same boot deadline; do not silently retrain or relabel reused tasks as new tests |
| 2026-09-29 | Prioritize data correction and clarification coverage before larger training | Both original SFT arms fail all three partial-clarification cases; mixed data does not improve original task success |
| 2026-09-29 | Add identical post-error starts and gate test evaluation on development evidence | Reset-only evaluation does not isolate recovery; injected training errors omit invalid validation, and missing information is confounded with memory updates |
| 2026-09-29 | Preserve narrow score definitions and report masked failures separately | wrong_action masks equipment errors; tool exception count misses valid:false; evidence IDs do not enforce citation of selected memory |
| 2026-09-29 | Keep the replacement instance for the full controlled development experiment | Maintainer explicitly superseded migration-only early shutdown; use a boot-relative four-hour CNY8.72 compute proxy within the CNY10 planning reserve, including preparation |
| 2026-09-29 | Prepare recovery-v2 and transfer final adapters during evaluation | 48 train / 12 dev / 48 reserved test, two CPU reproductions, 26,052 matched target tokens per arm; three error types, nine exact prefixes; early per-arm archives reduce late transfer risk |
| 2026-09-29 | Preserve limited positive results without lowering the recovery gate | R gains one normal and one continuation case, but recovery gain is only one case/one family; C already has 8/9 and normal pending still fails both |
| 2026-09-29 | Diagnose fixed consent and memory states before more training | Compare equal previews under changed histories; separate raw context, stale memory and invalid high revision values; 38 planned inference-only continuations after CPU gates |
| 2026-09-29 | Prepare a matched 2×2 coverage intervention after diagnostic failure | Both adapters restart planning after reads; distinct memory values expose wrong-source choices. Exact training pools lack corresponding terminal histories and independent position/invalidity coverage; causality remains untested |
| 2026-09-29 | Maintain a what/why/result/next journal and concrete learning cases | Maintainer requested continuous records to independently understand and explain the project; observations, interpretations and pending experiments stay separate |
| 2026-09-29 | Freeze four matched state-coverage arms before GPU execution | 72 train scenarios/504 paired decisions per arm; actual target sequences identical; context-only reads and memory permutations isolated within the new common data |
| 2026-09-29 | Revise the proposed window from two hours/¥6 to three hours/¥8 | Actual inputs imply about 93 training minutes, 112 with 20% margin; evaluation/setup/backup bring the estimate to about 177 minutes; hard deadline remains boot-relative |
| 2026-09-29 | Keep the narrow T screening result and reject TM promotion | Only S0→T passes; M misses both pairs, and TM adds three blocked unapproved-write attempts; no aggregate score or system interception hides model behavior |
| 2026-09-29 | Reproduce current factors before adding a repair intervention | Single-seed outcomes trade off across task, consent and memory; all-four-arm seed43/44 work remains a CPU preparation proposal |

## Update protocol

Read this file at the start of a work session. After an increment, record actual
commands/results, current limitations and the next task. Change the roadmap when
evidence or constraints justify it and add a dated reason here. Link each completed
increment to its final GitHub change; do not mark an experiment complete from a
configuration file or intended result alone.

## Conditional I1 preparation in an isolated worktree, 2026-10-03 09:25 UTC

Branch feat/i1-memory-view starts from main678e3dc while the primary G4 results
branch continues collecting the only active cloud run. Native projection helpers
from PR41 are reused unchanged. Fixed-reference, original-lease, system-gate,
fresh raw/view GPU entrypoint and dual-audit code are prepared;6 focused tests and
CLI compilation pass. This is incomplete preparation: real G4 failure/restoration,
reference/source freeze, controller/collector/restorer, full CPU recovery and exact
Git checks remain required. No I1 model call or complete readiness claim. See
[preparation status](research/2026-10-03-i1-preparation-status.md).

## I1 operating contract prepared, 2026-10-03 09:46 UTC

Controller, single-dispatch collector, receipt transfer and restorer are implemented
in this isolated branch.10 focused I1 checks and595 full offline tests pass174.510s.
A full CPU drill with actual unchanged historical T bytes restores222 scripted
native/environment episodes and376 generation records, then creates a SCRIPTED
complete receipt; consumption is simulated locally.111 scripted reference episodes
are separate. This is neither actual G4 trigger nor I1 model/remote evidence.
Metadata-only partial recovery is being checked separately. Actual G4 restoration,
failure decision, fixed reference/source freeze, exact-head Git checks and original
time fit still gate all I1 dispatch. Root G4 collector remains the only cloud run.

09:48 UTC: metadata-only CPU recovery passed; receipt remains partial with0 complete episodes. Full-drill source digest is unchanged. No real I1 trigger/freeze or GPU dispatch.

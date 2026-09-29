# 外部工具调用验证：执行前的接口审查

2026-09-29 UTC，在四组 GPU 训练运行期间编写。**这是后续候选方案，尚未冻结任务
清单、安装外部评测环境、下载题目或调用模型，不是已完成的外部成绩。**

## 要回答的问题

内部状态覆盖改动是否只适应 LiftCut 的工具名、提示词和小量模板，是否损害原模型
的通用工具调用？外部来源的固定任务可检查迁移与退化，但公开 benchmark 可能已在
基模预训练中出现，因此不能称为确定未见样本。外部结果与内部成功率单列。

## 选型与已核对的信息

优先准备 BFCL 的本地单轮 AST 小子集，再考虑多轮子集。第一阶段只需要模型推理，
不追加训练；单轮结果只说明工具选择/参数等能力，不称为完整 Agent 任务成功。
官方另有多轮、memory、web search 类别，不能把单轮子集写成覆盖全部 Agent 能力。
[官方类别](https://github.com/ShishirPatil/gorilla/blob/main/berkeley-function-call-leaderboard/TEST_CATEGORIES.md)

官方榜单当前页面注明用于复现的短 commit `f7cf735` 与包版本 `bfcl-eval==2025.12.17`。
已通过官方 GitHub commit API 解析为
`f7cf7359b7ac615a0b294831c5ba2bc95ee4a000`（2025-12-17T03:55:00Z）；
该固定提交的 README 也确认支持 run-ids 与 partial-eval。
正式准备时须固定该提交的代码、数据、评分器和 handler 哈希；不能一边
使用最新版数据，一边声称复现旧榜单。[官方版本说明](https://gorilla.cs.berkeley.edu/leaderboard.html)
[完整提交](https://github.com/ShishirPatil/gorilla/commit/f7cf7359b7ac615a0b294831c5ba2bc95ee4a000)、
[固定版本 README](https://github.com/ShishirPatil/gorilla/blob/f7cf7359b7ac615a0b294831c5ba2bc95ee4a000/berkeley-function-call-leaderboard/README.md)

固定版本的可选 vLLM 依赖为 0.8.5，并有独立的数值/解析依赖。不要直接装进当前
torch 2.8.0 训练环境：未来将评分环境隔离，优先保留现有已验证推理路径，再实现
明确的协议适配。如果采用另一个推理后端，先做数值和协议对照，单独标记配置差异。
本次只读取版本元数据和文档，没有安装依赖。
[固定版本依赖声明](https://github.com/ShishirPatil/gorilla/blob/f7cf7359b7ac615a0b294831c5ba2bc95ee4a000/berkeley-function-call-leaderboard/pyproject.toml)

官方仓库许可证和数据卡均标注 Apache-2.0。实际分发选定文件前仍保留该版本的
LICENSE、现有归属信息及修改说明。本轮只读取文档，不复制 benchmark 题目。
[仓库 LICENSE](https://github.com/ShishirPatil/gorilla/blob/main/LICENSE)、
[官方数据卡](https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard/blob/main/README.md)

## 必须先解决的三个接口问题

1. **没有调用工具可能是正确行为。** 当前 LiftCut 的 `parse_tool_message` 要求工具
   调用，终态也通过 finish 工具表示；不能直接拿该规则判断外部 irrelevance 类。
   外部 adapter 应支持合法文本终止，保留原始生成，用外部官方评分器判断；不得为
   某一模型补写缺失调用、自动修复参数，或把所有文本回答判为解析失败。
2. **固定子集不能静默缩小分母。** 官方支持 `--run-ids` 选定案例；`--partial-eval`
   会跳过结果文件中不存在的 ID。我们必须在评分前核对预登记清单、唯一 ID、尝试
   记录与终止状态。漏跑应阻止发布，实际模型失败应保留在预定分母内；不能直接采用
   自动生成的 overall 列作为全榜成绩。
   [官方生成和评分说明](https://github.com/ShishirPatil/gorilla/blob/main/berkeley-function-call-leaderboard/README.md)
3. **模型接口与数值精度是实验条件。** 所有比较使用相同原生模板、工具序列化、
   精度、上下文和输出上限。先用自造小型契约任务核对空工具、无调用、单调用、
   多调用、错误 JSON、EOS/截断，逐项确认 handler 行为。当前主实验的 QLoRA 推理
   量化和非量化层精度已冻结；如外部框架必须换后端，先记录为单独实验条件，不能
   将新后端与旧内部数字直接比较。

## 拟定的准备顺序与预算计算

先固定对照：原始基模、S0、一个事先冻结的候选 adapter。候选由内部研究的预登记
门槛与后续稳定性结果决定；外部成绩不得反向用于挑选多个候选中最高的一组。若
内部没有足够的收益证据，则缩小为基模/S0 的适配退化审计，并明确问题改变的原因。

CPU 阶段拟在 simple_python、multiple、parallel、irrelevance 四类中各选 16 例；
将 `SHA256(固定选择盐 + 官方 ID)` 排序后取前 16，规则先冻结，再输出确切 ID。
另留各类少量不重叠的适配开发例，只用于接口诊断，不能混入正式子集。不能按模型
成功与否删选，也不能在看到模型失败后换成较短题目。此数量是本项目的预算设计，
不来自官方推荐，不代表总体统计精度。

先对预定输入使用固定 tokenizer 量长度，记录超过上限的案例；若总体接口无法
容纳计划任务，在正式生成前修订全组共同限制并重做冻结，不能边跑边改变上下文。
正式子集最多 64 × 3 = 192 次单轮生成，不默认追加多轮或 web search。用独立适配
开发例测吞吐后计算：加载/健康检查 + 三组所有输入预填充 + 输出 token 上限 ×
每 token 耗时 + CPU 评分/备份 + 余量；另计每小时价格，不把上限当真实账单。

本轮不追加外部 GPU 工作；当前三小时窗口只执行已授权 S0/T/M/TM。待内部结论、
外部精确版本/清单、CPU 契约、长度审计、价格和预计时长准备齐全，再给出下一次
服务器方案。多轮任务需要单独核对状态评分、模拟工具、副作用与步数限制，作为
第二阶段，不从单轮结果外推。

## 发布口径与学习检查

报告名称应明确“BFCL 某固定版本的 64 例单轮分层子集”，逐类报告得分、配对进退、
格式/截断/上下文失败及 token/延迟。保留所有原始输出和官方评分日志。不可称为
官方榜单总分，也不以该子集证明多轮规划、授权管理或外部真实服务操作能力。

学习检查：为什么 LiftCut 的 finish 工具不能直接当外部文本终止？为什么
`--partial-eval` 运行成功不保证没有漏跑？为什么公开外部来源仍可能有基模污染？
为什么 LoRA 在领域任务提升时，还需要测普通工具调用是否退化？

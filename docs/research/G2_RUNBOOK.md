# G2 seed42 状态覆盖对照操作手册

研究设计、事前门槛和预算见[G2计划](2026-10-03-g2-state-coverage-pilot.md)。先在
本机完成最终提交检查、启动包实际安装核验，再通知用户新开机。G1窗口已经关闭；
不能复用旧开机消息。两个新组为repair_only、coverage_mix，不启动额外seed。

## 本地准备

命令从仓库根目录执行，Windows设置 `PYTHONUTF8=1`。tokenizer与恢复使用现有
`research/liftcut-agent/.venv/Scripts/python.exe`；运输用已有Paramiko的解释器，
不要在运输解释器里导入Transformers或重装训练依赖。

```sh
python research/liftcut-agent/prepare_g2.py --output-dir /path/to/fresh-g2-a --tokenizer-dir /path/to/pinned-tokenizer
python research/liftcut-agent/prepare_g2.py --output-dir /path/to/fresh-g2-b --tokenizer-dir /path/to/pinned-tokenizer
python research/liftcut-agent/drill_g2.py --output-dir /path/to/fresh-drill --prepared-dir /path/to/g2-a --diagnostic-dir /path/to/old-diagnostic --d2-dir /path/to/d2-prepared --tokenizer-dir /path/to/pinned-tokenizer
```

两次准备必须匹配冻结的9文件清单、两个epoch的逐条目标和上下文覆盖。带
`--historical-adapter /path/to/original-T/final` 可验证真实旧文件容器恢复；仍是
明确标注的脚本演练，不是新G2权重或模型成绩。无权重模式不能生成完整恢复回执。

在ignored输出目录复制 `configs/g2-monitor.template.json`，填写精确检查通过的
提交、已核验endpoint/known_hosts和本机路径；密码不写文件，booted_at保持null。

```sh
python research/liftcut-agent/stage_g2.py --output-dir /path/to/fresh-stage --prepared-dir /path/to/g2-a --diagnostic-dir /path/to/old-diagnostic --d2-dir /path/to/d2-prepared --tokenizer-dir /path/to/pinned-tokenizer --execution-commit CHECKED_40_CHAR_COMMIT --source-ref CHECKED_BRANCH --base-commit 29d8d7fc6d1e749a85d93979da3b589d063f5c0d --name UNIQUE_STAGE
python research/liftcut-agent/launch_g2_remote.py --config /path/to/local-config.json
```

增量包基于上轮G1的29d8d7f。先用 `d2_bundle.install_bundle` 在本地独立临时目录
真实安装，核对target HEAD/tree、原基线未变、全部资产size/SHA、冻结执行计划。
云端若因更换实例缺失该基线或模型缓存，停止并保留证据，不在计费窗口反复下载。
不需要重新开机读取旧G1日志。

## 新开机和执行

```sh
python research/liftcut-agent/launch_g2_remote.py --config /path/to/local-config.json --stage-dir /path/to/checked-stage --opening-id NEW_UNIQUE_ID --booted-at ACTUAL_UTC_OPENING --execute
```

凭据只通过getpass输入。启动器取用户观察/容器启动代理的较早值，十分钟内启动；
工作150分钟，硬截止180分钟。先启动保护，再核对4090、冻结依赖、模型缓存和
至少3GB空间。只读现有缓存，无扩盘、安装、付费API或额外训练。¥8预留，¥2.18/小时。

顺序为 train-repair_only → 逐组归档 → evaluate-repair_only → train-coverage_mix →
逐组归档 → evaluate-coverage_mix → 全面审计。两个组均从相同seed42初始化，
最长序列探针不得更新参数，探针后重置seed；每组固定126更新，不续训或选中间权重。

启动意图写盘后，返回不明不能重启训练。唯一启动器复用同一连接继续收集；进度
没有实质变化时保持安静。回访仅在这次实际运行后创建，原截止必须原样保存。

## 下载、真实恢复、关机

早期两份权重包逐个核验size/SHA，最终索引不得替换早期包。使用新的恢复UUID目录，
`restore_g2.py` 检查两组实际权重、相同初始化、全部222条native/environment回放和
生成token。只有工具实际生成的完整回执可以原子上传，严禁手写或修改ACK。

partial只证明已经下载的字节，不补齐分母或宣称完成。若收集器异常，先查已有
会话、真实进程、下载文件；恢复收集换新本地目录并保留原boot/截止，不自动重复
启动。`monitor_g2.py --config ...` 默认离线；仅在已确认旧收集器结束、原窗口仍
有效时才用 `--connect` 恢复。完整或失败后自动关机，持久数据保留。

服务器通常在消费真实回执后很快断连。分别记录上传/原子发布、服务端消费、关机
请求和平台状态；无法观测的项如实标unknown。无需为了补日志重新开机。费用按
观测时长×¥2.18估算，排除存储和无法观测时间，不反复索要实际账单。

## 结果交付

在新分支保存真实原始证据、严格审计、逐例增益与损失、记忆分层和图表。按冻结
门槛分别报告机制筛查/候选结论；G1仍是历史失败，不能用本轮改写。新对照没有
复现退化也要保留，不借用旧G1作当前配对分母。始终保持48个保留任务未使用。

记录工作、原因、结果、局限和下一步，最终精确提交全部检查通过才合并main。
关闭本轮回访；通过也不自动启动seed43/44，失败不扩训。后续付费工作另行准备。

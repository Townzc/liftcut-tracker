# G1 seed42 pilot 操作手册

研究边界和预算见[冻结计划](2026-10-02-g1-pilot-readiness.md)。默认离线，必须新开机。
只有精确提交检查通过并完成启动包安装演练后，才把该提交写入本地配置。

## 本地准备、验证与启动包

Windows 设置 `PYTHONUTF8=1`。tokenizer 使用
`research/liftcut-agent/.venv/Scripts/python.exe`，SSH运输使用已有Paramiko的Python；
不能在运输解释器里重新装训练环境。命令从仓库根目录执行。

```sh
python research/liftcut-agent/prepare_g1.py --output-dir research/liftcut-agent/outputs/g1-new-a --tokenizer-dir /path/to/pinned-tokenizer
python research/liftcut-agent/prepare_g1.py --output-dir research/liftcut-agent/outputs/g1-new-b --tokenizer-dir /path/to/pinned-tokenizer
python research/liftcut-agent/drill_g1.py --output-dir research/liftcut-agent/outputs/g1-new-drill --prepared-dir /path/to/g1-prepared --diagnostic-dir /path/to/old-diagnostic --d2-dir /path/to/d2-prepared --tokenizer-dir /path/to/pinned-tokenizer
```

无历史权重参数时不会产生完整备份回执。带
`--historical-adapter /path/to/old/T/final` 才运行实际旧权重容器恢复演练；仍然不构成
G1训练结果。不要把演练输出路径交给生产监控。

复制 `configs/g1-monitor.template.json` 到 ignored `outputs/autodl/`，填入已检查的40位
提交、endpoint、本地准备目录、实际解释器与已核验known_hosts。不要写密码；
`booted_at`保持null，等新开机。只读取原有模型缓存，不装库、不扩盘。

```sh
python research/liftcut-agent/stage_g1.py --output-dir /path/to/new-stage --prepared-dir /path/to/g1-prepared --diagnostic-dir /path/to/old-diagnostic --d2-dir /path/to/d2-prepared --tokenizer-dir /path/to/pinned-tokenizer --execution-commit CHECKED_40_CHAR_COMMIT --source-ref CHECKED_BRANCH --base-commit 3e4d8e208aecd86f05a7d3243942df6aefc2f73c --name UNIQUE_STAGE
python research/liftcut-agent/launch_g1_remote.py --config /path/to/local-config.json
```

staging要求干净已提交源码。基线3e4的存在仍须现场验证；克隆新实例若没有该基线，
停止并重新准备可验证包，不在计费窗口反复全量下载。Git包先在本地临时仓库真实
安装、核对head/tree和全部解包资产，确认大小可在十分钟内完成。

## 用户新开机后

记录用户开机观察时间与实际单价，沿用或更新SSH端口。输入密码走getpass，不写
命令行、文件或日志。启动命令需要新ID和实际UTC时间：

```sh
python research/liftcut-agent/launch_g1_remote.py --config /path/to/local-config.json --stage-dir /path/to/checked-stage --opening-id NEW_ID --booted-at ACTUAL_UTC_OPENING --execute
```

启动器取用户观察和容器启动代理中的更早值，固定150/180分钟；先arm两个保护，
核对4090、原依赖、至少3GB空间与完整模型缓存，再传增量代码/资产。声明过launch
intent后不重试启动；模糊返回先检查现有进程/日志。始终使用同一连接继续收集。

阶段：train-control → 归档control → evaluate-control → train-repair → 归档repair →
evaluate-repair → audit。每组实际最长样本probe不更新参数且不得影响后续seed。
训练只做126步，禁止自动续训、选中间权重、更换超参数或额外模型调用。

## 收集、关闭、复盘

保持本机监控会话，阶段完成时记录。下载早期权重包和最终evidence包，逐份检查size/
SHA，最终索引必须与早期归档一致；恢复到新UUID目录，不能覆盖旧恢复。
真实restorer必须检查实际两组权重、全部222回放和token，成功后才生成完整回执；
partial仅证明字节完整性，不补造未完成成绩或ACK。服务器收到回执后关机，未收到
也受15分钟收集余量和原硬截止约束。源数据留在持久盘。

若监控异常，先查实际会话和已下载文件。恢复收集保留原boot与截止、使用新的本地
输出目录，不自动重复训练或开机。可独立调用 `restore_g1.py --archive-dir ...
--output-dir ... --prepared-dir ... --diagnostic-dir ... --d2-dir ... --tokenizer-dir ...
--allow-partial`；回执只由该工具产生。`monitor_g1.py --config ... --connect`仅在
确认现有收集器已停止、原窗口仍有效时使用，默认命令无`--connect`只做离线预检。

分别保留原子发布、服务端ACK消费、关机请求及平台计费证据；断连不是停止计费。
用户确认费用作为用户提供的证据，不伪称发票。随后独立分支发布逐例进退、图表、
费用和研究日志，最终精确提交检查全通过才合并。pilot失败不扩训；48保留任务继续不用。

# G3 seed42 停止条件对照操作手册

研究设计、预注册门槛和预算见[G3设计](2026-10-03-g3-stop-boundary-design.md)。执行链沿用
G2已实际跑通的启动器、收集器、恢复和关机流程，只替换训练排程、组名和审计门槛。
两组为stop_half、stop_all；对照是仓库中已发布的G2 coverage_mix，不重训。
G2窗口已经关闭，不能复用旧开机消息；不启动额外seed。

## 本地准备

命令从仓库根目录执行，Windows设置 `PYTHONUTF8=1`。tokenizer与恢复使用现有
`research/liftcut-agent/.venv/Scripts/python.exe`；运输用已有Paramiko的解释器。

```sh
python research/liftcut-agent/prepare_g3.py --output-dir research/liftcut-agent/outputs/g3-prepared-a --tokenizer-dir research/liftcut-agent/outputs/tokenizers/cdbee75f17c01a7cc42f958dc650907174af0554
python research/liftcut-agent/prepare_g3.py --output-dir research/liftcut-agent/outputs/g3-prepared-b --tokenizer-dir research/liftcut-agent/outputs/tokenizers/cdbee75f17c01a7cc42f958dc650907174af0554
python research/liftcut-agent/g3_execution.py --prepared-dir research/liftcut-agent/outputs/g3-prepared-a
python research/liftcut-agent/drill_g3.py --output-dir research/liftcut-agent/outputs/g3-drill --prepared-dir research/liftcut-agent/outputs/g3-prepared-a --diagnostic-dir research/liftcut-agent/outputs/state-diagnostic-v1 --d2-dir research/liftcut-agent/outputs/d2-prepared-a --tokenizer-dir research/liftcut-agent/outputs/tokenizers/cdbee75f17c01a7cc42f958dc650907174af0554 --historical-adapter research/liftcut-agent/outputs/autodl/state-coverage-v1-early/t/t/final
```

prepared目录只包含`pool/`（与G2逐字节相同的9个训练池文件）和`stop/`（新停止池5个文件），
两次生成必须完全一致，并通过`g3-preparation-v1.json`与`g3-execution-v1.json`的冻结哈希。
带`--historical-adapter`的演练会用未改动的旧T权重做容器恢复，仍是脚本契约，
不是新G3权重或模型成绩。

在ignored输出目录复制`configs/g3-monitor.template.json`，填写精确检查通过的提交、
已核验的endpoint/known_hosts和本机路径；密码不写文件，booted_at保持null。

```sh
python research/liftcut-agent/stage_g3.py --output-dir research/liftcut-agent/outputs/g3-stage-UNIQUE --prepared-dir research/liftcut-agent/outputs/g3-prepared-a --diagnostic-dir research/liftcut-agent/outputs/state-diagnostic-v1 --d2-dir research/liftcut-agent/outputs/d2-prepared-a --tokenizer-dir research/liftcut-agent/outputs/tokenizers/cdbee75f17c01a7cc42f958dc650907174af0554 --execution-commit CHECKED_40_CHAR_COMMIT --source-ref CHECKED_BRANCH --base-commit 404115971f3db97577433769a88dbb2486058d99 --name UNIQUE_STAGE
python research/liftcut-agent/launch_g3_remote.py --config /path/to/local-config.json
```

增量包基于G2执行提交4041159。先在本地临时目录用`d2_bundle.install_bundle`真实安装，
核对target HEAD/tree、基线未变、全部资产size/SHA和冻结执行计划。云端若因更换实例
缺失该基线或模型缓存，停止并保留证据，不在计费窗口里反复下载。

## 新开机和执行

```sh
python research/liftcut-agent/launch_g3_remote.py --config /path/to/local-config.json --stage-dir /path/to/checked-stage --opening-id NEW_UNIQUE_ID --booted-at ACTUAL_UTC_OPENING --execute
```

凭据只通过getpass输入。十分钟内启动；工作150分钟，硬截止180分钟；¥8预留，¥2.18/小时。
顺序为 train-stop_half → 归档 → evaluate-stop_half → train-stop_all → 归档 →
evaluate-stop_all → 全面审计。每组126更新，不续训、不挑中间权重。

**训练中的新检查：** 第12步写完后，`gpu_train_g3.py`把前12步的loss、梯度范数和累计计数
与仓库中G2 coverage_mix日志逐位比较，结果写入`control-reproduction.json`。不一致时
继续训练（事前写定），但最终只能作为历史比较；同时核对初始adapter哈希是否等于
G2的`f403d9a1…`。观察者看到不一致时不要中止或重开，记录即可。

启动意图写盘后，返回不明不能重启训练。唯一启动器复用同一连接继续收集。

## 下载、真实恢复、关机

与G2相同：早期两份权重包逐个核验size/SHA；`restore_g3.py`在新的UUID目录检查两组实际
权重、相同初始化、全部222条native/environment回放和生成token，以及控制复现记录与日志
一致。只有工具实际生成的完整回执可以原子上传。partial只证明已下载的字节。
`monitor_g3.py --config ...`默认离线；仅在确认旧收集器结束、原窗口仍有效时才用`--connect`。
完成或失败后自动关机。费用按观测时长×¥2.18估算，不反复索要账单。

## 结果交付

`audit_g3.py`输出每组的`mechanism_passed`、`candidate_passed`、相对G2对照的逐例得失、
误停案例和`carried_forward`。两组分别报告，不合并。按设计文档第5节的规则决定下一步；
通过也不自动加seed，失败不扩训，48个保留任务保持未使用。

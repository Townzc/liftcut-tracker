# AutoDL：固定版本、试跑与换机交接

**当前 R1 入口：** [seed43/44 执行交接](2026-10-01-coverage-replication-execution.md)。
下一窗口的三小时总截止、150分钟工作截止与30分钟备份预留以该交接为准；
本手册下方保留各轮历史操作，不能把首轮四小时/20步试跑参数用于 R1。

本地负责开发、提交、PR 和合并；服务器负责执行已提交的实验。每次实验记录完整
40 位 Git commit，代码目录使用 detached HEAD，默认禁用该仓库的 push。服务器不需要
GitHub 写入凭据。实验脚本不读取本机的 API 密钥，也不启动已有的 DeepSeek 付费实验。

## 目录与持久化

默认工作区 `/root/autodl-tmp/liftcut`：

```text
liftcut/
  activate.sh                 # source 后设置当前代码与缓存目录
  code/<commit>/              # 每个版本单独检出，保留旧实验代码
  envs/qwen-pilot-py312/       # 独立 venv；复用镜像的 Torch
  cache/huggingface/          # 固定 revision 的权重，可重新下载
  cache/pip/                  # 可重新下载的包
  data/                      # 审查过的输入、tokenizer、tokens、模型哈希
  runs/<run-id>/              # 原始生成、环境轨迹、日志、adapter、报告
  manifests/                 # 换机完整性清单
  backups/                   # 待传回本地的归档；同盘归档不算异地备份
```

服务器地址和密码不进入仓库。当前连接信息只存放在本地被 Git 忽略的
`research/liftcut-agent/outputs/autodl/ssh_config`，其中也不保存密码：

```powershell
ssh -F research/liftcut-agent/outputs/autodl/ssh_config liftcut-autodl
```

换机只需修改这个配置的 `HostName` / `Port`。遇到主机指纹变化，应核实目标实例，
不要关闭主机密钥验证或批量删除 known_hosts。

AutoDL 数据盘不包含在保存的系统镜像中。迁移要确认数据盘也已复制；关机保留数据
不能代替备份。关键 adapter 和实验记录另存本地，并在移机后校验。
[官方迁移说明](https://www.autodl.com/docs/migrate_instance/)；
[官方存储说明](https://www.autodl.com/docs/env/)。

## 准备和版本更新

首次从公开 GitHub 克隆仓库，再执行其中的脚本。用本地审查过的完整 commit 替换
下面的 `COMMIT`，不要把 `main` 当作实验版本。脚本只下载公开代码、创建目录，
不会下载权重、安装依赖、训练或关机。

```bash
python research/liftcut-agent/server_workspace.py --root /root/autodl-tmp/liftcut \
  prepare --commit COMMIT
source /root/autodl-tmp/liftcut/activate.sh
cd "$LIFTCUT_CODE"
```

已有目录有未提交修改或版本不符时拒绝继续，不会 reset/clean。若确实需要远程修改，
先保存 diff，传回本地建立功能分支；通过检查并 push 后，在服务器准备新的 commit
目录。不要把实验期间的临时改动直接合到 main。

网络慢时可以按平台文档启用 `source /etc/network_turbo`；不要打印其代理凭据。
该代理主要用于 GitHub/Hugging Face，pip 应使用 HTTPS 源并按需移除当前命令的代理
变量，避免默认 HTTP 镜像失败。[官方学术加速](https://www.autodl.com/docs/network_turbo/)

## Python 环境

本轮镜像为 Python 3.12.3、Torch 2.8.0+cu128。既有 CPU 审计在 Python 3.11 上执行，
因此在服务器重跑完整离线测试和逐字节 token 报告比较；不假定两者相同。

```bash
python -m venv --system-site-packages "$LIFTCUT_ROOT/envs/qwen-pilot-py312"
source "$LIFTCUT_ROOT/envs/qwen-pilot-py312/bin/activate"
python -m pip install -r research/liftcut-agent/requirements-gpu-pilot.txt
python research/liftcut-agent/server_workspace.py --root "$LIFTCUT_ROOT" doctor \
  --commit COMMIT --torch --output "$LIFTCUT_ROOT/runs/doctor-NEW.json"
python -m unittest discover -s research/liftcut-agent/tests
```

顶层依赖固定版本；每轮还导出实际安装包的 `name==version` 清单。该环境复用了镜像
的 Torch/CUDA，不能只靠 pip 清单在任意镜像复现。换镜像或目录后重建 venv，重新
检查 GPU、BF16、配额、磁盘和 tokenizer，不直接信任旧 venv 的绝对路径。

## 有界 GPU 试跑

先确认实际时价和停机截止时间，启动独立于 SSH 的关机兜底。进程超时不等于实例
关机。权重下载限时 1 小时；短训练最多 20 optimizer steps，每 5 步保存 adapter、
optimizer 和随机状态。数据不足以开展正式效果实验。

按本次**开机时间**选择绝对截止时间，而不是从训练开始重新计算四小时。用真实时间
替换 `CUTOFF_WITH_OFFSET`，例如带 `+00:00` 的 ISO8601 时间：

```bash
nohup python research/liftcut-agent/shutdown_guard.py \
  --deadline CUTOFF_WITH_OFFSET --receipt "$LIFTCUT_ROOT/runs/shutdown-guard-NEW.jsonl" \
  --arm > "$LIFTCUT_ROOT/runs/shutdown-guard-NEW.log" 2>&1 < /dev/null &
```

检查回执存在 `armed` 且对应进程仍在运行。该 guard 用单调时钟等待，最多允许未来
四小时。首轮关机发现平台脚本缺少 shebang，直接用 subprocess 执行会报格式错误；
guard 已改为识别此类脚本并通过 Bash 调用。正常提前结束时也应主动关机。

```bash
export HF_HUB_DISABLE_IMPLICIT_TOKEN=1 HF_HUB_DISABLE_XET=1
timeout 3600 python research/liftcut-agent/fetch_model.py \
  --cache-dir "$HF_HOME/hub" --output "$LIFTCUT_ROOT/data/qwen-model-manifest.json"
python research/liftcut-agent/fetch_tokenizer.py --output-dir "$LIFTCUT_ROOT/data/qwen-tokenizer"
python research/liftcut-agent/tokenize_decisions.py \
  --decisions-dir research/liftcut-agent/reports/development-decisions-2026-09-28 \
  --tokenizer-dir "$LIFTCUT_ROOT/data/qwen-tokenizer" \
  --output-dir "$LIFTCUT_ROOT/data/qwen-tokens" --max-length 4096
timeout --signal=TERM --kill-after=30s 3600 python research/liftcut-agent/gpu_pilot.py \
  --model-dir "$HF_HOME/hub/models--Qwen--Qwen3-4B-Instruct-2507/snapshots/cdbee75f17c01a7cc42f958dc650907174af0554" \
  --model-manifest "$LIFTCUT_ROOT/data/qwen-model-manifest.json" \
  --tokens-dir "$LIFTCUT_ROOT/data/qwen-tokens" \
  --output-dir "$LIFTCUT_ROOT/runs/pilot-NEW" --steps 20 --allow-gpu
```

输出目录永不覆盖。下载固定 revision，权重逐个验证上游 LFS SHA-256；训练只从本地
已校验权重加载，不启用 `trust_remote_code`。标签必须与已审查 CPU 报告完全一致。
每步 loss 按 8 个 micro-batch 中的助手目标 token 总数加权，屏蔽上下文，不静默截断。

训练前后固定检查 interactive-002 和 interactive-008 两个开发场景，保留未经修复的
原始生成、token IDs 和环境回放。它们与训练数据重叠，仅验证工具交互流程。
adapter 重载后比较同一输入的 logits；不能把 loss 下降或这两个场景的分数变化
写成泛化改善。当前脚本保存训练状态，但没有自动断点续训入口。

首轮试跑发现 Qwen 的合法工具调用前可能包含说明文字。原转换器只接受纯工具文本，
修订版把说明保留为 assistant `content`，同时解析严格 JSON 工具对象；不会把没有
工具标签的 JSON 自动补成 `finish`。原始试跑保留在原 commit 下。单独的
`gpu_rollout.py` 使用相同精度设置，对未适配模型和 adapter 各运行全部 14 个开发
场景，帮助区分转换器、规划和终止问题。两组均保持 4,096 上下文、512 输出上限；
本地上下文检查拒绝时记录已知零 GPU 生成用量，该案例失败但不阻止后续案例。

```bash
# 新目录运行；adapter 组追加 --adapter-dir <pilot-dir>/checkpoint-20。
timeout --signal=TERM --kill-after=30s 1800 python research/liftcut-agent/gpu_rollout.py \
  --model-dir "$HF_HOME/hub/models--Qwen--Qwen3-4B-Instruct-2507/snapshots/cdbee75f17c01a7cc42f958dc650907174af0554" \
  --model-manifest "$LIFTCUT_ROOT/data/qwen-model-manifest.json" \
  --output-dir "$LIFTCUT_ROOT/runs/native-dev-NEW/unadapted" --allow-gpu
```

14 个场景全部是公开开发集，其中 8 个场景参与了 smoke 训练；完整开发回放仍不能
充当未见测试。该诊断与 DeepSeek 付费四组实验独立，不会调用其端点或凭据。

## 备份、关机、换机核验

对明确审查过的输入和输出创建清单；不扫描整个 home 或环境变量，不把密码、
SSH key、GitHub/API 凭据、缓存或 venv 当作实验产物打包。

```bash
python research/liftcut-agent/server_workspace.py --root "$LIFTCUT_ROOT" snapshot \
  --commit COMMIT --include data/qwen-tokens --include runs/pilot-NEW \
  --output "$LIFTCUT_ROOT/manifests/pilot-NEW.json"
python research/liftcut-agent/server_workspace.py --root "$LIFTCUT_ROOT" verify \
  --manifest "$LIFTCUT_ROOT/manifests/pilot-NEW.json"
```

清单是校验记录，不会自动备份。把这些明确列出的目录和 manifest 传回本地，验证
SHA-256，记录备份位置；模型缓存可以按 revision 重新下载。完成或失败后保留诊断，
在确认备份后运行本轮已验证的 `bash /usr/bin/shutdown`，最后核对控制台实例/账单。
SSH 断开只能说明连接结束，不能证明计费结束。
[官方关机说明](https://api.autodl.com/docs/save_money/)

对于 `run_recovery_window.py` 生成的完整归档，先在本机核验服务端公布的归档 SHA，
再恢复到全新目录并逐文件核验大小、哈希和清单覆盖范围：

```bash
python research/liftcut-agent/restore_recovery.py \
  --archive LOCAL_RUN.tar.gz --output-dir NEW_RESTORE_DIRECTORY \
  --sha256 SHA256_FROM_BACKUP_READY
```

脚本拒绝路径越界、链接、重复成员、清单遗漏和覆盖已有目录；只有全部文件核验
成功才生成 `restore-receipt.json`。确认成功后再把同一归档 SHA 写入服务端的
`off-instance-backup.json`，让控制器提前关机。部分权重备份不能代替完整归档的
确认回执。公开日志通过白名单发布，adapter 和训练状态只保留在忽略目录及数据盘。

换机后：更新本地连接配置 → 核实数据盘复制 → prepare 同一 commit → 重建/检查环境
→ verify 原 manifest → 再开始新实验。若校验失败，先恢复备份，不覆盖旧证据。

## Recovery-v2 的分批备份

`run_controlled_window.py` 使用[本轮执行方案](2026-09-29-controlled-recovery-experiment.md)
登记的预算，先完成一组训练就生成 `training/clean.tar.gz` 或
`training/mixed.tar.gz`，可与后续 GPU 阶段重叠传输。评测及审计完成后再生成
`evidence.tar.gz`。旧版单归档的确认格式不适用于这个控制器。

下载三份归档及根目录 `backup-ready.json` 到同一本地目录，运行：

```bash
python research/liftcut-agent/restore_controlled.py \
  --archive-dir LOCAL_ARCHIVE_DIRECTORY --prepared-dir VERIFIED_PREPARED_DIRECTORY \
  --output-dir NEW_RESTORED_DIRECTORY
```

该命令检查联合清单、每份归档大小/SHA、全部恢复文件，并组装运行目录，用真实
adapter 重放审计全部 63 个开发 episode。只有全部通过才创建本地
`NEW_RESTORED_DIRECTORY/off-instance-backup.json`。把这个文件复制到服务端运行根目录，
控制器验证相同 `inventory_digest` 后请求关机。禁止提前手写成功回执；脚本失败时
保留诊断及数据，不把部分结果称为完整实验。独立硬截止仍用于控制租赁支出。

服务端访问 GitHub 失败时可通过经过 SHA 核验的 Git bundle 同步已提交版本。
在新 commit 目录中从已有仓库 clone，fetch bundle，detach 到指定完整 SHA，再执行
`server_workspace.py prepare` 进行来源和干净状态检查。保留旧 checkout、数据、环境、
缓存和失败现场；服务端 Git push 仍禁用。不要把本机 GitHub 凭据复制到租赁实例。

## Fixed-state diagnostics：复用 adapter 的一小时窗口

这轮只运行 [19 个固定状态](2026-09-29-state-diagnostic-plan.md)，不训练、不调用付费
API、不扩盘。先在本地完成两次 CPU 准备和 CI，再通知开机。开机后先记录实际启动
时间或明确标注的容器启动代理、核对 ¥2.18/小时报价、数据盘、GPU、环境和已有权重。
换机使用新 commit 的干净 checkout，保留旧源码和所有实验数据。

```bash
# 在已经核验的 checkout 和现有虚拟环境中执行；所有 NEW 路径必须不存在。
python research/liftcut-agent/prepare_state_diagnostics.py \
  --tokenizer-dir "$LIFTCUT_ROOT/data/qwen-tokenizer" \
  --output-dir "$LIFTCUT_ROOT/data/state-diagnostic-v1-NEW"

python research/liftcut-agent/run_state_diagnostic_window.py \
  --model-dir "$HF_HOME/hub/models--Qwen--Qwen3-4B-Instruct-2507/snapshots/cdbee75f17c01a7cc42f958dc650907174af0554" \
  --model-manifest "$LIFTCUT_ROOT/data/qwen-model-manifest.json" \
  --prepared-dir "$LIFTCUT_ROOT/data/state-diagnostic-v1-NEW" \
  --adapters-root "$LIFTCUT_ROOT/runs/recovery-v2/training" \
  --output-dir "$LIFTCUT_ROOT/runs/state-diagnostic-v1-NEW"
```

上述控制器默认 dry-run。核对计划后使用同样参数追加
`--execute --shutdown-when-done --booted-at ACTUAL_AWARE_BOOT_TIMESTAMP`，并通过已有
tmux/nohup 方式独立于 SSH 运行。开机超过 10 分钟拒绝启动该窗口，不能偷偷延长
预算；应保存准备状态并重新安排。控制器第 35 分钟停止推理阶段，单独守护进程
在第 60 分钟请求关机。归档/核验提前结束则提前关机。实际平台关机与账单仍需
查看控制台，不能根据 SSH 断开宣称供应商已停止计费。

本轮归档为运行根目录中的 `evidence.tar.gz`，摘要在根目录 `backup-ready.json`。
复制这两份文件到本机；完整运行在本机执行：

```bash
python research/liftcut-agent/restore_state_diagnostics.py \
  --archive LOCAL_EVIDENCE.tar.gz --sha256 SHA256_FROM_BACKUP_READY \
  --prepared-dir LOCAL_VERIFIED_DIAGNOSTIC_PREPARATION \
  --output-dir NEW_LOCAL_RESTORE_DIRECTORY
```

逐文件哈希、原始生成、完整 38 状态回放和比较报告均通过才产生
`NEW_LOCAL_RESTORE_DIRECTORY/off-instance-backup.json`。把该文件复制到服务端运行
根目录触发提前关机。若本轮失败，`--allow-partial` 只确认完整备份了部分证据，
回执明确 `complete_pair_replayed: false`，不能被完整实验状态接受。守护进程日志和
关机回执属于归档之后继续变化的运维证据，能获取时另行复制并注明观察范围。

两份 adapter 已有本地完整备份，本轮归档只包含诊断日志和元数据。执行前、后均
不得覆盖 recovery-v2 的权重、数据或报告；新的实验结果须另建公开白名单包。

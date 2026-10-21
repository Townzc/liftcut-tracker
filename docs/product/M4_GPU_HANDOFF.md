# M4 GPU 训练交接

**2026-10-21 CPU 进展：暂不需要开机。** source-v2 在保存输出重放中改善口语接受，
但独立规则覆盖仍更高；[v3 数据](../../research/m4-parser/DATA_CARD_V3.md)的模板隔离、
token 长度与两步 CPU 训练/导出检查已通过，尚无新训练候选。
[G1 解码诊断](../../research/m4-parser/results/closed-decode-20261021/README.md)格式全部合法，
多填字段却从 18 增至 22，不能启用。先完成[独立自然说法验收准备](../../research/m4-parser/NEXT_ACCEPTANCE.md)
和下一候选的固定协议，再通知维护者开启服务器；本轮没有 SSH 重连或新 GPU 请求。

**本轮已完成并关机（2026-10-20 洛杉矶 / 10-21 UTC）**：按
[`run_v2.py` 的 v2 协议](../../research/m4-parser/train/GPU_V2.md)和
[显式显存恢复](../../research/m4-parser/train/MEMORY_RECOVERY.md)完成 800 步、
四种输出各 1540 条。Q8 对 HF/f16 为 98.51%/98.70%，但新挑战集
213/240、schema 94.58%、仍多填 50 个字段，候选未达标，端侧保持关闭。
[完整结果与限制](../../research/m4-parser/results/run-20261021T042106Z-v2/README.md)。
127 文件异地恢复与 38 份报告重放一致；06:02:53 UTC 已核验平台关机。
没有延长截止或追加训练，不要释放实例或删除保留资产。新方案先 CPU 验证、
CI 和独立验收设计，再通知开 GPU；下文是历史 v1 操作参考，不是新开机指令。

## 历史 v1 参考

GPU 训练由维护者确认配置和预算、开启服务器后执行。本地 Codex/Claude Code 会话可在获得连接信息后通过 SSH 执行；受网络限制的云端会话交接给维护者。全部步骤由 `research/m4-parser/run_all.sh` 完成。

## 1. 服务器要求

| 项目 | 要求 |
| --- | --- |
| 显卡 | 当前默认批大小使用 NVIDIA 24 GB 显存；首次 RTX 4090 运行采样观察到约 22 GB 显存占用，16 GB 配置未验证。驱动须支持所用 CUDA torch |
| 磁盘 | 数据盘空闲 ≥ 20 GB（基座 1.5 GB、合并模型约 1.5 GB、GGUF 约 1.6 GB、依赖与编译） |
| 内存 / CPU | ≥ 16 GB / ≥ 4 核（编译 llama.cpp、跑量化模型） |
| 软件 | Python ≥ 3.10、Node ≥ 20、git、cmake 与 C++ 编译器 |
| 预计时长 | 首次 RTX 4090 的 500 步训练指标为 144.4 秒，但完整任务还包括安装、下载、两种模型各 1060 条串行评测、量化和备份；不能按训练耗时估算总租期 |
| 时长上限 | `MAX_SECONDS=14400`（4 小时），超时发 TERM，最多再等 10 秒后强制结束该步骤。脚本不负责关闭服务器 |
| 费用 | 开机前提供实际小时单价和允许的总预算；4 小时 × 单价只是计算租时估算，不包含准备、关机、磁盘等费用。完成/失败后及时在平台关机或释放，不沿用历史报价作为费用上限 |

历史 CPU 冒烟测试（16 条训练数据、3 步、真实基座）已跑通全流程，共 370 秒（`research/m4-parser/results/run-20261019T102235Z-smoke/run.json`）。完整任务的量化评测仍在服务器 CPU 上运行。旧 `predict.py` 只设置生成线程，预填充默认按宿主机核数；首次 GPU 窗口的 Q4 生成 / 预填充为 4 / 128，实例配额为 16 核。新代码将两者同时设为 `--threads`（默认 4），新配置速度尚未实测；这些服务器数据不能当作手机性能。

2026-10-19 本地复核修复了完整模式在结果目录初始化时提前退出的问题；CPU 冒烟未覆盖该分支。完整运行现在要求 CUDA 可用，拒绝静默退回 CPU。11 项 Linux 无模型回归覆盖入口、设备选择、超时、生成 / 预填充线程上限和非 UTF-8 环境的报告输出；模型质量另看正式运行的结果。

## 2. 国内网络下获取依赖与基座

- **基座模型**：`Qwen/Qwen3-0.6B`，许可证 Apache-2.0。设 `MODEL_SOURCE=modelscope` 从 ModelScope 下载，或保留默认并设 `HF_ENDPOINT=https://hf-mirror.com`。两处文件已核对逐字节相同，脚本按 `research/m4-parser/train/base-model.sha256` 校验 7 个文件，不符即停止：
  - `model.safetensors` `f47f71177f32bcd101b7573ec9171e6a57f4f4d31148d38e382306f42996874b`
  - `tokenizer.json` `aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4`
- **Python 包**：`PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`。服务器已装 CUDA 版 torch 时设 `USE_SYSTEM_TORCH=1` 直接复用（版本会记入日志）；否则脚本从 `TORCH_INDEX_URL`（默认 PyTorch 官方 cu126 源）安装 `torch==2.14.1`。
- **npm 包**：`npm config set registry https://registry.npmmirror.com`（只用于生成数据和打分）。
- **llama.cpp**：从 PyPI 下载固定版本 `llama-cpp-python==0.3.36` 的源码包并按 PyPI 公布的哈希校验，不需要访问 GitHub。

## 3. 一条命令

方式 B（维护者 SSH 登录服务器后执行），`<COMMIT>` 用已审查、代码检查通过的固定提交，并保存提交及文件树：

```sh
git clone https://github.com/Townzc/liftcut-tracker.git && cd liftcut-tracker && git checkout <COMMIT> \
  && npm config set registry https://registry.npmmirror.com \
  && MODEL_SOURCE=modelscope PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple USE_SYSTEM_TORCH=1 \
     WORK_DIR=/root/autodl-tmp/liftcut-m4 bash research/m4-parser/run_all.sh
```

`WORK_DIR` 放在数据盘。脚本依次执行：环境检查 → Python 环境 → 基座（校验哈希）→ 数据（按 `data/manifest.json` 校验后重新生成）→ LoRA 微调 → 合并模型评测 → 导出 GGUF（f16、Q4_K_M）→ 量化模型评测 → 一致性检查 → 写入哈希。

方式 A（推荐）：把服务器连接信息交给当前本地 Codex/Claude Code 会话；先核对显卡、CUDA、数据盘和已确认预算，记录开机时间及关机截止，按第 3 节执行并带回第 4 节的结果。维护者授权完成后关机时，单独配置关机保护，备份核验后关机并在平台确认状态；未获此授权时提醒维护者关机。不要把 SSH 密码写进代码、命令日志或报告。

## 4. 结果如何带回

- 结果目录：`research/m4-parser/results/run-<UTC 时间>/`，只含 `run.json`（提交、每步用时与退出码）、`train_metrics.json`、`metrics-merged-*.json`、`metrics-q4-*.json`、`consistency.json`、`sha256.txt`。
- 带回方式：把本次结果目录拷回本机，在原负责发布的分支审查后提交指标和哈希；原始预测和日志单独归档，重新运行评分器核对结果。不要从服务器推送凭据或权重，不修改历史结果。
- **模型权重不入库**：adapter、合并模型和 GGUF 在关机前另存本机备份并逐项核对 `sha256.txt`，服务器数据盘保留副本。公开托管位置仍待决定（需国内可访问，例如 ModelScope 或国内对象存储）；不能只依赖关机实例的保留期限。

## 5. 完成后

- 按本次授权**关机**并核对平台状态；不把关机理解成删除或释放实例。数据盘费用与计算费用分别核对。
- 先核对实例实际的关机命令及其执行器。首次窗口中 Python 直接执行 AutoDL 的 `/usr/bin/shutdown` 返回 `Exec format error`，最终用已授权的控制台关机并核验成功；守护进程启动或回执已发出均不等于已关机。
- 记录实际用时与费用：`run.json` 里有每步秒数；费用以平台账单为准，写进 PR 描述。

## 6. 失败时

- 日志在 `WORK_DIR/logs/<步骤>.log`，失败步骤的最后 80 行同时写入结果目录的 `failed-<步骤>.log`；`run.json` 的 `state` 为 `failed` 或 `timeout`，`lastStep` 指出停在哪一步。
- **不自动重试，最多手动重试一次**：先定位失败，并检查原预算和关机截止是否容纳重试；不能把重新启动脚本视为获得另一段 4 小时授权。预算不足时先询问维护者。再失败就停下，带回 `failed-*.log` 和 `run.json`。
- 一致性检查未通过（退出码 3）不是故障：结果照常保留，由后续分析决定是否换量化方式。

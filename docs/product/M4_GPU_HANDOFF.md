# M4 GPU 训练交接

GPU 训练由维护者确认配置和预算、开启服务器后执行。本地 Codex/Claude Code 会话可在获得连接信息后通过 SSH 执行；受网络限制的云端会话交接给维护者。全部步骤由 `research/m4-parser/run_all.sh` 完成。

## 1. 服务器要求

| 项目 | 要求 |
| --- | --- |
| 显卡 | NVIDIA，显存 ≥ 16 GB（24 GB 更稳妥，例如 RTX 4090 / 3090、A10、L4）；驱动支持 CUDA 12 |
| 磁盘 | 数据盘空闲 ≥ 20 GB（基座 1.5 GB、合并模型约 1.5 GB、GGUF 约 1.6 GB、依赖与编译） |
| 内存 / CPU | ≥ 16 GB / ≥ 4 核（编译 llama.cpp、跑量化模型） |
| 软件 | Python ≥ 3.10、Node ≥ 20、git、cmake 与 C++ 编译器 |
| 预计时长 | **估计** 45–90 分钟（训练约 500 步；评测 1060 条 × 2 个模型；编译 llama.cpp 约 10 分钟）。尚未在 GPU 上实测 |
| 时长上限 | `MAX_SECONDS=14400`（4 小时），超时发 TERM，最多再等 10 秒后强制结束该步骤。脚本不负责关闭服务器 |
| 费用 | 开机前提供实际小时单价和允许的总预算；4 小时 × 单价只是计算租时估算，不包含准备、关机、磁盘等费用。完成/失败后及时在平台关机或释放，不沿用历史报价作为费用上限 |

CPU 冒烟测试（4 核、16 条数据、3 步、真实基座）已在云端会话跑通全流程，共 370 秒（`research/m4-parser/results/run-20261019T102235Z-smoke/run.json`）。其中合并模型在 CPU 上每条约 3 秒、Q4_K_M 每条约 1 秒；GPU 上合并模型评测会快得多，量化模型评测仍在 CPU 上跑（1060 条估计 15–20 分钟）。

2026-10-19 本地复核发现并修复完整模式在结果目录初始化时提前退出的问题；CPU 冒烟未覆盖该分支。新增无 GPU 的脚本回归检查。完整运行现在要求 CUDA 可用，拒绝静默退回 CPU；这些测试不代表 GPU 训练、质量或费用已经验证。

## 2. 国内网络下获取依赖与基座

- **基座模型**：`Qwen/Qwen3-0.6B`，许可证 Apache-2.0。设 `MODEL_SOURCE=modelscope` 从 ModelScope 下载，或保留默认并设 `HF_ENDPOINT=https://hf-mirror.com`。两处文件已核对逐字节相同，脚本按 `research/m4-parser/train/base-model.sha256` 校验 7 个文件，不符即停止：
  - `model.safetensors` `f47f71177f32bcd101b7573ec9171e6a57f4f4d31148d38e382306f42996874b`
  - `tokenizer.json` `aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4`
- **Python 包**：`PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`。服务器已装 CUDA 版 torch 时设 `USE_SYSTEM_TORCH=1` 直接复用（版本会记入日志）；否则脚本从 `TORCH_INDEX_URL`（默认 PyTorch 官方 cu126 源）安装 `torch==2.14.1`。
- **npm 包**：`npm config set registry https://registry.npmmirror.com`（只用于生成数据和打分）。
- **llama.cpp**：从 PyPI 下载固定版本 `llama-cpp-python==0.3.36` 的源码包并按 PyPI 公布的哈希校验，不需要访问 GitHub。

## 3. 一条命令

方式 B（维护者 SSH 登录服务器后执行），`<COMMIT>` 用本 PR 合并后 `main` 上的提交：

```sh
git clone https://github.com/Townzc/liftcut-tracker.git && cd liftcut-tracker && git checkout <COMMIT> \
  && npm config set registry https://registry.npmmirror.com \
  && MODEL_SOURCE=modelscope PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple USE_SYSTEM_TORCH=1 \
     WORK_DIR=/root/autodl-tmp/liftcut-m4 bash research/m4-parser/run_all.sh
```

`WORK_DIR` 放在数据盘。脚本依次执行：环境检查 → Python 环境 → 基座（校验哈希）→ 数据（按 `data/manifest.json` 校验后重新生成）→ LoRA 微调 → 合并模型评测 → 导出 GGUF（f16、Q4_K_M）→ 量化模型评测 → 一致性检查 → 写入哈希。

方式 A（推荐）：把服务器连接信息交给当前本地 Codex/Claude Code 会话；先核对显卡、CUDA、数据盘和已确认预算，记录开机时间及关机截止，按第 3 节执行并带回第 4 节的结果。完成或失败后提醒维护者关机。

## 4. 结果如何带回

- 结果目录：`research/m4-parser/results/run-<UTC 时间>/`，只含 `run.json`（提交、每步用时与退出码）、`train_metrics.json`、`metrics-merged-*.json`、`metrics-q4-*.json`、`consistency.json`、`sha256.txt`。
- 带回方式：在服务器上 `git checkout -b m4-results-$(date +%Y%m%d) && git add research/m4-parser/results/run-* && git commit -m "M4 GPU run results" && git push origin HEAD`；服务器没有 GitHub 写权限时，把结果目录拷回本机再推送。推送后在会话里告诉 Claude 分支名，后续由 Claude 开 PR、写结果报告。
- **模型权重不入库**：adapter、合并模型和 GGUF 留在 `WORK_DIR`（`model/`、`gguf/`）的数据盘上，等维护者决定托管位置（方案第 8 节待定事项：需国内可访问，例如 ModelScope 或国内对象存储）。`sha256.txt` 记录了它们的哈希，以后上传时可核对。

## 5. 完成后

- **关机**（或释放实例），避免继续计费；数据盘若需保留权重，确认平台的数据盘计费规则。
- 记录实际用时与费用：`run.json` 里有每步秒数；费用以平台账单为准，写进 PR 描述。

## 6. 失败时

- 日志在 `WORK_DIR/logs/<步骤>.log`，失败步骤的最后 80 行同时写入结果目录的 `failed-<步骤>.log`；`run.json` 的 `state` 为 `failed` 或 `timeout`，`lastStep` 指出停在哪一步。
- **不自动重试，最多手动重试一次**：先定位失败，并检查原预算和关机截止是否容纳重试；不能把重新启动脚本视为获得另一段 4 小时授权。预算不足时先询问维护者。再失败就停下，带回 `failed-*.log` 和 `run.json`。
- 一致性检查未通过（退出码 3）不是故障：结果照常保留，由后续分析决定是否换量化方式。

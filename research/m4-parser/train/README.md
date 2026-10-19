# M4 训练包

一个入口：`research/m4-parser/run_all.sh`。依次为环境检查 → Python 环境 → 基座模型（核对哈希）→ 数据（核对清单哈希）→ LoRA 微调 → 合并模型评测 → 导出 GGUF（f16 与 Q4_K_M）→ 量化模型评测 → 量化前后一致性 → 写入指标与文件哈希。

- **基座**：`Qwen/Qwen3-0.6B`，固定修订 `c1899de289a04d12100db370d81485cdf75e47ca`，许可证 **Apache-2.0**（模型仓库 `LICENSE` 与 Hugging Face 元数据 `license: apache-2.0`，2026-10-19 核实）。`base-model.sha256` 列出 7 个文件的哈希；Hugging Face 与 ModelScope（`MODEL_SOURCE=modelscope`）上的文件经核对逐字节相同，任一来源不符即停止。
- **训练**（`sft.py`）：LoRA r=16、α=32，学习率 2e-4，2 轮，批大小 16，最长 512 词元，只对答案 JSON 计损失，种子 20261019，训练过程不联网。微调后的系统提示只有一行（`SFT_SYSTEM_PROMPT`），手机上首个词元更快。
- **评测**（`predict.py` + `scripts/evaluate.ts`）：贪心解码，合并模型与 GGUF 用同一个分词器模板生成完全相同的输入；在 dev、留出模板的 test、手写集上打分，指标与 M4-3 规则基线相同。
- **导出**（`export_gguf.py`）：llama.cpp 自带转换器转 f16，再用 llama.cpp 量化为 Q4_K_M。转换器取自固定版本 `llama-cpp-python==0.3.36` 的源码包（`llama-cpp-python.sha256` 与 PyPI 公布值一致），与一致性检查所用的 llama.cpp 相同。
- **一致性**（`consistency.py`）：逐条比较合并模型与 Q4_K_M 的答案（原文与解析后的 JSON），解析后一致率低于 0.95 时，`run.json` 的最终状态为 `done-consistency-below-threshold`，其余结果与哈希照常写入，不删除任何文件。
- **只入库指标和哈希**：结果写入 `results/run-<UTC 时间>/`（`run.json` 每步用时与退出码、`train_metrics.json`、`metrics-*.json`、`consistency.json`、`sha256.txt`）。权重、日志留在 `WORK_DIR`（默认 `~/liftcut-m4`）。
- **启动检查**：完整运行要求 CUDA 可用，训练显式选择 CUDA；只有 `SMOKE=1` 选择 CPU。`python research/m4-parser/test_runner.py -v` 用本机替身检查真实脚本入口、失败记录、设备选择和超时，不下载依赖或模型。
- **时限**：`MAX_SECONDS`（默认 14400 秒）限制整次任务，超时发 TERM，10 秒后仍未退出则强制结束该步骤进程组，记录在哪一步。失败时该步日志末尾 80 行写入结果目录，不自动重试。脚本不会关闭云服务器，计费直到平台关机/释放为止。

冒烟测试（CPU、16 条数据、3 步）：`SMOKE=1 WORK_DIR=/tmp/m4 bash research/m4-parser/run_all.sh`。

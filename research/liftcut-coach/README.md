# LiftCut-Coach Research Pipeline

LiftCut-Coach 是 LiftCut Tracker 的科研与演示管线。线上产品默认使用托管模型；本地模型用于可控实验、结构化输出评测和课程展示，不是当前生产模型的替代品。

研究目标不是在通用能力上超过大型模型，而是：

- 稳定生成符合 LiftCut 严格 Zod Schema 的 JSON；
- 遵守训练天数、时长、器械、目标、伤病提示和饮食偏好等约束；
- 支持本地部署、可复现数据切分和量化评测；
- 保持生产验证边界与研究评测标准一致。

推荐使用 LoRA 或 QLoRA 微调已有指令模型，不建议从零训练基础模型。

## Directory

```text
research/liftcut-coach/
  data/
    examples/       reviewed examples
    generated/      generated datasets, normally ignored
    splits/         deterministic train/val/test outputs
    eval_cases.jsonl
  prompts/
  scripts/
  train/
```

该目录不会被 Next.js 客户端运行时引用。评测脚本会复用主应用的服务端 Provider、Prompt 和 Zod Schema，以减少“研究通过、生产失败”的偏差。

## Recommended data lifecycle

1. 编写少量人工审核的黄金样本。
2. 使用公开许可的动作知识、训练规则和营养信息构造输入。
3. 使用强模型生成候选样本。
4. 通过 LiftCut Zod Schema 自动过滤无效输出。
5. 人工抽查安全性、可执行性和约束遵守情况。
6. 使用固定随机种子生成训练、验证和测试切分。
7. 冻结独立评测集，禁止将其用于训练或提示词调优。

不要使用未经授权或未充分脱敏的真实用户资料。

## Validate JSONL

```bash
npm run research:validate -- research/liftcut-coach/data/examples/training_plan_sample.jsonl
npm run research:validate -- research/liftcut-coach/data/examples/nutrition_plan_sample.jsonl
```

校验内容包括 JSONL 格式、任务信封、严格输出 Schema 和必要业务约束。存在无效记录时脚本以退出码 `1` 结束。

## Generate cases

```bash
npm run research:generate -- \
  research/liftcut-coach/data/cases.jsonl \
  research/liftcut-coach/data/generated/candidates.jsonl
```

生成过程应记录 Provider、模型和 Prompt 版本，但不得打印或保存 API Key。对托管模型生成的候选样本仍需执行 Schema 校验和抽样审核。

## Build SFT data

将 LiftCut 黄金样本转换为 LLaMA-Factory 可读取的 Alpaca JSONL：

```bash
npm run research:build-sft -- \
  research/liftcut-coach/data/generated/liftcut_sft.jsonl \
  research/liftcut-coach/data/examples/training_plan_sample.jsonl \
  research/liftcut-coach/data/examples/nutrition_plan_sample.jsonl
```

输出字段为 `instruction`、`input` 和 `output`。可参考 `train/dataset_info.example.json` 注册数据集。

## Deterministic split

```bash
npm run research:split -- \
  research/liftcut-coach/data/generated/liftcut_sft.jsonl \
  research/liftcut-coach/data/splits \
  0.8 0.1 0.1
```

输出为 `train.jsonl`、`val.jsonl` 和 `test.jsonl`。脚本使用固定随机种子，相同输入会得到相同切分。

将测试集转换为独立评测信封：

```bash
npm run research:split-convert -- \
  research/liftcut-coach/data/splits/test.jsonl \
  research/liftcut-coach/data/eval_cases.jsonl
```

## LoRA configuration

配置示例：

```text
train/llamafactory_lora_example.yaml
train/llamafactory_lora_v2.example.yaml
```

这些文件只是参数模板。请根据 GPU 显存、模型许可证和数据规模调整 batch size、量化方式、训练轮数和上下文长度。

基础模型权重、LoRA 输出和 checkpoint 不得提交到 GitHub。

## Serve with vLLM

```bash
cd research/liftcut-coach
bash train/vllm_serve_lora_example.sh
```

默认提供名称为 `liftcut-coach`、端口为 `8000` 的 OpenAI-compatible 服务。可以通过环境变量覆盖：

```bash
BASE_MODEL=<BASE_MODEL> \
LORA_PATH=<LORA_PATH> \
SERVED_NAME=liftcut-coach \
PORT=8000 \
bash train/vllm_serve_lora_example.sh
```

Next.js 连接本地服务的示例：

```env
AI_PROVIDER=local
LOCAL_AI_BASE_URL=http://127.0.0.1:8000/v1
LOCAL_AI_API_KEY=EMPTY
LOCAL_AI_MODEL=liftcut-coach
LOCAL_AI_REQUEST_TIMEOUT_MS=120000
```

如果服务运行在另一个容器或主机，使用网络内部可达地址，不要把私有地址或凭证提交到仓库。

## Provider evaluation

```bash
npm run research:eval -- \
  research/liftcut-coach/data/eval_cases.jsonl \
  research/liftcut-coach/data/results/provider-run
```

评测输出包括：

- JSON parse success rate；
- final Zod schema pass rate；
- constraint satisfaction pass rate；
- average、P50 和 P95 latency；
- 失败用例 ID 与可复查的非敏感诊断。

评测不会打印 API Key、完整用户资料或未经处理的敏感模型输出。比较不同 Provider 时，应保持相同评测集、Prompt 版本、Schema 版本和约束。

## Research boundaries

- 结构化输出通过率不等于训练方案的临床有效性。
- 自动化指标不能替代专业人士对安全性和可执行性的审核。
- 任何涉及伤病、疾病、孕期、进食障碍或高风险症状的建议都应升级为专业咨询提示。
- AI Agent 的记忆和计划修改必须可解释、可删除，并在写入前由用户确认。

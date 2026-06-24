# LiftCut-Coach Research Pipeline

LiftCut-Coach 是 LiftCut Tracker 的科研与展示管线。线上正式用户默认继续使用 DeepSeek；本地模型用于可控实验、课程展示和结构化输出评测，不作为当前生产模型的替代品。

模型目标不是在通用能力上超越 DeepSeek，而是：

- 更稳定地产生符合 LiftCut Zod Schema 的 JSON。
- 更好遵守训练天数、时长、器械、目标、饮食偏好等约束。
- 支持本地部署、可复现数据切分和量化评测。

推荐使用 LoRA 或 QLoRA 微调现有指令模型，不建议从零训练基础模型。

## 目录

```text
research/liftcut-coach/
  data/
    examples/
    eval_cases.jsonl
  prompts/
  scripts/
  train/
```

该目录不被 Next.js 应用运行时引用。只有 `research:eval` 会复用主应用的服务端 Provider 和 Zod Schema。

## 推荐数据路线

1. 编写少量人工黄金样本。
2. 使用公开动作库、训练规则和营养数据库辅助构造输入。
3. 使用强模型生成候选样本。
4. 通过 LiftCut Zod Schema 自动过滤。
5. 人工抽查安全性、可执行性和约束遵守情况。
6. 保留独立评测集，禁止将其用于训练或提示词调优。

不要使用未经脱敏的真实用户资料。

## 校验黄金样本

```bash
npm run research:validate -- research/liftcut-coach/data/examples/training_plan_sample.jsonl
npm run research:validate -- research/liftcut-coach/data/examples/nutrition_plan_sample.jsonl
```

脚本检查 JSONL 格式、任务信封和对应的严格 Zod 输出 Schema。存在无效记录时退出码为 `1`。

## 构建 SFT 数据

将 LiftCut 黄金样本转换为 LLaMA-Factory 可使用的 Alpaca JSONL：

```bash
npm run research:build-sft -- \
  research/liftcut-coach/data/generated/liftcut_sft.jsonl \
  research/liftcut-coach/data/examples/training_plan_sample.jsonl \
  research/liftcut-coach/data/examples/nutrition_plan_sample.jsonl
```

输出字段为 `instruction`、`input` 和 `output`。在 LLaMA-Factory 的 `dataset_info.json` 中将该文件注册为 `liftcut_sft` 后，可使用示例 YAML。

## 可复现切分

```bash
npm run research:split -- \
  research/liftcut-coach/data/generated/liftcut_sft.jsonl \
  research/liftcut-coach/data/splits \
  0.8 0.1 0.1
```

输出：

- `train.jsonl`
- `val.jsonl`
- `test.jsonl`

脚本使用固定随机种子 `20260624`，相同输入会得到相同切分。

## LoRA 示例

配置文件：

```text
train/llamafactory_lora_example.yaml
```

这是参数模板，不保证服务器已经安装 LLaMA-Factory，也不代表推荐的唯一基础模型。请根据 GPU 显存、模型许可和数据规模调整 batch size、量化方式、训练轮数及上下文长度。

大模型权重、LoRA 输出和 checkpoint 不得提交到 GitHub。

## 使用 vLLM 提供 OpenAI-compatible 服务

```bash
cd research/liftcut-coach
bash train/vllm_serve_lora_example.sh
```

默认提供名称为 `liftcut-coach`、端口为 `8000` 的服务。可以通过环境变量覆盖：

```bash
BASE_MODEL=<BASE_MODEL> \
LORA_PATH=<LORA_PATH> \
SERVED_NAME=liftcut-coach \
PORT=8000 \
bash train/vllm_serve_lora_example.sh
```

如果 Next.js 和 vLLM 在同一主机或容器中：

```env
AI_PROVIDER=local
LOCAL_AI_BASE_URL=http://127.0.0.1:8000/v1
LOCAL_AI_API_KEY=EMPTY
LOCAL_AI_MODEL=liftcut-coach
```

如果二者运行在不同容器中，`LOCAL_AI_BASE_URL` 应填写容器网络内可达的服务名或地址，不要把私有地址提交到仓库。

## Provider 评测

先在 `.env.local` 中选择 DeepSeek、local 或其他 OpenAI-compatible Provider，然后执行：

```bash
npm run research:eval -- research/liftcut-coach/data/eval_cases.jsonl
```

脚本自动加载项目环境变量，并输出：

- JSON parse success rate
- Zod schema pass rate
- constraint satisfaction pass rate
- average latency
- failed case ids

评测不会打印 API Key、完整请求、用户资料或模型原始输出。出现失败用例时退出码为 `1`。

比较不同 Provider 时，应保持同一份评测集、相同提示词版本和相同约束。

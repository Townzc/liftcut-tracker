# Server Runbook Template

此文件只提供公开占位模板。不要写入或提交真实服务器 IP、端口、用户名、密码或 API Key。

## 拉取和运行 Web App

```bash
ssh <SERVER_USER>@<SERVER_HOST> -p <SERVER_PORT>

git clone https://github.com/Townzc/liftcut-tracker.git
cd liftcut-tracker

npm ci
cp .env.example .env.local
# Edit .env.local without committing it.

npm test
npm run lint
npm run build
npm run start
```

已有仓库更新：

```bash
cd liftcut-tracker
git pull --ff-only
npm ci
npm audit
npm test
npm run lint
npm run build
```

## DeepSeek 生产模式

在服务器私有的 `.env.local` 中配置：

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=<SERVER_ONLY_KEY>
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

## 本地模型研究模式

启动训练或推理前先进入研究目录：

```bash
cd research/liftcut-coach
# Prepare and validate datasets.
# Train a LoRA/QLoRA adapter.
# Serve the adapter with vLLM.
```

在应用的 `.env.local` 中配置：

```env
AI_PROVIDER=local
LOCAL_AI_BASE_URL=http://127.0.0.1:8000/v1
LOCAL_AI_API_KEY=EMPTY
LOCAL_AI_MODEL=liftcut-coach
```

如果推理服务在另一个容器中，请使用容器网络内的地址。

## 不应提交的内容

- `.env.local`
- 真实服务器地址、端口和用户名
- API Key、密码和访问令牌
- 用户原始数据或未脱敏数据集
- `outputs/`、`checkpoints/`
- `*.safetensors`、`*.bin`、`*.gguf` 等模型权重

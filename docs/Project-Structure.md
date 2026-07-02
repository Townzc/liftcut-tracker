# LiftCut Tracker 项目结构说明

## 概览

```text
src/
  app/                        # Next.js App Router
    api/                      # API routes
      ai/                     # AI generation, save, history endpoints
        generate-training-plan/
        generate-nutrition-plan/
        save-training-plan/
        save-nutrition-plan/
        history/
        _lib.ts               # Shared auth, quota, error handling
        _profile.ts           # Profile resolution for AI requests
    (page routes)             # /plan, /workout, /nutrition, /body, /settings, etc.
  components/                 # React UI components
    auth/                     # Login, register, forgot-password
    dashboard/                # Dashboard page
    layout/                   # Sidebar, header, mobile nav
    plan/                     # Training plan + AI plan pages
    nutrition/                # Nutrition tracking
    workout/                  # Workout tracking
    body/                     # Body metrics
    settings/                 # Settings page
    ui/                       # shadcn/ui base components
  lib/
    ai/
      schemas.ts              # Zod schemas for training/nutrition plans (raw + final)
      mappers.ts              # AI plan → DB schema mapping
    supabase/                 # Supabase client setup
    schemas.ts                # App-level schemas (user settings, quick food)
    guest-mode.ts             # Guest mode cookie, quota logic
    workout-calories.ts       # Calorie estimation
    plan-parser.ts            # Text-based plan import parser
    demo-data.ts              # Demo/default data
  services/
    ai/
      config.ts               # Provider config resolution (env vars, timeout)
      client.ts               # OpenAI SDK client creation, JSON extraction
      types.ts                # AiProviderConfig, AiProviderName, AiProfileSnapshot
      errors.ts               # AiServiceError class
      prompts.ts              # Prompt construction (training + nutrition)
      provider.ts             # Re-exports generate functions
      generate-training-plan.ts   # Training plan generation pipeline
      generate-nutrition-plan.ts  # Nutrition plan generation pipeline
      persistence.ts          # AI generation history DB operations
      language-check.ts       # Locale verification
    data-repository.ts        # Generic data access layer
    guest-migration.ts        # Guest → authenticated data migration
  stores/                     # Zustand state management
  types/                      # Shared TypeScript types
  i18n/                       # Internationalization setup
  messages/                   # Locale JSON files (zh-CN.json, en.json)

research/
  liftcut-coach/
    scripts/
      _shared.ts              # Shared types, JSONL read/write, validation helpers
      generate_seed_cases.ts  # Programmatic seed case generator (~3000 cases)
      generate_dataset_from_cases.ts  # AI-powered dataset generation (calls provider)
      convert_test_to_eval.ts # SFT Alpaca → eval case format converter
      eval_ai_provider.ts     # Evaluation script with 10 metrics
      validate_dataset.ts     # Dataset validation
      build_sft_from_examples.ts  # Examples → LLaMA-Factory Alpaca format
      split_dataset.ts        # Train/val/test split with fixed seed
    train/
      dataset_info.example.json       # LLaMA-Factory dataset registration example
      llamafactory_lora_v2.example.yaml  # LoRA training config example
      vllm_serve_lora_example.sh      # vLLM serving example
    prompts/                  # Prompt templates for dataset generation
    README.md                 # Research pipeline documentation

tests/
  ai-nutrition.test.ts        # Normalize, wrapper, prompt, schema tests
  schemas.test.ts             # User settings schema tests
  plan-parser.test.ts         # Plan text parser tests
  metrics.test.ts             # Nutrition metrics tests
  workout-calories.test.ts    # Calorie estimation tests
  behavior-contracts.test.mjs # Behavioral contract tests

docs/
  README.md                   # Documentation index
  LiftCut-Coach-Technical-Report.md  # Technical report
  Interview-QA.md             # Interview Q&A (45 questions)
  Project-Structure.md        # This file
```

## 重点目录说明

### `src/services/ai/` — AI Provider 层

这是 AI 功能的核心目录：

- **config.ts**：从环境变量读取 Provider 配置，支持 `deepseek`、`local`、`openai_compatible` 三种模式，每种有独立的 timeout 配置
- **client.ts**：创建 OpenAI SDK 客户端，实现 JSON 提取、code fence 清理
- **prompts.ts**：构建 strict schema prompt，包含 forbidden keys、enum requirements、schema example
- **generate-training-plan.ts** / **generate-nutrition-plan.ts**：完整的生成 pipeline（prompt → API → raw parse → unwrap → normalize → final validate）
- **types.ts**：`AiProviderConfig` 包含 `timeoutMs` 字段

### `src/lib/ai/schemas.ts` — Zod Schema 定义

定义了三层 schema：

1. **Raw schemas**（`aiTrainingPlanRawSchema` 等）：宽松，所有字段可选，容忍类型混用
2. **Normalize functions**（`normalizeAiTrainingPlan` 等）：确定性修复
3. **Final schemas**（`aiTrainingPlanSchema` 等）：严格，不放宽

### `research/liftcut-coach/scripts/` — Research Pipeline

独立于 Web App 的研究管线：

- **generate_seed_cases.ts**：程序化生成多样化 seed cases
- **generate_dataset_from_cases.ts**：调用 AI Provider 生成训练数据
- **eval_ai_provider.ts**：10 指标评测脚本
- **convert_test_to_eval.ts**：SFT 格式 → eval 格式转换

### `tests/` — 测试

- 使用 Node.js 内置 test runner（`node:test`）
- 35 个测试，覆盖 schema 校验、normalize、prompt 构建、metrics 计算

## 不应该提交的文件

```text
.env / .env.local              # API keys, Supabase credentials
research/liftcut-coach/data/   # Generated datasets, eval results
*.results.jsonl / *.failed.jsonl  # Eval output files
*.safetensors / *.pt / *.pth   # Model weights, LoRA adapters
train.log                      # Training logs
/workspace/models/             # Local model weights
/workspace/outputs/            # Training outputs, adapters
node_modules/                  # Dependencies
.next/                         # Next.js build output
```

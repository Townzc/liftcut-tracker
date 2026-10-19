# LiftCut Tracker 项目结构说明

## 概览

npm workspaces：仓库根目录是 Next.js 网页；`packages/core`（`@liftcut/core`）放网页和手机 App 共用、不依赖框架的领域代码，只允许引用自身文件和 `zod`（`tests/core-package.test.ts` 检查）。

```text
packages/core/src/            # @liftcut/core，以 "@liftcut/core/<文件名>" 引用
  types.ts                    # 领域类型（训练计划、记录、饮食、身体数据）
  llm.ts                      # 计划生成/推荐的输入输出类型
  schemas.ts                  # 应用级 Zod schema（设置、计划、记录、快照）
  workout-values.ts           # 实际重量/次数/RPE：未报告为 null，不补 0
  plan-import-schema.ts       # 文本导入计划的 schema
  ai-schemas.ts               # AI 训练/饮食计划 schema（raw + final）
  agent-contracts.ts          # 批准账本契约（提案、批准、执行、回执）
  workout-log-parser.ts       # 一句话记录的规则解析器（纯函数，只出草稿）
  exercise-catalog.ts         # 60 个动作目录与本次替换候选
  progression.ts              # 确定性进阶引擎：只读确认过的实际组，给出下次目标与中英文理由
  one-rep-max.ts              # 估算 1RM（Brzycki）：只用确认过的实际组，超过 12 次不估，返回所用的组
  eval/                       # 150 条合成解析评测语料与评测器（不调用模型）
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
      mappers.ts              # AI plan → DB schema mapping
    supabase/                 # Supabase client setup
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

### `packages/core/src/ai-schemas.ts` — Zod Schema 定义

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

# LiftCut Tracker (V1.1)

LiftCut Tracker 是一个极简、无广告、可日常使用的训练与减脂追踪 Web 应用。

V1.1 在 V1 MVP 基础上完成了三项关键升级：
- 全站中英文国际化（默认中文，可在设置中切换）
- 训练计划支持“文本输入 -> 规则解析 -> 预览修正 -> 保存”
- 接入 Supabase Auth + Postgres，支持注册/登录与多用户数据隔离

---

## 1. 技术栈

- Next.js 16（App Router）
- TypeScript（strict）
- Tailwind CSS
- shadcn/ui
- Recharts
- Lucide React
- Zustand
- Zod
- next-intl（国际化）
- Supabase Auth + Postgres（认证与数据持久化）

---

## 2. 页面与路由

- `/` Dashboard
- `/plan` 训练计划
- `/workout` 训练记录
- `/nutrition` 饮食记录
- `/body` 体重与身体数据
- `/settings` 设置与数据管理
- `/login` 登录
- `/register` 注册
- `/forgot-password` 忘记密码

受保护路由通过 `middleware.ts` 控制：未登录访问业务页会自动跳转到 `/login`。

---

## 3. 国际化说明（i18n）

- 默认语言：`zh-CN`
- 支持语言：`zh-CN`、`en`
- 语言包文件：
  - `messages/zh-CN.json`
  - `messages/en.json`
- 语言切换入口：`/settings`
- 语言偏好保存策略：
  - Supabase `profiles.preferred_language`（跨设备）
  - 本地 `localStorage`（刷新不丢失）

---

## 4. 文本导入训练计划

### 4.1 功能入口

在 `/plan` 页面使用“文本导入计划”区域：
1. 点击“加载示例模板”
2. 粘贴或输入半结构化计划文本
3. 点击“解析计划”
4. 在“预览与编辑”中手动修正（动作名/组数/次数/RPE/备注/替代动作）
5. 点击“保存解析结果”

### 4.2 支持格式（第一阶段规则解析）

- 周：`Week 1` 或 `第1周`
- 天：`Day 1` / `Day1` 或 `第1天`
- 动作行：`动作名 组数 x 次数 RPE 数值`

示例：

```text
Week 1
Day 1
Bench Press 4 x 5 RPE 7
Incline DB Press 3 x 8-10 RPE 8

Day 2
Squat 3 x 6 RPE 6
Romanian Deadlift 3 x 8 RPE 6.5
```

### 4.3 模块结构

- `src/lib/plan-parser.ts`：规则解析（正则）
- `src/lib/plan-import-schema.ts`：Zod 校验
- `src/lib/plan-normalizer.ts`：标准化为 `TrainingPlan`
- `src/services/plan-import.ts`：导入服务层（已为未来模型接入预留接口）

---

## 5. Supabase 配置

### 5.1 环境变量

复制 `.env.example` 为 `.env.local`，填写：

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 5.2 初始化数据库

1. 在 Supabase 控制台创建项目
2. 打开 SQL Editor
3. 执行 `supabase/schema.sql`

该 SQL 包含：
- 核心业务表（设置/计划/训练日志/饮食/体重）
- `profiles` 资料表
- 全量 RLS 策略（按 `user_id`/所属关系隔离）

### 5.3 Auth 配置

在 Supabase Auth 中启用 Email 登录（建议同时启用 Email Confirm）。

---

## 6. 本地运行

```bash
npm install
npm run dev
```

构建检查：

```bash
npm run build
```

---

## 7. 数据结构

核心类型定义在 `src/types/index.ts`，主要包括：

- `UserProfile`
- `UserSettings`
- `TrainingPlan`
- `PlanWeek`
- `PlanDay`
- `ExercisePlan`
- `WorkoutLog`
- `ExerciseLog`
- `FoodLog`
- `BodyMetricLog`
- `AppDataSnapshot`

---

## 8. 数据导入导出

### 8.1 训练计划导入

- JSON 导入：`/plan` 或 `/settings`
- 文本导入：`/plan`（规则解析 + 预览修正）
- JSON 校验：基于 Zod（格式错误会显示友好提示）

示例 JSON：
- `public/samples/sample-training-plan.json`

### 8.2 全量数据导出

在 `/settings` 点击“导出全部数据 JSON”，导出文件名格式：
- `liftcut-backup-YYYY-MM-DD.json`

---

## 9. 目录结构（核心）

```text
src/
  app/
    page.tsx
    plan/page.tsx
    workout/page.tsx
    nutrition/page.tsx
    body/page.tsx
    settings/page.tsx
    login/page.tsx
    register/page.tsx
    forgot-password/page.tsx
  components/
    auth/
    i18n/
    layout/
    dashboard/
    plan/
    workout/
    nutrition/
    body/
    settings/
    charts/
    shared/
    ui/
  i18n/
    config.ts
    messages.ts
  lib/
    plan-parser.ts
    plan-normalizer.ts
    plan-import-schema.ts
    supabase/
    ...
  services/
    data-repository.ts
    plan-import.ts
  store/
    use-tracker-store.ts
    use-ui-store.ts
  types/
    index.ts
messages/
  zh-CN.json
  en.json
supabase/
  schema.sql
```

---

## 10. 后续扩展建议

1. 增加服务端 Action / API Route，减少前端仓库层复杂度
2. 增加训练日志的组级明细（每组重量/次数）与统计报表
3. 引入云端计划版本管理（计划历史、回滚、比较）


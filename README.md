# LiftCut Tracker (V1.7)

LiftCut Tracker 是一个极简、无广告、面向日常使用的训练与减脂追踪 Web 应用。

本版本重点：
- 基础信息支持 `gender / age`，默认未填写状态为 `unknown / 0`
- 新用户首次登录进入 `/onboarding` 完成基础信息
- 用户资料支持昵称与头像（Supabase Storage）
- 训练计划支持文本导入、编辑、PDF 导出
- 接入 DeepSeek（仅服务端调用）实现 AI 训练/饮食计划生成、预览、编辑、确认保存

---

## 1. 技术栈

- Next.js 16（App Router）
- TypeScript（strict）
- Tailwind CSS
- shadcn/ui
- Zustand
- Zod
- next-intl
- Supabase Auth + Postgres + Storage
- Recharts
- jsPDF + jspdf-autotable
- OpenAI SDK（兼容方式调用 DeepSeek）

---

## 2. 页面与路由

- `/` Dashboard
- `/plan` 训练计划
- `/plan/ai` AI 计划生成与预览
- `/workout` 训练记录
- `/nutrition` 饮食记录
- `/body` 身体数据
- `/settings` 设置
- `/onboarding` 首次资料填写
- `/login` / `/register` / `/forgot-password`

路由守卫：
- 未登录访问业务页会重定向到 `/login`
- 已登录但基础资料未完成会重定向到 `/onboarding`

---

## 3. 已有核心能力

- 训练计划：创建、文本导入、编辑、设为生效、删除、PDF 导出
- 训练记录：按周/天录入动作实际数据并保存，支持最近记录查看详情
- 饮食记录：新增/编辑/删除、常用食物快捷添加、分餐统计
- 身体数据：体重/腰围记录与趋势图
- 设置：用户资料、目标参数、语言切换、数据导出、登出

---

## 4. 用户资料（昵称 + 头像）

设置页支持：
- 昵称编辑（1-30 字符，自动 trim）
- 头像上传 / 替换 / 删除
- 格式限制：`image/png` `image/jpeg` `image/webp`
- 大小限制：`<= 5MB`

展示联动：
- 桌面侧边栏用户区
- 移动端顶部用户条
- Dashboard 欢迎卡片

默认规则：
- 未设置昵称时显示邮箱前缀
- 无头像时显示首字母占位头像

---

## 5. DeepSeek AI 功能（服务端）

### 5.1 设计原则

- 仅服务端调用 DeepSeek，前端不直连
- `DEEPSEEK_API_KEY` 仅在服务端环境变量使用
- 使用 OpenAI 兼容调用方式（默认 `deepseek-chat`）
- 所有 AI 输出先做 Zod 校验，失败不入库
- 流程为：生成 -> 预览/编辑 -> 用户确认 -> 保存

### 5.2 AI API

- `POST /api/ai/generate-training-plan`
- `POST /api/ai/generate-nutrition-plan`
- `POST /api/ai/save-training-plan`
- `POST /api/ai/save-nutrition-plan`
- `GET /api/ai/history`

### 5.3 AI 页面

`/plan/ai` 提供：
- 生成条件表单（目标、频率、时长、场地、器械、忌口、伤病等）
- 训练计划 JSON 预览与编辑
- 饮食计划 JSON 预览与编辑
- 保存为正式计划
- 最近生成历史回填

---

## 6. 环境变量

复制 `.env.example` 到 `.env.local`：

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Server-only AI config
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

未配置 AI 环境变量时：
- 站点其他功能不受影响
- AI 页面会提示“未配置 AI 服务”

---

## 7. Supabase Schema 与迁移

初始化：执行 `supabase/schema.sql`。

### 7.1 关键新增/扩展

- `profiles`：`display_name` `avatar_url` `updated_at`
- `user_settings`：
  - 基础：`gender` `age`
  - AI 相关：`fitness_goal` `training_experience` `training_location` `available_equipment` `session_duration_minutes` `diet_preference` `food_restrictions` `injury_notes` `lifestyle_notes`
- AI 历史：
  - `ai_training_plan_generations`
  - `ai_nutrition_plan_generations`
- 正式饮食计划：
  - `nutrition_plans`
  - `nutrition_plan_days`
  - `nutrition_plan_meals`

### 7.2 旧库升级 SQL（可重复执行）

```sql
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
update public.profiles
set display_name = split_part(email, '@', 1)
where display_name is null or btrim(display_name) = '';
update public.profiles set updated_at = now() where updated_at is null;

alter table public.user_settings add column if not exists gender text not null default 'unknown' check (gender in ('male', 'female', 'other', 'unknown'));
alter table public.user_settings add column if not exists age int not null default 0 check (age >= 0 and age <= 120);
alter table public.user_settings add column if not exists fitness_goal text not null default 'fat_loss' check (fitness_goal in ('fat_loss', 'muscle_gain', 'maintenance', 'recomposition'));
alter table public.user_settings add column if not exists training_experience text not null default 'beginner' check (training_experience in ('beginner', 'intermediate', 'advanced'));
alter table public.user_settings add column if not exists training_location text not null default 'mixed' check (training_location in ('gym', 'home', 'mixed'));
alter table public.user_settings add column if not exists available_equipment text[] not null default '{}';
alter table public.user_settings add column if not exists session_duration_minutes int not null default 0 check (session_duration_minutes >= 0 and session_duration_minutes <= 300);
alter table public.user_settings add column if not exists diet_preference text not null default 'none' check (diet_preference in ('none', 'high_protein', 'vegetarian', 'low_carb', 'balanced'));
alter table public.user_settings add column if not exists food_restrictions text not null default '';
alter table public.user_settings add column if not exists injury_notes text not null default '';
alter table public.user_settings add column if not exists lifestyle_notes text not null default '';

update public.user_settings set gender = 'unknown' where gender is null;
update public.user_settings set age = 0 where age is null;
update public.user_settings set fitness_goal = 'fat_loss' where fitness_goal is null;
update public.user_settings set training_experience = 'beginner' where training_experience is null;
update public.user_settings set training_location = 'mixed' where training_location is null;
update public.user_settings set available_equipment = '{}' where available_equipment is null;
update public.user_settings set session_duration_minutes = 0 where session_duration_minutes is null;
update public.user_settings set diet_preference = 'none' where diet_preference is null;
update public.user_settings set food_restrictions = '' where food_restrictions is null;
update public.user_settings set injury_notes = '' where injury_notes is null;
update public.user_settings set lifestyle_notes = '' where lifestyle_notes is null;
```

> 完整新表、RLS、索引与 policy 请以 `supabase/schema.sql` 为准。

---

## 8. 训练计划 PDF 导出

- 主入口：`/plan` -> 导出当前计划（PDF）
- 导出结构：计划名、日期、Week/Day 分区、动作表格
- 方案：`jsPDF + jspdf-autotable`
- 已支持中文字体嵌入，避免中文乱码

---

## 9. AI JSON Schema 文件

- `src/lib/ai/schemas.ts`
  - `aiTrainingPlanSchema`
  - `aiNutritionPlanSchema`
  - 生成请求 schema 与保存请求 schema
- `src/lib/ai/mappers.ts`
  - AI 训练计划 -> 现有 `training_plans` 链路
  - AI 饮食计划 -> `nutrition_plans / days / meals`

---

## 10. 本地运行与检查

```bash
npm install
npm run dev
```

质量检查：

```bash
npm run lint
npm run build
```

---

## 11. 目录结构（核心）

```text
src/
  app/
    api/ai/
  components/
    auth/
    dashboard/
    layout/
    plan/
    settings/
    ...
  lib/
    ai/
    schemas.ts
    ...
  services/
    ai/
    data-repository.ts
    ...
  store/
  types/
messages/
supabase/
public/
```

---

## 12. 安全说明

- 不要把 `DEEPSEEK_API_KEY` 写入前端代码
- 不要提交 `.env.local`
- 不要在日志中打印 API key

---

## 13. 后续迭代建议

- 基于历史训练记录做周计划微调（仍保持结构化 JSON 输出）
- 增加 AI 生成结果对比与版本回滚
- 增加 nutrition plan 与每日 food log 的自动对照分析

# LiftCut Tracker (V1.5)

LiftCut Tracker 是一个极简、无广告、可日常使用的训练与减脂追踪 Web 应用。

V1.5 本轮重点：
- 新增昵称与头像上传，增强“个人归属感”
- 训练计划支持持续编辑（计划信息 + 动作增删改）
- PDF 导出文本对比度优化（更黑、更清晰、更适合打印）

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
- Supabase Storage（头像上传）
- jsPDF + jspdf-autotable（训练计划 PDF 导出）

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

未登录访问业务页会通过 `middleware.ts` 跳转到 `/login`。

---

## 3. 国际化（i18n）

- 默认语言：`zh-CN`
- 支持语言：`zh-CN`、`en`
- 语言包：
  - `messages/zh-CN.json`
  - `messages/en.json`
- 切换入口：`/settings`
- 偏好保存：
  - `profiles.preferred_language`（Supabase）
  - `localStorage`（避免刷新丢失）

---

## 4. 用户资料（昵称 + 头像）

在 `/settings` 的“个人资料”区域支持：
- 昵称编辑与保存（trim + 长度限制）
- 头像上传 / 替换 / 删除
- 上传后即时预览并写入 `profiles.avatar_url`

展示联动：
- 桌面侧边栏用户区
- 移动端顶部用户条
- Dashboard 欢迎卡片

默认规则：
- 未设置昵称时显示邮箱前缀
- 无头像时显示首字母占位头像

上传限制：
- 格式：`png/jpeg/webp`
- 大小：`<= 5MB`

---

## 5. 训练计划管理与编辑

`/plan` 支持：
- 创建空白计划
- 文本导入计划（模板 -> 解析 -> 预览编辑 -> 保存）
- 设置生效计划
- 删除计划（带确认）

### 5.1 当前生效计划可编辑

新增“编辑模式”，支持：
- 计划名称
- 计划备注
- Day 标题与 Day 备注
- 动作字段编辑：名称 / 组数 / 次数范围 / RPE / 备注 / 替代动作
- 新增动作
- 删除动作
- 显式“保存计划修改”

保存后写入：
- `training_plans`
- `training_plan_weeks`
- `training_plan_days`
- `training_plan_exercises`

---

## 6. 计划导出（PDF）

`/plan` 的主导出入口为 PDF，内容包含：
- 计划名称
- 导出日期
- Week 分区
- Day 小节
- 动作表格（动作、组数、次数、RPE、备注、替代动作）

实现：
- `jsPDF + jspdf-autotable`
- 内嵌中文字体（`public/fonts/NotoSansCJKsc-VF.ttf`）
- V1.5 调整了标题、表头、正文、边框对比度，观感更清晰

说明：用户侧已移除 JSON 导入入口，保留文本导入主流程。

---

## 7. 训练记录保存与查看

在 `/workout`：
- 保存记录写入 `workout_logs` 与 `workout_log_exercises`
- 页面提供“本次已保存”摘要
- 提供“最近训练记录”列表并可打开详情弹窗

详情包含：
- 日期、周/天、训练时长、完成状态、备注
- 动作明细（重量/次数/RPE/完成状态）

---

## 8. Supabase 配置

### 8.1 环境变量

复制 `.env.example` 到 `.env.local`：

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 8.2 初始化数据库

1. 在 Supabase 创建项目
2. 打开 SQL Editor
3. 执行 `supabase/schema.sql`

### 8.3 昵称与头像相关字段

`profiles` 包含：
- `display_name`
- `avatar_url`
- `updated_at`

`training_plans` 包含：
- `notes`

### 8.3.1 旧数据库升级（必须）

如果你的项目在早期版本已经执行过旧 schema，需要补执行以下 SQL：

```sql
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
update public.profiles set display_name = split_part(email, '@', 1) where display_name is null or btrim(display_name) = '';
update public.profiles set updated_at = now() where updated_at is null;
```

如果资料保存时出现“数据库缺少资料字段，请先升级 Supabase schema（profiles.display_name / profiles.avatar_url / profiles.updated_at）”，通常就是尚未执行上述迁移 SQL。

### 8.4 头像 bucket

- bucket 名称：`avatars`（public）
- 对象路径：`{userId}/avatar-{timestamp}.{ext}`
- 建议直接使用 `supabase/schema.sql` 中的 storage policy 配置

---

## 9. 本地运行

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

## 10. 数据导出

- 训练计划 PDF 导出：`/plan`
- 训练计划 JSON 导出（备份）：`/plan`
- 全量数据 JSON 导出：`/settings`

---

## 11. LLM 扩展预留（不接真实 API）

本仓库保留了后续扩展骨架：
- `src/types/llm.ts`
- `src/services/llm-plan-generator.ts`
- `src/services/llm-plan-recommender.ts`

建议后续通过服务端 route/action 调模型，避免在前端暴露 API Key。

---

## 12. 目录结构（核心）

```text
src/
  app/
  components/
    auth/
    body/
    charts/
    dashboard/
    i18n/
    layout/
    nutrition/
    plan/
    settings/
    shared/
    ui/
    workout/
  i18n/
  lib/
  services/
    data-repository.ts
    plan-export.ts
    plan-import.ts
    llm-plan-generator.ts
    llm-plan-recommender.ts
  store/
  types/
    index.ts
    llm.ts
messages/
  zh-CN.json
  en.json
supabase/
  schema.sql
public/
  fonts/
```

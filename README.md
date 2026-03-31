# LiftCut Tracker (V1.2)

LiftCut Tracker 是一个极简、无广告、可日常使用的训练与减脂追踪 Web 应用。

V1.2 在 V1.1 基础上重点提升了“可用性与可分享性”：
- 修复多处 `新增 / 创建 / 保存 / 解析` 点击无响应问题
- 训练计划主导出入口升级为 PDF（保留 JSON 备份导出）
- 文本导入计划支持中英文双模板一键加载
- 关键异步操作统一补齐 `loading / 成功 / 失败` 反馈

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
- jsPDF + html2canvas（计划 PDF 导出）

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

## 4. 文本导入训练计划（V1.2）

### 4.1 入口与流程

在 `/plan` 的“文本导入计划”区域：
1. 点击“加载中文示例”或“加载英文示例”
2. 粘贴或修改计划文本
3. 点击“解析计划”（有 loading）
4. 解析成功后进入“预览与编辑”
5. 修正动作字段后点击“保存解析结果”

### 4.2 双语模板

- 英文模板：`Week 1 / Day 1 / Bench Press 4 x 5 RPE 7`
- 中文模板：`第1周 / Day1 / 卧推 4 × 5 RPE 7`

两套模板都与当前规则解析器严格匹配，可直接解析成功。

### 4.3 支持格式

- 周：`Week 1` 或 `第1周`
- 天：`Day 1` / `Day1` 或 `第1天`
- 动作行：`动作名 组数 x 次数 RPE 数值`

### 4.4 失败提示

解析失败时会尽量给出：
- 行号定位
- 结构化原因（如缺组数、缺次数、RPE 格式错误）

---

## 5. 训练计划导出（PDF 主入口）

在 `/plan` 页面：
- 主入口：`导出当前计划（PDF）`
- 次入口：`导出当前计划（JSON）`（开发/备份）

PDF 导出内容包括：
- 计划名称
- 导出日期
- Week 分区
- Day 小节
- 表格字段：动作、组数、次数、RPE、备注、替代动作

导出文件名示例：
- `liftcut-plan-my-plan.pdf`

---

## 6. Supabase 配置

### 6.1 环境变量

复制 `.env.example` 为 `.env.local`，填写：

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 6.2 初始化数据库

1. 在 Supabase 控制台创建项目
2. 打开 SQL Editor
3. 执行 `supabase/schema.sql`

该 SQL 包含：
- 核心业务表（设置/计划/训练日志/饮食/体重）
- `profiles` 资料表
- 全量 RLS 策略（按 `user_id`/所属关系隔离）

### 6.3 Auth 配置

在 Supabase Auth 中启用 Email 登录（建议同时启用 Email Confirm）。

---

## 7. 本地运行

```bash
npm install
npm run dev
```

检查：

```bash
npm run lint
npm run build
```

---

## 8. 数据导入导出

### 8.1 训练计划导入

- JSON 导入：`/plan` 或 `/settings`
- 文本导入：`/plan`（规则解析 + 预览修正）
- JSON 校验：基于 Zod（格式错误会显示友好提示）

示例 JSON：
- `public/samples/sample-training-plan.json`

### 8.2 数据导出

- 计划 PDF 导出：`/plan`
- 计划 JSON 导出：`/plan`
- 全量数据 JSON 导出：`/settings`

---

## 9. V1.2 已修复交互问题（摘要）

- 修复“创建空白计划”无反馈问题
- 修复“解析计划”无反馈问题，补齐 loading / 成功 / 错误提示
- 修复“新增饮食记录”无反馈问题，补齐前端校验与保存反馈
- 补齐训练记录、身体数据、设置模块关键按钮反馈
- 修复多处用户未登录时的静默失败（改为明确错误提示）

---

## 10. 目录结构（核心）

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
    plan-export.ts
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

## 11. 后续扩展建议

1. 增加训练日志组级明细（每组重量/次数/RPE）
2. 增加计划版本管理（历史、回滚、对比）
3. 将关键 mutation 逐步迁移至服务端 Action 提升一致性

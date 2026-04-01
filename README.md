# LiftCut Tracker (V1.4)

LiftCut Tracker 是一个极简、无广告、可日常使用的训练与减脂追踪 Web 应用。

V1.4 本轮重点：
- 修复“最近训练记录可见但打不开”问题，新增页内详情弹窗
- 重构训练计划 PDF 导出为 `jsPDF + autoTable`，并加入中文字体支持
- 删除用户侧 JSON 训练计划导入入口，简化计划管理流程
- 预留大模型训练计划生成/推荐接口骨架（不接真实 API）

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

## 4. 训练计划管理

### 4.1 计划创建与切换

`/plan` 支持：
- 创建空白计划
- 文本导入计划（模板 -> 解析 -> 预览编辑 -> 保存）
- 设置生效计划
- 删除计划（带确认与 active 计划兜底）

### 4.2 导出当前计划（PDF 主入口）

`/plan` 支持导出当前生效计划为 PDF：
- 计划名称
- 导出日期
- Week 分区
- Day 小节
- 动作表格（动作、组数、次数、RPE、备注、替代动作）

实现说明：
- 使用 `jsPDF + jspdf-autotable` 数据驱动渲染
- 不再依赖 DOM 截图（更稳定）
- 中文导出通过内嵌字体文件支持（`public/fonts/NotoSansCJKsc-VF.ttf`）

### 4.3 已删除 JSON 导入

为了降低普通用户认知负担，V1.4 已移除：
- 计划页 JSON 导入入口
- 设置页 JSON 导入入口
- 面向用户的示例 JSON 下载入口

当前用户导入链路仅保留：**文本导入计划**。

---

## 5. 训练记录保存与查看（V1.4）

在 `/workout`：
- 点击“保存训练记录”会保存：
  - 日期
  - 周/天
  - 训练时长
  - 整次完成状态
  - 每个动作的实际重量/次数/RPE/完成状态

保存后可见性：
- “本次已保存”摘要卡
- “最近训练记录”列表
- Dashboard 的最近训练摘要

### 最近训练记录详情查看

- 点击“最近训练记录”任意卡片可打开页内详情弹窗
- 弹窗展示：
  - 日期
  - 周/天
  - 完成状态
  - 训练时长
  - 备注
  - 动作明细
- 包含状态处理：
  - loading
  - 记录不存在
  - 无权限查看

---

## 6. 饮食记录体验

`/nutrition`：
- 固定顺序：早餐 -> 午餐 -> 晚餐 -> 加餐
- 同餐次内稳定排序
- 每个餐次展示小计（热量/蛋白）
- 顶部展示全天总计

常用食物快捷项含单位基准说明（例如每100g、每勺30g、每个约50g）。

---

## 7. Supabase 配置

### 7.1 环境变量

复制 `.env.example` 到 `.env.local`：

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 7.2 初始化数据库

1. 在 Supabase 创建项目
2. 打开 SQL Editor
3. 执行 `supabase/schema.sql`

该 SQL 包含核心业务表、`profiles` 资料表与 RLS 隔离策略。

---

## 8. 本地运行

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

## 9. 数据导出

- 训练计划 PDF 导出：`/plan`
- 训练计划 JSON 导出（备份）：`/plan`
- 全量数据 JSON 导出：`/settings`

---

## 10. LLM 扩展预留（V1.4）

本轮未接入真实模型 API，但已预留接口与服务骨架：

- `src/types/llm.ts`
  - `PlanGenerationInput`
  - `PlanGenerationOutput`
  - `PlanRecommendationInput`
  - `PlanRecommendationOutput`
- `src/services/llm-plan-generator.ts`（stub）
- `src/services/llm-plan-recommender.ts`（stub）

后续接入建议：
- 优先使用结构化输出（JSON schema / zod 对齐）
- API key 不进入前端
- 通过服务端 route/action 统一调用模型

---

## 11. 目录结构（核心）

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

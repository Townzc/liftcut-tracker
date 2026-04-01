# LiftCut Tracker (V1.3)

LiftCut Tracker 是一个极简、无广告、可日常使用的训练与减脂追踪 Web 应用。

V1.3 重点优化：
- 计划管理新增删除计划（含确认与 active 兜底）
- 训练记录页新增“保存后说明 + 最近训练记录”
- 饮食记录按早餐/午餐/晚餐/加餐分组排序并显示分餐小计
- 常用食物快捷添加增加营养单位基准说明
- create/add/save 类操作增加更快反馈与局部状态更新，降低等待感

V1.2 保留能力：
- 文本导入计划（中英文模板 + 规则解析 + 可编辑预览）
- 训练计划 PDF 导出主入口（保留 JSON 备份导出）
- 全站中英文切换
- Supabase Auth + Postgres 多用户隔离

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

## 4. 文本导入训练计划

入口：`/plan` -> 文本导入计划

流程：
1. 点击“加载中文示例”或“加载英文示例”
2. 粘贴/编辑文本
3. 点击“解析计划”（有 loading）
4. 查看解析预览并可手动修改
5. 点击“保存解析结果”生成正式计划

支持格式：
- 周：`Week 1` / `第1周`
- 天：`Day 1` / `Day1` / `第1天`
- 动作：`动作名 组数 x 次数 RPE 值`

解析失败会尽量给出行号与原因（缺组数、缺次数、RPE 无效等）。

---

## 5. 训练计划管理

### 5.1 创建/导入/导出

`/plan` 支持：
- 创建空白计划
- 导入 JSON 计划
- 文本导入计划
- 导出 PDF（主入口）
- 导出 JSON（备份入口）

### 5.2 删除计划（V1.3）

- 每个计划项右侧可删除
- 删除前二次确认
- 删除后列表立即刷新
- 删除当前 active 计划时会自动切换到其他计划
- 删除最后一个计划后进入空状态引导

数据库层通过外键级联删除：
- `training_plan_weeks`
- `training_plan_days`
- `training_plan_exercises`

---

## 6. 训练记录保存后的结果（V1.3）

在 `/workout` 点击“保存训练记录”后会保存：
- 日期
- 周/天
- 训练时长
- 整次训练完成状态
- 每个动作的实际重量/次数/RPE/完成状态

保存后可见性：
- 页面内“本次已保存”摘要卡
- 页面底部“最近训练记录”列表
- Dashboard 显示最近一次训练日期与完成状态

---

## 7. 饮食记录排序与分餐统计（V1.3）

`/nutrition` 展示逻辑：
- 固定顺序：早餐 -> 午餐 -> 晚餐 -> 加餐
- 同一餐次内按创建时间稳定排序
- 每个餐次显示小计（热量/蛋白）
- 顶部保留全天总计（热量/蛋白）

常用食物快捷项现显示单位基准，例如：
- 每个（约50g）
- 每勺（30g）
- 每100g

快捷添加默认按该单位添加 1 份。

---

## 8. 认证与 Supabase 配置

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

该 SQL 包含：
- 核心业务表（设置/计划/训练日志/饮食/身体数据）
- `profiles` 用户资料表
- RLS 策略（按 `user_id` 隔离）

### 8.3 Auth

启用 Supabase Email 注册/登录（建议开启邮箱验证）。

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

## 10. 导入导出说明

- 计划 JSON 导入：`/plan` 或 `/settings`
- 计划文本导入：`/plan`
- 计划 PDF 导出：`/plan`
- 计划 JSON 导出：`/plan`
- 全量数据 JSON 导出：`/settings`

示例计划文件：
- `public/samples/sample-training-plan.json`

---

## 11. 响应速度优化（V1.3）

本轮对关键 mutation 做了可感知提速：
- 关键按钮点击后立即 loading 并禁用重复提交
- 饮食/训练/身体数据写入改为局部更新优先
- 异常时回滚状态并立即展示错误
- 仅在必要场景执行全量刷新（如切换 active 计划）

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
    plan-parser.ts
    plan-normalizer.ts
    plan-import-schema.ts
    supabase/
  services/
    data-repository.ts
    plan-export.ts
    plan-import.ts
  store/
    use-tracker-store.ts
    use-ui-store.ts
  types/
messages/
  zh-CN.json
  en.json
supabase/
  schema.sql
```

---

## 13. 后续扩展建议

1. 增加训练日志组级明细（每组重量/次数/RPE）
2. 增加计划版本历史与回滚
3. 将更多 mutation 收敛到统一服务层并补自动化测试
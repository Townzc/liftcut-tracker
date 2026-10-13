# 第 1 周 Codex 任务：未知不是零 + 今日训练卡

依据：[产品展品方案](2026-10-13-showcase-plan.md) 第 2、5、6 节。本周拆成两个 PR，先合 W1a 再做 W1b。研究目录（`research/`、`docs/research/`）不要修改。

## 开工前

1. 读 `AGENTS.md`、本文件、方案第 2 节和第 5 节；写代码前读 `node_modules/next/dist/docs/` 中相关指南。
2. 基于最新 `main` 新建分支：`fix/unknown-not-zero`（W1a）、`feat/today-session`（W1b）。
3. 先跑一遍现有 `npm run lint`、`npm test`、`npm run build`，记录基线结果。

## W1a：未知不是零（小 PR）

已确认的问题：

- `supabase/schema.sql` 中 `workout_log_exercises.actual_weight / actual_reps / actual_rpe` 为 `not null`；
- `src/services/data-repository.ts:172-174` 把缺失值映射为 0；
- `src/components/workout/workout-page.tsx:43-45` 把重量、次数预填为 0，**把目标 RPE 预填为实际 RPE**。

要做的：

- 新迁移：三列改为可空；把历史 `actual_rpe = 0` 改为 `null`（RPE 为 0 不可能是真实值）。重量、次数的历史 0 不动。按 `supabase/migrations/` 现有文件的格式写，并同步更新 `schema.sql`。
- 类型（`src/types/index.ts`）、Zod schema（`src/lib/schemas.ts`）、`data-repository`、`workout-slice`、`demo-data`，以及访客迁移、导入导出中凡涉及这三个字段的地方，全部支持 `null`（先用 `grep -rn "actualWeight\|actualReps\|actualRpe" src` 列全）。
- 记录表单：实际值默认为空；目标值只作为输入框提示文字显示。
- `pr-tracker`、`workout-calories` 等下游计算跳过 `null`，不在下游重新 `?? 0`。
- 测试：新增或修改单元测试，覆盖“空 RPE 保存后读回仍为空”“个人纪录跳过空值”“卡路里估算对空值使用明确的默认假设并在代码注释中写明”。

## W1b：今日训练卡（功能开关之后）

- **开关**：仿照 #62 的做法，服务端读环境变量（例如 `FEATURE_TODAY_SESSION`），只向浏览器传布尔值；关闭时页面显示“尚未开放”，导航不出现入口。
- **数据**：新迁移创建 `workout_sessions` 与 `set_logs`，字段见方案第 5 节；开启 RLS，只允许本人读写；每个用户至多一个 `active` 会话（部分唯一索引）。`id` 由客户端生成 UUID，写入用 upsert，天然幂等。
- **页面 `/today`**（仅登录用户；访客继续用旧页面）：
  - 从当前激活计划选出今天的训练日，“开始训练”时保存处方快照。
  - 每个动作按目标组数显示若干行；每行有重量、次数输入和一个“完成”按钮。
  - 如果同名动作有上次记录，在行内显示“上次：50kg × 10”；点“完成”且未改动时，把上次的值写入，来源记为 `user_confirmed_prefill`；用户改过的值来源记为 `user_entered`。
  - 没有上次记录时，次数必须填写才能点“完成”；重量可空（自重动作）。RPE 可选，**永远不预填**。
  - 每行可“跳过”；已完成的行可“撤销”（状态改为 `voided`，不物理删除）。
  - “结束训练”只结束会话，未记录的组保持未记录。
- **历史兼容**：不向旧表双写。给历史页、个人纪录和图表加一个读取适配器，同时读取旧记录和新会话。
- **日期**：`local_date` 按用户浏览器时区计算并保存 `timezone`，不按 UTC 归日。

## 验收（每条都要有实际运行的证据）

| 场景 | 预期 |
| --- | --- |
| 新记录只填次数、不填 RPE | 数据库中 RPE 为 `null`，界面显示“—” |
| 连续双击“完成”、或同一请求重发 | 数据库只有一行 |
| 记录三组后刷新页面 | 会话和三组状态完全恢复 |
| 撤销第 2 组 | 该行状态为 `voided`，历史与统计不再计入 |
| 用户 A 尝试读写用户 B 的会话或记录 | 被拒绝（在本地真实 Postgres 上测试 RLS，可复用 `tests/agent-db` 的测试框架） |
| 已有一个进行中的会话时再开一个 | 被拒绝，并提示继续原会话 |
| 关闭功能开关 | `/today` 不可用，旧页面不受影响 |
| 跨午夜的训练（洛杉矶与上海时区各测一次） | `local_date` 按开始时的本地日期 |

## 不要做

不接 AI 解析、不做离线发件箱、不做动作替换（分别是第 2、3 周）；不改 #62 的批准账本；不改研究目录；不提交真实健康数据；不合并到 `main`，不部署生产，不执行生产迁移。

## 交付

每个 PR 包含：修改的文件列表；实际运行的命令及输出摘要（lint、test、build、数据库测试）；`/today` 的手机宽度截图或短录屏；已知局限；[产品日志](PRODUCT_LOG.md) 中一条不超过 15 行的记录。没跑的检查写“未运行”，不要写成通过。

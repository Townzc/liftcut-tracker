# W2b：一句话批量保存与补偿回执

2026-10-13（洛杉矶；执行记录使用 2026-10-14 UTC）。接续 [W2 任务](WEEK2_CODEX_BRIEF.md)、[W2a 解析](W2A_VERIFICATION.md)。本次用户已授权验证后合并上线；不需要 GPU，也不调用模型。

## 用户流程与设计原因

1. **先预览再确认**：`/today` 输入原话，可选当前动作；`/api/ai/parse-log` 只返回“规则草稿”。展示每组重量、次数、RPE，空值为横线。即使原话含“记下”，本版本仍统一点一次“确认保存这句话”，便于用户检查多组映射。计划、否定、缺单位、RPE 作用组不明时要求澄清，不能保存。
2. **只信服务端当前记录**：解析和提交都重新读取已认证用户的会话。客户端只提交原话、选中动作、预览摘要、命令 UUID/版本和新组 UUID；不能提交任意草稿、`approved`、实际值来源或他人上下文。`confirm_preview` 表示该写入请求的用户操作类型，不是模型颁发的授权令牌。
3. **整句话一个事务**：从原 `writeSet` 提取同一 PoolClient 内的单组写入。点按、句子和补偿复用数值/版本/事件规则。用户事务锁包住重新解析、全部组、事件和回执；任一目标过期/冲突会一起回滚。不向旧表双写。
4. **不确定结果重试同一操作**：命令 UUID 绑定 version=1 和规范 JSON 的 SHA-256。相同请求返回现有状态及回执，改内容拒绝；提交成功但响应丢失时保留同一客户端请求。已撤销命令重放只返回补偿后的状态，绝不再次应用。
5. **撤销留痕且不覆盖后来修改**：新记录/跳过变为 voided；更正恢复 before 值、递增 revision。逐一核对目标仍等于原 after（包括版本），否则整批撤销失败。追加独立撤销 UUID、回执及事件；原回执不 UPDATE/DELETE。更正撤销后再撤销更早批次也可能冲突，这是保护后来版本的规则，不是清除历史的快捷方式。
6. **结束与历史**：原话“练完了”只显示结束确认，沿用会话结束事件，不补任何组，也不提供重新打开会话。最近 20 条句子回执可刷新读取，结束后仍保留；已结束会话可按同样版本规则补偿记录，统计读取排除 voided。
7. **来源与单位**：原话、规则草稿（含磅数）、前后值和组号保存在回执；实际重量规范化为 kg，未报告重量/RPE 保持 NULL。句子来源由服务器填写 `user_said`。点按可继续更正/作废句子记录，事件保留前值和旧来源。

## 实际执行与结果

| 边界/命令 | 结果与证据 |
| --- | --- |
| `npm test` | 66 项单元测试通过（8 MJS + 58 TS）；包含 W2a 的 150 条合成语法用例和故障评测器，无新增模型结果 |
| `today.test.ts`，真实 WSL PostgreSQL 16 | [7 项通过](evidence/w2b/database-w1.txt)：旧 W1a schema → W1b → 本次迁移；原逐组版本、RLS、日期及历史回归 |
| `workout-commands.test.ts`，真实 PostgreSQL | [9 项通过](evidence/w2b/database-commands.txt)：只读预览；伪造字段拒绝；4 并发同请求；第二组故障全回滚；过期上下文；补偿/旧请求；后来点按冲突时撤销全回滚；磅/NULL；结束后补偿；跨用户隔离/回执不可改删 |
| `playwright.w1b.config.ts` | [6 项通过](evidence/w2b/browser.txt)：390×844，真实 Next API/PG，认证 HTTP 契约替身；批量三组、双击、刷新、保存与撤销响应丢失、同请求重试、次数更正/恢复、后续冲突、点按 RPE 7/8/9、句子结束确认、未知值与旧入口回归 |
| `npm run lint` / `npm run build` / TypeScript | lint 无错误，仅 2 条原有研究脚本警告；[生产构建通过](evidence/w2b/build.txt)，两个新 API 纳入路由。没有修改研究执行源 |
| 托管迁移 | 03:04:41 UTC 应用 `workout_command_receipts`，平台版本 `20261014030441`，源文件 `20261014025246_workout_command_receipts.sql`。只增加回执表/索引/权限，无旧数据改写 |
| 托管迁移后核验 | [实际查询](evidence/w2b/hosted-migration.json)：RLS+FORCE RLS；浏览器无 INSERT，运行角色无 UPDATE/DELETE；6 原用户、100 原记录；与原私有备份双向 EXCEPT 差异 0 |

浏览器实际查看了 [三组与空 RPE](evidence/w2b/sentence-three-sets.png) 和 [补偿回执](evidence/w2b/sentence-compensation.png)。390px 无横向溢出、无 JS 错误。本地认证是既有替身，不能写成托管 GoTrue 验收；正式域名证据须在实际部署后另记。

## 执行中发现与处理

- 初始接入编译发现回执组件误插入单组组件的作用域；移回 TodayPage，TypeScript/生产构建和完整浏览器流程通过。
- 首次本机数据库连接用了过时的测试管理员口令，连接认证失败，未运行迁移。通过本机 WSL peer 管理创建专用测试角色和新隔离库，未修改生产或既有管理员口令；后续真实测试通过。旧失败不是实验结果。
- 代码审查补上点按作废的动作/组号绑定检查：保留句子来源时仍必须核对 UUID 的原目标，不能忽略不一致的客户端定位。
- Supabase 当前 changelog 已核对：[CBC TLS 变更](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)不影响本项目现用 Node/Chromium 与 pooler；[PG 小版本变更](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)涉及本迁移未使用的索引/加密/自定义操作符。沿用验证 CA 的连接与带 owner 的 RLS。[官方 RLS 权限说明](https://supabase.com/docs/guides/database/postgres/column-level-security)。
- 安全 advisor 对新表无发现。既有两张 admin-only 备份表无策略是刻意 deny-all；Auth 泄露口令检测仍为既有未开启项，本次未改账号配置。

## 发布、回退与边界

迁移先于应用，向前兼容原 W1。最终精确 PR 提交全部检查成功后才合并；部署通过正式域名、真实 GoTrue 的两个新合成账号验收，并撤销登录会话/清理其数据，再与原 100 条备份复核。发布事实和证据以实际发生后补充为准。

必要时回退应用到上一部署，保留回执表和所有追加证据，不删除数据或回退 NULL。现有 `FEATURE_TODAY_SESSION` 可关闭新写入入口，历史读取仍保留。

本次不是通用自由聊天：更正语法仅支持次数，其他字段用点按；一次一句只处理一个动作、最多 16 组。没有 AI/模型后备、GPU 或付费调用。没有 IndexedDB 发件箱，待重试请求只在当前页面内存；不承诺断网刷新/冷启动。手机宽度 Chromium 不是 iOS/安卓/微信真机试用。下一步按第 3 周做本地发件箱和本次动作替换，先固定离线、重试与冲突验收，再开发，不需要开服务器。

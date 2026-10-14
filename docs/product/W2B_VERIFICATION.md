# W2b：一句话批量保存与补偿回执

2026-10-13（洛杉矶；执行记录使用 2026-10-14 UTC）。接续 [W2 任务](WEEK2_CODEX_BRIEF.md)、[W2a 解析](W2A_VERIFICATION.md)。本次用户已授权验证后合并上线；不需要 GPU，也不调用模型。

## 用户流程与设计原因

1. **先预览再确认**：`/today` 输入原话，可选当前动作；`/api/ai/parse-log` 只返回“规则草稿”。展示每组重量、次数、RPE，空值为横线。即使原话含“记下”，本版本仍统一点一次“确认保存这句话”，便于用户检查多组映射。计划、否定、缺单位、RPE 作用组不明时要求澄清，不能保存。
2. **只信服务端当前记录**：解析和提交都重新读取已认证用户的会话。客户端只提交原话、选中动作、预览摘要、命令 UUID/版本和新组 UUID；不能提交任意草稿、`approved`、实际值来源或他人上下文。`confirm_preview` 表示该写入请求的用户操作类型，不是模型颁发的授权令牌。
3. **整句话一个事务**：从原 `writeSet` 提取同一 PoolClient 内的单组写入。点按、句子和补偿复用数值/版本/事件规则。用户事务锁包住重新解析、全部组、事件和回执；任一目标过期/冲突会一起回滚。不向旧表双写。
4. **不确定结果重试同一操作**：命令 UUID 绑定 version=1 和按键排序的稳定内容摘要（SHA-256，沿用原 TodayStore 序列化格式）。相同请求返回现有状态及回执，改内容拒绝；提交成功但响应丢失时保留同一客户端请求。已撤销命令重放只返回补偿后的状态，绝不再次应用。
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

本地浏览器实际查看了 [三组与空 RPE](evidence/w2b/sentence-three-sets.png) 和 [补偿回执](evidence/w2b/sentence-compensation.png)。390px 无横向溢出、无 JS 错误。本地认证是既有替身；下面的正式域名验收另用真实 GoTrue，不混同两份证据。

## 执行中发现与处理

- 初始接入编译发现回执组件误插入单组组件的作用域；移回 TodayPage，TypeScript/生产构建和完整浏览器流程通过。
- 首次本机数据库连接用了过时的测试管理员口令，连接认证失败，未运行迁移。通过本机 WSL peer 管理创建专用测试角色和新隔离库，未修改生产或既有管理员口令；后续真实测试通过。旧失败不是实验结果。
- 代码审查补上点按作废的动作/组号绑定检查：保留句子来源时仍必须核对 UUID 的原目标，不能忽略不一致的客户端定位。
- Supabase 当前 changelog 已核对：[CBC TLS 变更](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)不影响本项目现用 Node/Chromium 与 pooler；[PG 小版本变更](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)涉及本迁移未使用的索引/加密/自定义操作符。沿用验证 CA 的连接与带 owner 的 RLS。[官方 RLS 权限说明](https://supabase.com/docs/guides/database/postgres/column-level-security)。
- 安全 advisor 对新表无发现。既有两张 admin-only 备份表无策略是刻意 deny-all；Auth 泄露口令检测仍为既有未开启项，本次未改账号配置。

## 发布、回退与边界

迁移先于应用，向前兼容原 W1。以下为实际发布记录，时间均为 2026-10-14 UTC：

1. **受检提交再合并**：[#69](https://github.com/Townzc/liftcut-tracker/pull/69) 的精确提交 `35996acf5d81ee39458e49a548333424d6dd40b3` [全部 8 项检查 SUCCESS](evidence/w2b/feature-final-checks.json)，其中原 tokenizer CPU 审计 15m11s。03:26:34 以 merge commit `e46c6a75d080b743fe97942a9999a5239cfc6342` 合入 main；受检/合并树同为 `1a802b4a0c751d11ced3703f787a21b6e3ed0e1a`。保留 W1 测试依赖的原提交历史，未 squash 或跳过检查。
2. **核对真实部署再登录**：Git 自动部署 `dpl_Bxo4q3S7iUsTcSo8Zp6yyNJRAue3` 于 03:27:46.001 READY；03:28:00 核对上述 main SHA、`icn1` 运行区和 `www.liftcuttracker.com` 正式别名，再开始测试。没有把 preview 当成生产，也没有重复手动部署。
3. **完整线上流程通过**：03:29:35 [正式域名浏览器结果](evidence/w2b/production-browser-result.json) 为 PASS，共 8 段流程。两个随机合成账号经真实 GoTrue → Vercel → 托管 PostgreSQL；预览/澄清不写入；三组双击与 3 个并发同 UUID 请求只留一份；第二组 UUID 冲突全回滚；次数 8→7→补偿为 8/v3；旧更正重放不覆盖；过期批次撤销全拒绝；保存和撤销均故意丢弃已提交响应，再重试同一请求；旧保存不复活 voided；跨账号读不到回执、预览/保存/撤销均 404；结束不补第 6 组，历史排除撤销组，刷新仍显示回执。
4. **独立查库而非只看提示**：03:30:43 查询确认 1 个 ended 会话、5 条组记录（2 done / 3 voided）、3 条原回执、2 条补偿回执、16 条事件。第 1/2 组点按补充 RPE 7/8，第 3 组原话 RPE 9 保留在作废证据；第 4/5 组仍为原 100 lb 的 kg 换算、RPE NULL；第 6 组无记录。原 100 条旧动作与私有备份双向 EXCEPT 差异 0。
5. **验收后清理**：03:31:10 仅删除本次精确 UUID 且带 `release_fixture=w2b-release-20261014` 的两个合成账号；先撤销 refresh token/auth session，再清理账号与级联计划/训练/回执/事件。所有夹具残留计数 0，恢复原 6 账号，原 100 条记录差异仍为 0。本地两份临时口令文件已删除；生产受限运行账号和 CA 保留。没有发送注册/恢复邮件或借用真实账号。完整 [部署与数据库核验](evidence/w2b/production-database-verification.json) 留存查询时间和合成结果。
6. **视觉和实际时长**：实看 [线上三组截图](evidence/w2b/production-three-sets.png) 和 [线上补偿截图](evidence/w2b/production-compensation.png)：初次 NULL/NULL/9 与后来 7/8/9、目标和实际、原话和撤销分别显示；390px 无横向溢出、JS 错误 0、模型调用 0。捕获的 3 条完成的浏览器 apply 请求为 498–896ms（含同请求重试），5 条规则预览为 572–1450ms；这是一次合成验收的 HTTP 观察，包含网络/服务开销，未覆盖 APIRequestContext 额外请求与中断请求，不报告稳定 p95 或提速倍数。

第 2 周的界面、事务、回执与正式域名验收至此完成。后续真实用户使用和真机测试仍需另记，不能用合成验收代替。

必要时回退应用到上一部署，保留回执表和所有追加证据，不删除数据或回退 NULL。现有 `FEATURE_TODAY_SESSION` 可关闭新写入入口，历史读取仍保留。

本次不是通用自由聊天：更正语法仅支持次数，其他字段用点按；一次一句只处理一个动作、最多 16 组。没有 AI/模型后备、GPU 或付费调用。没有 IndexedDB 发件箱，待重试请求只在当前页面内存；不承诺断网刷新/冷启动。手机宽度 Chromium 不是 iOS/安卓/微信真机试用。下一步按第 3 周做本地发件箱和本次动作替换，先固定离线、重试与冲突验收，再开发，不需要开服务器。

# W1 托管数据库与上线记录

日期：2026-10-13（洛杉矶）；下列操作时间统一用 UTC 2026-10-14。依据维护者本次明确指令“数据库迁移你能自行完成吗，然后按照任务继续”，执行原周任务中暂缓的生产迁移和发布。本次不使用 GPU、不调用模型。

## 迁移是什么

迁移是把已审查的表结构变更应用到现有数据库，不是搬家或删除旧记录。W1a 让实际重量、次数、RPE 可以保存 `NULL`；W1b 增加逐组记录、会话和追加事件。代码合并、数据库迁移、配置密钥、部署和浏览器验收是不同步骤。

## 实际环境与迁移证据

- 实际站点 `www.liftcuttracker.com` 由 Vercel 托管，浏览器使用的 Supabase 项目与本次迁移目标一致；旧 Docker/Aliyun 文档不是本次发布环境。
- Supabase 免费项目原先暂停；恢复后等待到 `ACTIVE_HEALTHY`。稳定状态为 15 张旧业务表、6 个账号、20 条训练、100 条动作明细。未新建项目或升级付费计划。
- **失败记录**：恢复仍为 `COMING_UP` 时，查询一度显示空表，过早作出空库判断。两次初始化尝试分别因 SQL BOM 和既有 `profiles_self` policy 报错，未形成成功迁移记录；期间还有数据库关停/拒绝连接。随后停止初始化，核实原表和数据存在，改用增量迁移。不能把这个恢复中的瞬时响应当成“原库没有数据”。
- 01:24:51 建立仅管理员可访问的 `w1_release_backup`：受影响动作表的 100 行快照及列定义。schema/table 权限撤销给 PUBLIC、anon、authenticated、service_role；两表强制 RLS，无放行 policy。**这是同库受影响表备份，不是全库或异地灾备**；真实内容不导出到仓库。
- 迁移前、快照、W1a 后按 ID 排序的行摘要均为 `8b51c1063b178b53bb7d4b354cc50924`；双向 `EXCEPT` 差异 0，行数 100。原 RPE=0 行数是 0，所以本次未改任何旧动作值。

| 实际托管迁移版本 | 对应操作 | 结果 |
| --- | --- | --- |
| `20261014012451` | 受影响表私有快照 | 100 行、摘要相同、普通账号无 schema 权限 |
| `20261014012511` | [W1a SQL](../../supabase/migrations/20261013234503_unknown_workout_actuals.sql) | 三列 `is_nullable=YES`；原行逐条相同 |
| `20261014012537` | [W1b SQL](../../supabase/migrations/20261014002316_today_session.sql) | 三表 ENABLE/FORCE RLS，浏览器仅本人读取 |
| 后续角色配置 | 新建的 `liftcut_workout` 启用 LOGIN | 非 superuser、无 BYPASSRLS、连接上限 12；无删除组/改写事件权限 |

平台工具生成的应用时间版本与源 SQL 文件时间不同，上表记录对应关系。旧项目此前没有迁移历史；不要不经核对运行 `db push`、重放 `schema.sql` 或把所有研究迁移补跑到此项目。

## 连接、安全与效率

1. 运行账户只授予计划/旧记录读取及新会话事务所需权限，不使用 postgres/service_role。凭据仅放服务端，未输出或提交。
2. 首次严格 TLS 连接报 `SELF_SIGNED_CERT_IN_CHAIN`。从 [Supabase 官方 Studio 配置](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json) 指向的 HTTPS 地址取得根证书，补充 CA，保留证书链和主机名检查，未使用 `rejectUnauthorized:false`。
3. 根证书 SHA-256 指纹为 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`，有效期到 2031-04-26。第一个区域 pooler 返回 tenant 不存在；实际 `aws-1-ap-northeast-2.pooler.supabase.com:6543` 连接成功，TLS authorized=true，current_user=`liftcut_workout`。没有用户 claim 时可见旧记录/新会话均为 0。
4. 新增 `WORKOUT_DATABASE_CA_CERT` PEM 配置；非 loopback 连接必须验证 TLS。拒绝 URL 中关闭验证或覆盖 CA 的参数。本机 loopback 测试仍可使用无 TLS 的隔离测试库。
5. 托管验收发现本机跨洲请求每次事务需要多个往返，部分保存约 5–6 秒；原 Vercel 运行在 `iad1`，数据库在首尔。本次把单一运行区配置为同城 `icn1`，避免服务端事务来回跨洲。不增加区域或机器，也不把本机开发环境与生产环境的差异当成受控性能实验。依据 [Vercel 区域指南](https://vercel.com/docs/functions/configuring-functions/region)。
6. 安全 advisor 无新增公开表 RLS 错误；私有备份“无 policy”提示是默认拒绝的预期状态。平台仍提示原有泄露密码保护未启用。性能 advisor 的旧策略逐行 auth 调用、外键索引建议留作单独的实测优化，不宣称已全部解决。

## 发布与验收

- #65 精确 `5ed487d` 的 7 项检查成功后于 01:28:56 合并为 `e41a74f`；#66 改以 main 为基线，精确 `8985e3b` 的 8 项检查成功后于 01:30:59 合并为 `fd50272`。保留提交历史。
- 本次 TLS 改动新增 3 项配置安全测试；全套 60 项单元测试通过，lint 0 error、2 条原有研究警告。
- 使用两个随机、明确标为合成验收的临时账号和合成计划；未给任何邮箱发送注册/恢复邮件，未借用真实用户账号。真实托管 GoTrue 密码登录已成功。
- 本机 Next → 托管 GoTrue → 同一托管 PostgreSQL 的完整浏览器验收于 01:37:39 通过：双击、服务端提交后丢弃响应、同请求重试、刷新三组、更正/撤销、旧请求 409、第二个真实认证账号读写隔离、结束后历史过滤。数据库复核为三条组记录、第二组 revision=3/voided、全部 RPE=NULL、7 条事件；原 100 行摘要不变。浏览器无 JS 错误。
- 第一次脚本默认 5 秒断言早于 5.1 秒 start 响应，服务器已创建一个空会话；先核实该会话为空，再调整验收超时并恢复它，没有重复创建。此为验收脚本超时，不冒充产品保存失败。
- 实际查看手机截图时发现长邮箱把页头横向撑开，给其 flex 容器加收缩约束；生产浏览器验收同时检查页面宽度。
- 本次最终生产部署及生产域名验收结果待发布后记录；以上本机应用联通托管服务的测试不冒充线上部署测试。

证据：[托管服务浏览器结果](evidence/w1-release/local-hosted-result.json)、[手机截图（合成账号，包含随后修复的页头溢出）](evidence/w1-release/local-hosted-three-sets.png)、[60 项单元测试](evidence/w1-release/unit.txt)、[lint](evidence/w1-release/lint.txt)、[最终构建](evidence/w1-release/build.txt)。

## 回滚与后续

先关闭 `FEATURE_TODAY_SESSION` 并重新部署，保留表和已保存记录；不要把 NULL 再填为 0 或删除表。连接/CA 配置需保留以读取已经产生的新历史。服务异常时由应用显示未确认结果，同 UUID 重试，不绕过版本规则。

W2 接续“一句话记录、更正、回执与解析评测”；无须 GPU。复杂文本、同上和目标组歧义要明确询问，不能默默复制目标 RPE。新的真实用户试用、真机微信与离线能力仍需后续实际验收。

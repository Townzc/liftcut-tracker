# 产品日志

## 2026-10-22 · M4 v6 GPU results and CPU attribution

- Actual: fixed T/S training and 4,160 new predictions completed; S scores 204/240 challenge, below the unchanged gate. Q8 agreement passes (98.17% HF / 98.46% F16), but missing-unit and RPE-scope reasons remain 9/15 and 0/15.
- Diagnosis: saved-output attribution separates literal names from resolved actions; S has 23 field-exact wrong available identities, nine resolved-equal names and two unknown names. Training-only audit reproduces 12,800 arm rows with zero policy errors; prompt alignment remains a hypothesis, not a proven cause.
- Recovery: all 135 run files/eight full weights and five complete streams restored and hashed; 31 frozen reports replay exactly. OFF verified 20:33:29 UTC after backup; completed timer cleared. Approx. ¥4.01 time proxy, not invoice.
- Verification: four new attribution/tamper/training regressions and root 9 JS + 243 TS pass; lint has zero errors/two existing warnings, production build passes. Exact-head CI required before merge. [Report and evidence](../../research/m4-parser/results/run-20261022T184300Z-v6/README.md).
- Limits/next: development failed; keep native off, UI and confirmation unchanged. Private 20 originals/derivatives remain excluded. Prepare isolated prompt-contract CPU comparison and storage recovery plan before the next GPU notice; continuous/device gates still follow model acceptance.

## 2026-10-22 · M4 v6 fixed comparison and scoring provenance
- Why: separate catalog exposure from shared alias repair and identify correct fields bound to the wrong exercise.
- Change: two original-base token-mean trainings, four fixed prediction streams, S-only selection, original numeric gates and separate field/binding reports. [Protocol](../../research/m4-parser/train/GPU_V6.md).
- Ran: 8 Linux runner checks; exact 1,040-input/token audit; 27 historical score objects replayed with provenance checked separately; 9 JS + 239 TS, lint (two existing warnings) and build pass.
- Restore found a cp936-decoded local protocol hash despite unchanged data; fixed the preparer to explicit UTF-8 and added a canonical-manifest regression assertion. Failed source restore is retained; corrected source/CI must pass.
- CI infrastructure: P1 timed out during Playwright dependency install, with Azure APT mirror requests hanging before browser tests. Both browser jobs now use the official Ubuntu HTTPS mirror and bounded APT waits; suite/gate/time limits are unchanged.
- Limits: H cloned as T/S tests report wiring, not new quality. CPU smokes use saved v1 weights. No GPU, private originals/derivatives, native flag, UI or confirmation change.
- Next: all exact-head CI plus actual full/incremental source restoration, then notify a fresh 3h-work/1h-reserve GPU window. Continuous/native/device gates follow model acceptance.

## 2026-10-22 · M4 v6 token preflight and recovery

- Change: fail before model loading if paired targets/sentences, allowlisted inputs or CPU-reviewed token hashes drift; version recovery to require a fresh v6 window.
- Ran: real token audit of 6,400 + 6,400 + 740 rows (max 296/294/295, no truncation), two two-step CPU SFT/export smokes, three input and eight Linux backup fault tests. [Evidence](../../research/m4-parser/results/catalog-v6-20261022/README.md).
- Prior app verification at #159: root 9 JS + 238 TS, lint/build and all 10 CI checks passed; this increment adds Python preflight/recovery, with full CI required again.
- Limits: smoke base is saved v1, weights remain private, no GPU efficacy or native enablement. UI and confirmation unchanged; private originals/derivatives excluded.
- Next: finish frozen runner/report replay/source restoration, then final CI before notifying a new GPU opening.

## 2026-10-22 · M4 v6 alias policy and CPU data consistency

- Why: 40 v4 training labels called registered bench aliases unknown; v5 also lost action binding and missing-unit decisions.
- Change: versioned v6 data fixes exactly those 40 targets in both arms; S changes only training-derived catalog membership/order. All 6,400 sentences and historical data/scores stay unchanged.
- Verification: 12,800 row audits, five mutation/data tests, root 9 JS + 238 TS tests, lint (zero errors/two existing warnings), production build pass. [Data policy](../../research/m4-parser/train/DATA_V6.md).
- Limits: no model-quality result, private originals/derivatives excluded, no UI/write/flag changes. CPU checks are synthetic-data audits, not a general parser.
- Next: freeze the two-arm runner, token audit, actual CPU train/export and restoration checks; final CI before a fresh GPU opening. Native/device acceptance remains gated.

## 2026-10-22 · M4 v5 results and reproducible error diagnosis

- Ran: two original-base 800-step trainings, 4,160 new predictions; T reproduces v4's 1,040 outputs and all four weight hashes. S remains the sole candidate and is rejected.
- Result: challenge 206→197/240, 8 gains/17 losses; 12 lost positives differ only in exercise, five missing-unit requests become incorrect records. Invalid reasons 7→0 and candidate truncations zero; Q8/HF 97.40%, Q8/F16 98.08%.
- Evidence: 131 run files/eight weights restored and hashed, 31 server reports reproduced, six additional offline reference scores. Platform OFF verified 09:10:15 UTC after backup; timer cleared, instance retained. [Report](../../research/m4-parser/results/run-20261022T071000Z-v5/README.md).
- CPU diagnosis: hash-bound scripts attribute every loss and regenerate training bytes; challenge catalogs are absent, inputs have no selected field. Forty training unknown-exercise targets conflict with the registered bench aliases used by nine challenge records; a policy mismatch, not causal proof. Historical scores stay unchanged.
- Verification: root 9 JS + 233 TS tests, full lint (zero errors/two existing warnings), build pass; added audit scripts separately type/lint checked. Exact-head CI required before merge.
- Limits / next: no UI, confirmation, migration or native-flag changes; originals/derivatives excluded. Unify alias policy with a CPU consistency check before a catalog/binding comparison and intent/field diagnosis; native/device gates stay closed, no new GPU notification yet.

## 2026-10-22 · M4 v5 loss comparison preparation

- Why: v4's ambiguous-RPE failures persisted; a coefficient audit found short clarification examples underweighted by token-mean loss, without proving causation.
- Change: frozen fresh token-mean T vs per-example S; same v4 data/prompt/base/seed, S only, 4,160 new predictions planned. V4 sources remain unchanged.
- Ran: 10 real CPU gradient tests, two-step SFT/export smokes of both objectives, 7 Linux runner tests, 1,040-row assembly/replay and 8 backup tests; TS type/lint pass. A C-drive-full export failure is preserved; fresh E-drive candidate recheck passes with a byte-identical adapter (three complete CPU smokes, one failed export).
- Limits: CPU smoke uses saved v1 weights, no new GPU or quality result. Candidate formats retain zero-truncation; historical/control failures are reported separately. Native stays off.
- Next: exact-head CI plus source restore, then notify a fresh user-opened 3-hour work/1-hour backup window. Private 20 originals/derivatives remain excluded.
- Operational review: 24 GiB exceeded the server's last observed free space; require 16 GiB from measured weight sizes plus a full archive duplicate and explicit reserves. Low-space preflight stops before dispatch; no asset deletion/upgrade assumed.
- Evidence: [v5 preparation](../../research/m4-parser/results/loss-v5-20261022/README.md), [protocol/runbook](../../research/m4-parser/train/GPU_V5.md).

## 2026-10-22 — M4 v4 results, restored evidence and loss audit

- **Actual**: one 800-step training, 5,200 new predictions and 1,040 cached A outputs; fixed A/B/C/D challenge scores 187/199/200/206 out of 240. D stays rejected, with no arm switch or extra training.
- **Failures**: D invents 138 fields (132 from ambiguous RPE scope); correct focus reasons 10/15 units, 0/15 RPE, 15/15 unknown exercises. Seven invalid clarification reasons and one repeated-set truncation remain. Q8/HF and Q8/F16 agreement pass at 96.54%/96.83%.
- **Evidence**: all 140 run files/four weights restored and hashed; 40 reports independently reproduced exactly, plus six first-offline reference scores. Platform OFF and timer cleanup verified 05:43:34 UTC; timer cleared after the first OFF observation, original deadlines unchanged. [Report](../../research/m4-parser/results/run-20261022T034000Z-v4/README.md).
- **CPU diagnosis**: clarification is 38.31% of rows but 16.15% of reconstructed batch loss coefficients. New source/tokenizer/data-bound audit and five arithmetic/input/source regressions pass; this is a hypothesis for a later controlled comparison, not a proven cause or changed loss.
- **Verification / next**: root 9 JS + 233 TS pass; exact-head CI remains mandatory. No private originals/derivatives in training, no UI/approval/model activation change. Prepare CPU gradient/padding checks and a new frozen experiment before another GPU notification; native/device acceptance remains gated.

## 2026-10-22 — M4 v4 bounded factorial runner

- **Changed**: archived/new weights × short/reason-list prompts, one original-base training, five new streams/5,200 predictions. D is preselected; all inputs, source and baseline bytes are bound before inference.
- **Gates**: retain original raw/quantization/source-v1 checks; add correct clarification reasons, useful positive accuracy and zero invalid reasons. Other arms and source-v2 cannot substitute a failed candidate.
- **Actual**: four Linux runner checks and 13 budget/timeout checks pass; full 9 JS + 233 TS, types/build pass, lint only two existing warnings. Real assembly verifies 1,040 IDs and replays archived A as 187/240; cloned diagnostic cells are wiring tests, not new results.
- **Limits / next**: exact-head CI and verified source backup before GPU notification; three work hours plus one backup/shutdown hour. No GPU yet, no UI or approval change, no private originals/derivatives in training. [Protocol, evidence and operation](../../research/m4-parser/train/GPU_V4.md).

## 2026-10-22 — M4 v4 controlled boundary data

- **Why / change**: isolate three v3 failure families; replace 720 rows with balanced missing-unit, RPE-scope and exercise-name pairs, retaining 5,680 rows and all evaluation bytes.
- **Actual**: four new regressions, full 9 JS + 232 TS tests, type/build pass; lint zero errors/two existing warnings. Real tokenizer audit has zero truncation; two CPU optimizer steps export finite updated adapters and restored KV caching.
- **Limits**: CPU smoke uses the saved v1 merged model and is not candidate accuracy. The 20 originals, paraphrases and outputs remain excluded from training. No GPU, UI, production data or confirmation changes.
- **Next**: freeze the 2×2 runner, original gates, pinned artifacts and deadlines; only after full CPU/CI checks notify the maintainer to open GPU. [Data card and evidence](../../research/m4-parser/DATA_CARD_V4.md).

## 2026-10-22 — M4 continuous confirmed workout conversation

- **Changed**: persistent confirmed references, immutable review approvals, current-turn numeric roles, changed-fields-only corrections, explicit inherited load, per-hand units, void and separately confirmed redo. All writes use the owner transaction/outbox; UI stays in chat.
- **Read truth**: progress answers use fresh database counts; uncertain reports remain uncertain in displayed prose. Missing records are never treated as unperformed exercises or confirmed completion. One bounded quote/list repair retains the same source guards.
- **Real provider**: 20 unchanged private originals in one conversation plus 3 fixed clarifying replies completed in `sdk-09`: 10 required original previews + 3 supplied-detail previews confirmed; 10 original clarification/read-only turns, zero contract failures. All pre-approval actual rows unchanged. Earlier failures/prose errors retained, not overwritten; observed development acceptance, not an unseen model benchmark or browser-to-real-provider test.
- **Verified locally**: 9 JS + 228 TS root tests; 96 browser scenarios, then 13 relevant scenarios after later contract changes; 9 conversation DB results and 7 live-SDK source/repair results; fresh-schema/null migration tests; mobile types + 12 tests; build and lint (zero errors, two existing warnings). Exact-head CI remains the release gate.
- **Privacy / isolation**: new tables force owner RLS, browser roles have no access, approval payloads cannot be edited, applied evidence cannot be deleted by runtime. Deleting chat removes unconfirmed review prose; no originals/outputs enter training or public fixtures. Source audit retains model provenance and record revisions.
- **Regression analysis**: old/new Q8 challenge 213/240 → 187/240: 42 regressions, 16 improvements; 20 clarification→record, 14 invalid clarification labels, 8 wrong record contents. Same 187/240 for HF/F16/Q8; quantization is not the main explanation. [Analysis](../../research/m4-parser/results/20261022-regression-analysis/README.md).
- **Limits / next**: additive production migration requires backup and verification before rollout. Native candidate remains rejected; no new GPU, device or mainland-network evidence. [Contract](M4_CONTINUOUS_CONVERSATION.md) · [aggregate evidence](../../research/m4-parser/results/20261022-continuous-agent/summary.json).

## 2026-10-21 — M4 v3 result, scoring recovery and runtime preflight

- **Result**: one fixed 800-step run, 4,160 outputs. Q8 agreement with HF/F16 is 97.69%/98.08%; challenge exact 187/240 and 153 invented fields regress from previous Q8 213/240 and 50. Candidate rejected; native stays off.
- **Failure / fix**: scoring hit a stale cached workspace after inference. Preserve the stopped run; offline frozen-source scoring produced 38 reports, matching the three existing server reports. Added preflight before inference, with three real filesystem tests and a Linux fail-before-prediction regression.
- **Backup / power**: 49 run files, all weights, four complete output files and operational evidence restored/hash-verified (3,084,378,205 bytes); platform OFF verified 2026-10-22T00:00:09.395Z. No deadline extension or additional training.
- **Pilot**: 20 unchanged originals, 20 CPU calls, no training use. Raw literal 2/6, guard acceptance 0/6; scripted continuous DB approvals do not establish natural Agent success.
- **Application**: #151 all nine checks passed; production READY on `1f36767`. Current-report role/target checks protect previews; UI and confirmation stay intact.
- **CI regression**: the 15-minute job ceiling cut the browser suite off at 42/95; a WebKit assertion also raced a completed reply. Hold the loopback provider's partial stream until the test explicitly releases it, checking navigation while still busy. Combine browser dependency installation and allow 35 minutes for DB/build/browser/Expo; individual assertions, timeouts and zero retries remain.
- **Verified**: root 9 JS + 219 TS tests, four Linux runner tests, own-checkout preflight, types and production build passed; full lint has zero errors/two existing warnings. All 15 local streaming/history browser cases, including WebKit and slow-network WeChat user-agent simulation, pass after the fixture fix. These are scripted HTTP/provider tests, not real-model or physical-device acceptance. Exact-head PR CI is required before merge.
- **Next**: connect pending/confirmed references and per-hand basis to the live workflow before another fixed experiment. No GPU needed now; native/device release remains gated. [Evidence](../../research/m4-parser/results/run-20261021T222100Z-v3/README.md).

## 2026-10-21 — Bind live workout proposals to the current report

- **Why / change**: cloud workout tools could quote old chat values, turn a load into a correction index or duplicate a reps quote into extra sets. Current-turn roles, exercise selection, set multiplicity and confirmed targets now gate previews; standalone exercise memory follows the same source rules and allows explicit historical dates.
- **Behavior**: uncertain, per-hand, multi-load and compound reports require clarification; corrections cannot silently become new sets. The existing signed preview, confirmation, version checks and shared write path remain.
- **Verified**: 19 targeted unit tests, root 6 JS + 219 TS tests, type checks and targeted lint. Production build, five real PostgreSQL results and nine model-chat/history browser scenarios passed before the final prior-set retraction guard; final CI reruns them. Scripted SDK responses verify rejected proposals leave data intact across both tools and approved correction updates one ID once, including concurrent retries.
- **Regressions caught**: CI rejected a fully stated report starting with “刚才那组”; narrowed the symbolic-load check and kept the original browser expectation. A later failing unit test showed a retracted value referring to a prior set could still append a record; both tools now require correction targeting. A self-contained report that retracts a value remains supported.
- **Limits**: no real cloud-model or physical-device score; this is a necessary source check, not a complete natural-language parser. Contextual inheritance and per-hand storage still need the versioned workflow; no native activation or UI change.
- **Next**: full CI and deployment verification; finish the separately frozen v3 GPU experiment, retain failures, verify backups and power off before any further M4 activation decision.

## 2026-10-21 — M4 pending context and fixed v3 experiment

- **Changed**: versioned pending previews distinguish unknown, approximate and previous-confirmed load; draft edits preserve omitted fields and cannot become saved records. Per-hand basis is retained and blocks unsupported scalar storage; compound requests leave the atomic parser. Numeric evidence also handles multiplication and English ordinals.
- **Verified**: 4 new context tests plus 6 prior role/reference tests, core/app types and targeted lint; root 6 JS + 210 TS tests. No UI caller or native feature activation.
- **Provenance**: new edits/inherited sets have their own source reference; approval references are recorded with the actual change in the same DB event. Existing source values and void evidence stay intact; database regression passed.
- **Experiment**: new v3 runner/protocol, existing 6,400 train / 740 dev unchanged, 1,040 unique evaluation inputs × 4 arms. Original gates/source-v1 remain; extra source-v2 comparisons do not replace them.
- **Actual / limits**: real file/hash/count assembly and original-utterance exclusion passed; 4 runner tests pass on Linux (3 + explicit skip on Windows), full process orchestration mocked. Prior real CPU SFT evidence remains historical; no new GPU/model calls.
- **Next**: exact commit all-green CI → notify maintainer for one bounded 4090 experiment → collect/verify/off. Development pass never enables native; full natural Agent/device acceptance still required. [Runbook](../../research/m4-parser/train/GPU_V3.md).

## 2026-10-21 — M4 numeric roles, confirmed references and README capture

- **Why**: load/count numbers could become target indices; contextual edits need confirmed IDs/revisions rather than draft or global-last values.
- **Changed**: separate role gate; correction/inherit/void previews; internal approval port checks the exact preview under the existing owner transaction and preserves idempotency. No HTTP caller/native activation or schema change.
- **Verified**: 6 new core tests; 4 real PostgreSQL results; 6 JS + 206 TS root tests; type checks/lint. Twenty original scenarios replayed with archived outputs and a separate scripted-confirmation DB lane.
- **Limits**: natural-language acceptance still fails; scripted approvals are not model success. Per-hand units, partial drafts and compound intents need a versioned boundary. No GPU/model calls or training-data change.
- **README**: recaptured the current home in Chromium with synthetic Auth + real local DB; ASCII periods in the image and tagline. Historical evidence retained.
- **Next**: close the contextual proposal gaps before a new fixed GPU experiment; native/real-device release remains gated. [Evidence](../../research/m4-parser/results/context-20261021/README.md).

## 2026-10-21 — M4 封闭解码 CPU 诊断

- **变化**：新增实验用 G1 语法、CPU 推理入口与输入边界检查；产品解析路径、界面、确认流程和冻结协议均不变。
- **实际运行**：既有 92 条输入、184 次配对 CPU 推理；原生边界 11 接受/18 拒绝，另保留一个语义错误反例；公开 CLI 四次推理复现对应输出，合计 188 次。
- **结果**：格式合法 83/92→92/92、正确 78/92→82/92，但多填字段 18→22；不启用或自动采用 G1。source-v2 正确接受 47/55，独立规则 54/55，不能声称模型增益。
- **验证与限制**：3 项无模型回归在 Windows/Linux 通过；保留首次零调用启动失败。旧样本诊断和本机时延均不是独立验收或手机性能。[报告与复现](../../research/m4-parser/results/closed-decode-20261021/README.md)。
- **新增口语检查**：维护者提供 20 条场景，另 40 次 CPU 推理；两臂只正确解析 2/6 可表示请求、守卫接受 0/6，另 14 条需上下文 Agent。原话仅作私有评测，未训练；连续工作流尚未验收。
- **下一步**：[新自然说法验收准备](../../research/m4-parser/NEXT_ACCEPTANCE.md)，与训练隔离；新候选协议和验收就绪后才通知开机。当前不需要 GPU。

## 2026-10-21 — M4 v3 开发数据与 CPU 训练准备

- **变化**：保留原 4000 条训练，替换 2400 条合成反例；覆盖前/后置否定与计划、次数/重量顺序和缺单位更正，提示不变。
- **隔离**：740 条开发数据与训练无模板 ID 或文本交集；已观察旧 test 明确转作开发，旧数据和分数不改，没有新独立测试。
- **实测**：根测试 200 项、类型检查通过；真实 tokenizer 最大训练/开发为 296/295 tokens。CPU 两步训练、有限权重/LoRA 更新和导出缓存核验通过，最终数据的冒烟输入哈希一致。
- **限制**：CPU 冒烟复用 v1 合并模型，只检查流程；未训练新 GPU 候选。[数据卡与证据](../../research/m4-parser/DATA_CARD_V3.md)。
- **下一步**：固定下一候选及验收设计并通过 CI 后再通知开机，端侧入口与确认流程保持现状。

## 2026-10-21 — M4 口语校验与独立规则对照

- **原因与变化**：原守卫拦截明确口语；新增 source-v2 版本，支持明确更正/重复/跳过和唯一泛称，保留 null、字段顺序、否定与计划边界。
- **实际运行**：6,160 条保存输出重放，零新模型调用；四组输出均零误接受。Q8 既有手写可执行请求正确接受由 14/39 到 33/39。
- **对照与限制**：独立新规则为 38/39，不能把覆盖改善当成模型收益；旧集合仅作诊断，原失败候选和门槛不变。
- **验证**：根测试 196 项、旧回归适配 6 项、类型检查、构建通过；lint 无错误、两条既有警告。[完整证据](../../research/m4-parser/results/source-v2-20261021/README.md)。
- **下一步**：封闭输出约束、按模板族隔离的数据和独立验收准备；服务器保持关闭，产品 UI/确认流程未切换到实验模块。

## 2026-10-21 — README 展示 XERJ 选录

- **变化**：项目主页加入 XERJ 官方贡献者徽章和简短中英文选录说明，链接官方贡献者记录。
- **核验**：实际打开 XERJ 公开页面确认选录；按维护者要求简化展示，详情由官方链接提供。
- **范围**：仅 README 和本日志；文档链接与差异已检查，未新增产品代码或测试。合并仍等待完整 CI。

## 2026-10-20 — M4 v2 完整结果、诊断与关机

- **实际执行**：固定显存恢复源码完成 800 步；四种输出各 1540 条。Q8 对 HF/f16 为 98.51%/98.70%，原始一致性通过。
- **未达标**：Q8 挑战集 213/240（88.75%）、schema 94.58%、多填 50 字段；候选关闭，云端 Agent、简洁界面与确认流程不变。
- **定位**：非法澄清原因、多生成组和模板外泛化不足；标准答案直接交给原话校验时，手写仅接受 14/39。固定长提示对照修复 4 条、退步 13 条，未采用。
- **实现与测试**：新增只读预测诊断工具及 4 项边界回归；根测试 195 项、类型检查、针对性 lint 通过。未更改评分器、模型协议或产品解析路径。
- **收集**：127 文件异地恢复逐项哈希一致，零模型调用重放 38 份报告；06:02:53 UTC 平台确认关机，原失败备份保留。
- **证据与下一步**：[完整结果](../../research/m4-parser/results/run-20261021T042106Z-v2/README.md)。先改进口语覆盖和按模板族隔离的数据，另备独立自然语言验收；新方案 CPU/CI 验证后再通知开 GPU，未进行端侧或真机验收。

## 2026-10-20 — M4 v2 训练显存恢复

- **原因**：新窗口的 1540 条基线完成，训练反向传播显存不足；没有候选模型，原失败完整保留。
- **实现**：激活重算减少训练显存；记录每步进度与峰值，导出恢复 KV cache。显式校验复用完整基线，保持原 batch、数据、超参、门槛与关机截止。
- **实际运行**：13 项 Linux 回归、真实 CPU 两步训练/导出通过；LoRA 权重更新与导出缓存配置已核验。失败十个文件异地恢复哈希一致。
- **证据与限制**：[恢复说明](../../research/m4-parser/train/MEMORY_RECOVERY.md)。新 GPU 候选、量化质量、端侧与真机均未完成；界面与确认流程不变。
- **下一步**：精确提交 CI 全绿后在本次原窗口恢复，完成或失败均收集备份并验证平台关机；未达标不启用模型。

## 2026-10-20 — 新库显式 API 权限与登录异常恢复

- **原因**：Supabase 停止新表自动授权；旧 schema 的 RLS 不授予表权限，读取设置失败会误跳 onboarding。
- **实现**：按实际调用为 15 张旧业务表授予最小 authenticated 操作；schema 与增量迁移一致。无 anon/service_role/全表默认授权，受限训练事务和批准流程不变；资料读取失败保留会话并显示 503 重试页。
- **实际运行**：全新/升级 PostgreSQL 的 8 项权限与跨用户检查、真实本地 GoTrue + PostgREST 手机宽度登录/保存/刷新/撤权恢复流程通过；根测试 191 项、构建/类型检查通过，lint 无错误。
- **托管**：先异地私有备份，再应用增量 grants；15 表 1715 行前后摘要一致。没有改密钥或旧授权，没有新公开 RLS 缺失。
- **证据与限制**：[权限矩阵和验收](API_ACCESS_GRANTS.md)。Docker 启动失败后改用官方独立服务二进制；本地 Auth 初次 search_path 配置失败保留，修正后新库通过。不代表生产账号、OAuth、存储或真机验收。
- **发布**：PR #142 九项检查成功后合并，受检/合并文件树相同；生产提交 `06c1e92` 为 READY。首页、Agent、设置的未登录请求均跳转登录页并返回 200；不是生产账号登录验收。

## 2026-10-19 — M4 全量 Q8 一致性通过，质量仍待训练

- **原因**：同引擎 f16 对齐用于区分转换/推理条件与低比特量化差异。
- **实际运行**：固定旧权重共 3180 条 CPU 推理；f16 与原 HF 1055/1060，Q4 为 941/1060，Q8 与 HF/f16 均 1047/1060（98.77%），通过原 95% 门槛，无 Q8 截断。Q8 639.4 MB。
- **证据**：[完整诊断、评分与哈希](../../research/m4-parser/results/quantization-audit-20261019/README.md)，原始指标和 canonical JSON 诊断分别核对，旧报告不改写。
- **限制**：Q8 旧 test 376/500，仍多填 141 个字段；守卫回放零误放行，但正确答案被拒绝较多。旧数据、同一笔记本并行其他验证，不是独立质量或手机速度验收。
- **下一步**：v2 训练包全部 9 项检查已通过并合入；已通知维护者可开 GPU，尚未开始新 GPU。完成质量、口语覆盖和真机验收前不启用端侧模型。

## 2026-10-19 — M4 v2 固定实验与候选门槛

- **原因**：修复补填需完整训练对照；量化与质量必须分开验证，不能靠全部追问提高安全分。
- **实现**：新入口固定 6400 条 / 800 步、旧权重+新提示基线、HF/f16/Q8 各 1540 条评测；固定原始 95% 一致性及独立安全/覆盖率门槛。核对源码、数据和基座哈希，3 小时总限时、绝对截止、失败不覆盖不重试。
- **实际运行**：组件真实 CPU 冒烟已完成；新增 8 项无模型执行器/门槛回归，覆盖完整模拟派发、错误输入、超时强杀、全追问与错误放行。GPU 尚未开机。
- **证据**：[v2 运行说明](../../research/m4-parser/train/GPU_V2.md)及 `protocol-v2.json`；旧权重 Q4 同引擎诊断仍未达标，Q8 完整结果待收集。
- **限制**：模拟派发不是模型结果；候选通过也不代表可发布，独立口语、守卫覆盖与真机验收仍待完成。现有界面与确认流程保持。
- **下一步**：CI 与 Q8 诊断完成后通知维护者开 GPU；核验备份后按原授权关机并确认平台 OFF。

## 2026-10-19 — M4 可核验推理输入与独立样本状态

- **原因**：量化差异需要与分词、附加起始符、跨样本状态和运行参数分开审计。
- **实现**：HF/GGUF 输入 token ID 必须一致；显式贪心/惩罚参数、逐条重置和双线程上限；拒绝答案泄漏、重复 ID、上下文截断和覆盖旧结果，保存 token 哈希与停止原因。
- **实际运行**：Linux 12 项无模型回归通过；旧开发样本 2 条分别在真实 HF/Q4 CPU 路径生成，输入 ID 与答案均一致，无截断。
- **证据**：[推理说明](../../research/m4-parser/train/INFERENCE_AUDIT.md)及固定的同引擎对照工具，完整对照仍在运行。
- **限制**：小样本只证明链路；不主张质量、因果或手机速度提升，没有启用模型写入。
- **下一步**：汇总完整 f16/Q4/必要时 Q8 对照，再冻结下一轮 GPU 协议；简洁界面与修改前确认流程保持。

## 2026-10-19 — M4 成对反例数据与新评测准备

- **原因**：首次模型在开发模板上分数高，但会在漏单位、计划、否定与相似动作上补填。
- **实现**：保留原 4000 条训练标签，新增 1200 对明确记录/应追问样本；训练 6400、开发 740、新合成挑战 240，修订短系统提示。旧评测仍只诊断，不进入训练。
- **实际运行**：数据隔离、标签/数值和无答案泄漏 3 项测试通过；真实 tokenizer 检查最长训练样本 296 token，无需截断。原分支根测试 185 项、完整 lint、类型检查和生产构建通过；并入原话校验后根测试 191 项通过。
- **证据**：[v2 数据卡和哈希清单](../../research/m4-parser/DATA_CARD_V2.md)。未运行 GPU 或新模型评测。
- **限制**：新挑战仍来自模板，不等于独立人类口语验证；没有教师标注。需先固定协议，包含旧权重+新提示对照、原始量化一致性、零误写及覆盖率门槛。
- **CPU 冒烟**：8 条新训练/开发样本、2 步、batch 1，实际训练及导出通过（45.2 秒）；复用旧合并权重，只验证链路，不代表新基座候选质量。
- **下一步**：完成有时限的执行器，全部检查通过后通知维护者开 GPU；线上界面与确认流程保持。

## 2026-10-19 — M4 原话字段校验与完整回放

- **原因**：只核对数字出现无法阻止重量/次数对调、动作混淆或漏单位时猜值。
- **实现**：共享核心新增有界语法校验，严格核对动作别名、字段角色、顺序、重复数量、RPE 范围和更正字段；任何未解释的子句或不一致都追问，不修补输出、不写入。
- **实际运行**：上轮 2120 条预测完整回放，误放行和多填字段均为 0；188 项根测试、lint、共享核心类型检查通过。构建发现新增测试的类型推断错误，显式标注后完整构建通过。
- **证据**：[校验报告](../../research/m4-parser/results/grounding-v1.md)记录每组分数、拒绝数、原始输出哈希和旧测试参与修复的边界。
- **限制**：手写集正确输入仍被拒绝较多；这是系统拒绝层，不是模型变好、独立验收或新增模型能力。未接入线上记录流程，简洁界面及确认语义不变。
- **下一步**：隔离推理引擎与量化误差，冻结新评测后再确定训练；质量达标后推进端侧接入和真机验收。

## 2026-10-19 — M4 完整入口修复、首轮 GPU 结果与线程校正

- **原因**：完整模式的结果目录后缀命令返回 1，被 `set -e` 提前终止；历史 CPU 冒烟只覆盖 `SMOKE=1`。
- **实现**：显式初始化目录、CUDA 要求、时限与强制停止；修复未来 Q4 预填充线程默认取 128 宿主机核数的问题，生成 / 预填充均遵守 `--threads`。本次运行源 `20a6109` 不变。
- **实际运行**：Linux 11 项、Windows 2 项无模型回归通过（含恢复时发现的 UTF-8 输出问题）；用户开启的 RTX 4090 上完成 500 步 LoRA SFT、两模型共 2120 条评测，流水线 2910 秒。合并模型 test 375/500，Q4 test 376/500；量化 JSON 一致性 946/1060，未达原定 95%。
- **证据**：[完整报告与指标](../../research/m4-parser/results/run-20261019T214240Z/README.md)，含固定来源、失败样例、权重哈希和备份恢复核对；模型权重及日志另存本机，关机与费用代理独立记录。
- **边界**：test 多填字段仍为 141 / 154，未接入产品记录；服务器完整生成时间不是手机首字，线程修复未测速度收益；没有教师标注、云端基线或真机推理。
- **下一步**：当前 PR 全部检查成功后发布；M4-6 先完善语义守卫与共用确认写入路径，再做原生集成和真机验收，不自动追加 GPU 训练。

## 2026-10-19 — 发布复核：记忆隔离测试按记录归属校验

- **原因**：#126 合并后的 CI 补跑中，旧测试用整段 JSON 不含 `199` 判断账号隔离；合法随机记录 ID 也可能包含这段数字而误报。
- **实现**：固定让本人记录 ID 含 `199`，改为核对本人事实的记录 ID 集合、他人记录 ID 不出现，以及另一个账号确实能读取自己的 199 kg / 100 cm 合成记录。产品查询、权限和数据语义未改。
- **实际运行**：同一合法 ID 在旧断言下稳定失败；修复后真实本地 PostgreSQL 记忆测试 10 项通过，修改文件 lint 和全量 TypeScript 检查通过。
- **进度**：M2/M3 发布队列 #122–132 及刷新冲突修复 #134 已合并，逐次核验相同提交的 Production READY 和正式域名只读访问；更新转型进展的实际状态与未完成边界。
- **边界**：历史失败保留作根因证据，不靠重跑掩盖；真实模型录制、原生安装包、真机及 GPU 仍未验证。
- **下一步**：本修复 CI 全绿后合并，核对最终生产版本；M4 开机前通知维护者并确认资源和预算。

## 2026-10-19 — 发布复核：相同训练快照刷新不再制造冲突

- **原因**：网页复盘补测发现，进入今日训练时相同的后台响应也递增发件箱版本，恰好点击开始会被误报为本机记录变化，操作未入队。
- **实现**：只有确认快照内容真的变化时才写入并递增版本；原有待同步操作、修订号、真实冲突检查保持有效。
- **实际运行**：新增浏览器回归在修复前稳定复现无数据变化时版本 1 → 2；修复后该回归及离线发件箱、日历、复盘接受和回滚共 16 项通过。生产构建与修改文件 lint 通过。
- **边界**：使用本地 PostgreSQL、合成账号和模型替身；不代表真机或模型质量验证。
- **下一步**：完整 CI 通过后随本轮发布，核对生产提交和只读访问。

## 2026-10-19 — M3-5 README 架构图与面试问答

- **原因**：方案第 4 节 M3：README 架构图与面试问答跟上手机端与 Agent 的实际状态。
- **实现**：README 新增“Web, mobile app and agent (2026-10)”Mermaid 图：共享核心、两端发件箱经同一版本化写入接口、白名单数据发给模型、模型只出草稿与封闭修改、批准账本与补偿撤销、进阶引擎、端侧解析顺序与守卫（标明 M4 仅完成训练准备）；原有生成计划架构图保留。`docs/Interview-QA.md` 新增第六部分 9 问（核心包、发件箱幂等、计划值与实际值、批准账本、封闭修改类型、数据白名单、复盘回放评测、M4 进度、演示视频的真实程度），未运行的内容写明“未运行”。
- **实际运行**：用 mermaid-cli 11.4.2 在本地渲染新图通过；链接指向的文件均存在。仅文档改动，未运行测试。
- **下一步**：M3 清单完成；按队列继续合并已推送的 PR（M4-3 起），M4 后半等 GPU 结果。

## 2026-10-19 — M3-4 90 秒演示脚本与录制

- **原因**：方案第 4 节 M3：新演示串起断网冷启动记录 → 联网同步 → 一句话更正 → 训练后复盘逐条接受 → 进阶引擎给出下次重量和理由。
- **实现**：[`DEMO_90S.md`](DEMO_90S.md) 分镜与重录方法；`tests/demo/demo-90s.spec.ts` + `playwright.demo.config.ts` 在 App 网页导出上按分镜操作（每步有断言），字幕标明合成数据与脚本替身；用 Chrome 屏幕录制接口按真实间隔采帧、系统 `ffmpeg` 编码成 WebM（环境里 Playwright 自带视频组件版本不匹配，按要求不运行 `playwright install`）。复盘只接受“目标 RPE 提高 0.5”，三组都到 10 次，进阶引擎给出“下次加 2.5 kg 到 62.5 kg”。顺带修复 App 组行输入框在网页导出里不收缩、RPE 被挤出屏幕的问题（`minWidth: 0`）。
- **实际运行**：录制脚本通过（2.3 分钟），视频约 74 秒、390 × 844、0.54 MB，逐段抽帧核对与分镜一致；App 端到端 8 项、App 类型检查与单元测试、lint、全量 tsc 通过。
- **脚本修正**：与 M2-4b 网页复盘测试的 CI 失败同因（开始操作入队前状态仍是“已同步”），开始训练后改为先等服务器上出现会话。修正后录制脚本重跑通过（2.3 分钟）；提交的视频仍是原录制，未替换。
- **边界**：网页导出不是真机；复盘回答是脚本替身；录制不在 CI 运行。
- **下一步**：M3-5 README 架构图与面试问答。

## 2026-10-19 — M3-3 App 历史页（训练日历与肌肉训练量）

- **原因**：方案第 4 节 M3 与第 6 节规则 4：手机与网页同一份统计逻辑。
- **实现**：人体图的几何形状（从零绘制的圆角矩形块）与按周分档的着色规则移入核心包 `muscle-volume.ts`，网页卡片改为引用；App 新增“历史”页（顶栏链接），用 Bearer 读取与网页相同的 `/api/workout-sessions/history`，用核心包 `trainingCalendar` 与 `muscleVolume` 计算，日历横向滚动并停在最近一周，只有有记录的格子可点；人体图用普通 View 绘制，没有新增依赖（拆分清单原写 `react-native-svg`，因图形只有矩形而改用 View）。主题加入 5 级灰度。
- **实际运行**：App 端到端 8 项通过，新增：记两组卧推、跳过一组、结束 → 历史页“训练 1 天，共 2 组”、今天格子“2 组”、只列“胸部 · 2 组”、胸部着色为第一档而股四头肌为无，请求只带 Bearer；截图 `node_modules/.cache/mobile-web/history-mobile.png`。网页日历与训练量 W1b 1 项复跑通过；App 类型检查、单元测试 12 项、Android/iOS 打包；根单元测试 176 项、lint、全量 tsc、核心包类型检查通过。
- **边界**：历史需要联网读取（未做离线缓存）；只含今日训练产生的会话记录，旧格式记录只在网页；真机未验证。
- **下一步**：M3-4 90 秒演示脚本与录制。

## 2026-10-19 — M3-2 肌肉训练量图（网页历史页）

- **原因**：方案第 4 节 M3：按身体部位看训练量；不使用 opengym 或任何 AGPL 素材，未知不当 0。
- **实现**：核心包 `muscle-volume.ts` 按动作目录的 10 个身体部位统计最近 7 天或 28 天（含今天）确认完成的组；部位只来自目录：新增 `bodyRegionOf`，精确匹配的目录动作部位一致才算，通用名（“深蹲”“划船”）只在所有以它结尾的目录动作部位一致时才算（“腿举”不当成“腿举机提踵”，“弯举”分手臂与腿而保持未知）；认不出的动作单列“未归类”。组数未知的旧记录只记“组数未知”。历史页新增卡片：自己画的正反面简化人体（圆角矩形块，从零绘制），按每周组数分档灰度着色（无、1–3、4–9、10+），旁边列出各部位组数；可切换 7/28 天。
- **实际运行**：单元测试 2 项（别名与通用名、未完成行不计、未归类、窗口含今天且不含之后、组数未知）；W1b Playwright 在 M3-1 用例上追加断言（卧推两组 → 只有“胸部 2 组”、胸部最浅着色、股四头肌未着色、切换 28 天）通过，截图 `node_modules/.cache/w1b/muscle-volume-mobile.png`（390 宽）。单元测试 176 项、lint、全量 tsc、核心包类型检查、构建通过。
- **边界**：每个动作只记一个部位（目录如此），复合动作的次要肌群不计；人体图是示意，不是解剖图。
- **下一步**：M3-3 App 历史页。

## 2026-10-19 — M3-1 年度训练日历（网页历史页）

- **原因**：方案第 4 节 M3：展示一年的训练连续性；展品方案第 2 节规则 1：只用确认过的实际值，未知不当 0。
- **实现**：核心包 `training-calendar.ts` 纯函数：把历史记录按训练时的本地日期汇总成 53 周 × 7 天（周一开始，到今天为止），每天按确认完成的组数分 0–4 级（1–5、6–11、12–19、20+ 组，阈值固定）。今日训练的每一行是一组；旧格式记录只说明动作已完成、没有组数，就把这天标为“有训练、组数未知”而不编造组数；跳过、撤销、未完成的行不计；今天之后的格子不显示。历史页新增“训练日历”卡：横向滚动、默认停在最近一周，只有有记录的格子能点，点后显示日期与组数；黑白灰度。
- **实际运行**：单元测试 3 项（周一到周日与今天截止、闰年；只计已完成行、同日多次相加、组数未知不加组；会话按本地日期计且跳过与撤销不计）；W1b Playwright 新增 1 项（记两组、跳过一组、结束 → 历史页今天格子“2 组”、全年只有这一个可点格子、汇总“训练 1 天，共 2 组”），今日训练与进阶相关 4 项复跑通过；W1a 访客 2 项通过（新增断言：旧格式记录显示“3 个动作已完成，组数未知”）。截图 `node_modules/.cache/w1b/training-calendar-mobile.png`。单元测试 174 项、lint、全量 tsc、核心包类型检查、构建通过。
- **边界**：没有月份标签，手机上只能横向滑动查看更早的周；App 端在 M3-3 做。
- **下一步**：M3-2 肌肉训练量图。

## 2026-10-19 — M3-0 展示打磨拆分清单

- **原因**：简报第 21 步：M3 先提交拆分清单再实现。M2 代码已全部推送，M4 后半要等 GPU 结果，M3 不受影响。
- **实现**：[`M3_SPLIT.md`](M3_SPLIT.md)：M3-1 年度热力图、M3-2 肌肉训练量图（自绘人体，按动作目录 10 个身体部位统计，识别不了的单列）、M3-3 App 历史页、M3-4 90 秒演示脚本与录制、M3-5 README 架构图与面试问答；每项写明约束与验证。
- **实际运行**：仅文档，没有代码改动；未运行测试。
- **下一步**：M3-1 年度训练热力图。

## 2026-10-19 — M2-7 手机端复盘卡

- **原因**：方案第 4 节 M2-7：训练结束后在 App 内复盘，逐条接受与回滚走 M2-4 的同一接口（第 6 节规则 4）。
- **实现**：复盘卡的账本步骤（核对预览哈希后批准、执行，重复调用发现已应用即返回；读取运行里的复盘修改；结果类型）移入核心包 `@liftcut/core/review-client`，网页卡片改用它，服务端结果类型也用同一份。App 今日页在训练结束且已同步后显示“训练复盘”：已在教练页同意才可请求复盘；逐条勾选、应用所选、都不采用、应用后撤销，均调用与网页相同的 `/api/workout-review` 与 `/api/agent/runs`（Bearer）。请求键在丢失响应后复用；最近一次复盘按账号存本机（只存运行编号），回到开始页时仍可撤销。
- **实际运行**：App 端到端 7 项通过，新增：网页对话经账本生成计划 → 手机开始训练、记三组深蹲、结束 → 复盘两条建议、取消第二条 → 双击应用 → 计划深蹲 4 组且 RPE 不变 → 撤销 → 回到 3 组；账本恰为 3 条已应用、1 条已拒绝，请求只带 Bearer。截图 `node_modules/.cache/mobile-web/review-mobile.png`。网页复盘 W1b 2 项（改用共享客户端后）、App 单元测试 12 项、类型检查、Android/iOS 打包、根单元测试 171 项、lint、全量 tsc、核心包类型检查通过。
- **测试修正**：网页复盘测试在 CI 首次失败（M2-4b）：开始操作写入本机发件箱之前状态仍是“已同步”，测试过早查库。手机端测试写法相同，改为先等服务器上出现会话；未在手机端单独复现，修正后 App 端到端 7 项通过。
- **边界**：复盘请求不带器械，不会建议换动作；真机未验证；脚本模型回复。
- **下一步**：M2 拆分清单完成；按队列等待 M2 各 PR 合并，之后继续简报中的下一阶段。

## 2026-10-19 — M2-6b 手机端对话确认身体/饮食记录

- **原因**：M2-6a 里身体、饮食、偏好草稿只能去网页确认；方案第 6 节规则 4 要求手机与网页同一写入路径。
- **实现**：`personal-records`（记录命令与条目的 zod 定义和显示行）原样移入核心包，网页原路径改为转出，两端用同一份校验和显示。App 新增 `PersonalQueue`，语义同网页的本机队列：每条确认的命令按自身 UUID 原字节保存，按序发到同一个 `/api/personal-records`（Bearer），服务器确认后才删除；双击与重试是同一请求，同 ID 不同内容被拒；401 暂停保留，400/404/409 停住队列直到放弃。队列放在 App 级共享层，今日页每 5 秒和回到前台时补发。教练页显示条目（未提供的值为“—”）与“确认补录”；新消息关闭未确认的草稿。计划草稿仍提示去网页批准。
- **实际运行**：App 单元测试 12 项（新增 2 项：双击一条、同 ID 改内容被拒、503 保留后原字节重发、确认后才删除、腰围保持 null；401 保留、409 停住直到放弃、账号互不混入）；类型检查、Android/iOS 打包通过。App 端到端 6 项通过，新增：对话补录“七十二点五公斤”→ 草稿显示“体重 · 72.5 kg / 腰围 · — cm”且数据库无新记录 → 双击确认 → 恰好一条、腰围为空、原话保存，请求只带 Bearer。网页 W1b 相关 31 项（对话、记录记忆、访客、教练、历史）、单元测试 171 项、lint、全量 tsc、核心包类型检查通过。
- **边界**：放弃被拒条目的按钮尚未放到界面（队列方法已有，网页同样极少出现）；手机端暂不显示已保存记录与撤销（网页可）；脚本模型回复，不是模型评测。
- **下一步**：M2-7 手机端复盘卡。

## 2026-10-19 — M2-6a 手机端对话（流式回复与训练草稿确认）

- **原因**：方案第 4 节 M2-6：App 内对话复用网页的 `/api/ai/coach` 流式接口；确认后的写入仍进 SQLite 发件箱（第 6 节规则 4）。
- **实现**：NDJSON 流的分帧与校验移入核心包（`@liftcut/core/coach-stream`，网页与手机共用；各端只负责读字节），同意版本与“最近六轮”历史规则也移入核心包。App 新增“教练”页：首次需同意，同意清单直接列出 `MODEL_DATA` 各类（与服务器过滤用的是同一份），可随时关闭；回复随流增长显示，只接受完整且通过校验的结果；来源显示主题、日期范围和条数。训练草稿用与“一句话记录”相同的组行显示，确认前再核对上下文哈希，一致才把服务器生成的同一操作放进发件箱；新消息会关闭未确认的草稿。身体/饮食记录和计划草稿暂时提示到网页确认，手机端不写。发件箱提升为 App 级共享，今日页与教练页用同一队列。
- **实际运行**：App 单元测试 10 项（新增 2 项：结果被扣住时第一段文字已显示、跨块的中文字符正确解码、Bearer 与同意版本、截断/错误事件/他人请求 ID/缺操作的草稿/429 都不成为回复）；App 类型检查、Android/iOS 打包通过。App 端到端 5 项通过，新增：同意清单条数等于 `MODEL_DATA` → 草稿显示“50 kg × 8 · RPE —”且数据库为空 → 确认 → 数据库一组、RPE 为空、来源 `user_said` → 第二份草稿不确认、发新消息后关闭且数据库仍一组；请求只带 Bearer。截图 `node_modules/.cache/mobile-web/coach-draft-mobile.png`。网页对话相关 W1b 44 项、全量单元测试 171 项、lint、全量 tsc、核心包类型检查通过。
- **边界**：端到端里跨域转发会把流整段缓冲，流式显示只由单元测试证明；真机上的流式读取（`expo/fetch`）未验证；回复用的是脚本模型，不是模型评测。
- **下一步**：M2-6b 手机端确认身体/饮食记录与查看计划草稿。

## 2026-10-19 — M2-5 复盘录制回放评测进 CI

- **发布复核**：Windows 检出时 CRLF 会让逐字节摘要校验误报过期；为 M2 摘要和录制文件固定 LF。48 个用例的摘要复核、5 项复盘单元测试通过；结果数字未改。

- **原因**：方案第 4 节 M2-5：复盘质量要在 CI 里可检查，但不调用付费接口。指标是“不该改时改了”次数、证据引用真实存在率、类型合法率。
- **实现**：复盘的系统提示与发给模型的用户消息移入核心包（`@liftcut/core/review-prompt`），服务端和评测共用，录下的回答总是对应线上提示。`research/m2-review`：48 个合成用例（6 类各 8 个；标签只由类别决定，写于任何模型回答之前），`record.ts` 每例一次付费调用录到 `recordings/`，`evaluate.ts` 回放所有录制和两条固定边界并写 `results/summary.json`。核心包评分：类型合法、证据真实率、可展示数、不该改却改、该改未改（含无效与缺失）、方向相反。CI 质量作业新增 `npm run m2:review -- --check`：生成器、评分或录制改了而结果没提交时失败。
- **实际运行**：本地 `npm run m2:review` 与 `--check` 通过；两条边界：一律不改 → 该改未改 16/16，一律加一组 → 不该改却改 32、方向相反 8，证据真实率都是 1（只说明评分能区分两种失败，不是模型成绩）。评分单元测试 2 项、全量单元测试 171 项、lint、全量 tsc、核心包类型检查通过；服务端改用共享提示后复盘数据库测试 6 项通过。
- **未运行**：真实模型录制：环境里的 DeepSeek 密钥返回 401，没有录到任何模型回答，也没有模拟。
- **边界**：标签是合成规律，不是对真实用户的教练判断；器械为空，换动作类型未覆盖；录制只代表某一模型版本。
- **下一步**：密钥可用后录制 `deepseek-chat-v1` 并提交；继续 M2-6 手机端对话。

## 2026-10-19 — M2-4b 网页复盘卡片（逐条接受与回滚）

- **原因**：方案第 4 节 M2-4：复盘修改在网页上逐条决定，确认后才改计划，应用后能一键撤销；冲突时不应用并让用户重新复盘。
- **实现**：今日训练结束且已同步后显示“训练复盘”卡片。已在 Agent 页开启教练的用户可点“复盘这次训练”（一次模型调用）；未开启时只给出开启链接。建议逐条显示（修改、理由、依据几组记录），默认全选，可取消勾选；“应用所选”依次调用 M2-4a 的接受接口和账本的批准、执行，执行前核对预览内容哈希；“都不采用”拒绝该预览。应用后显示“撤销这些修改”，走 M2-4a 的回滚接口再批准执行。请求键在丢失响应后复用，重复点击不会重复修改；计划已变化时提示复盘失效并可重新复盘。最近一次复盘按账号记在本机（只存运行编号），刷新后仍可撤销。模型替身新增复盘 JSON 回复（仅脚本，不是模型评测证据）。
- **实际运行**：W1b Playwright 新增 2 项通过（390×844）：只接受“加 1 组”并双击应用 → 计划深蹲 4 组且 RPE 不变、运行恰为 2 条已应用 + 1 条已拒绝；刷新后撤销 → 回到 3 组、新增一条已应用；另一设备先应用同一训练的复盘后，本机应用返回失效提示且计划不变，重新复盘后两项都应用。截图 `node_modules/.cache/w1b/review-mobile.png`、`review-undone-mobile.png`。W1b 全套 92 项通过；WebKit 1 项在本容器无法启动浏览器，未运行（CI 运行）。lint、单元测试、全量 tsc 通过。
- **测试修正**：首次 CI 两项失败：点“开始训练”后，开始操作写入本机发件箱之前状态仍是“已同步”，测试就去查数据库，还没有会话（CI 截图为“待同步 1 条”）。本机把 IndexedDB 写入延迟 800 ms 后复现同样的失败；改为先等服务器上出现会话、再等“已同步”，同样延迟下两项通过，W1b 全套 92 项通过（WebKit 1 项未运行）。产品代码未改。
- **边界**：复盘请求不带器械，所以不会提出换动作；按次请求，丢失响应后再点会再调用一次模型（计入额度）；英文界面未截图。
- **下一步**：M2-5 复盘录制回放评测进 CI。

## 2026-10-19 — M2-4a 复盘逐条接受与回滚（服务端）

- **原因**：方案第 4 节 M2：复盘的修改要能逐条接受，应用后能撤销；展品方案第 2 节规则：撤销是补偿动作、每次写入幂等、长期计划改动只走批准账本。
- **实现**：`POST /api/workout-review?action=accept`：只接受部分修改时，用复盘时的计划加上所选修改生成一条新的账本预览，替代原预览（原预览记为 declined）；全部接受则沿用原预览。只在原预览仍新鲜（复盘后计划、资料和计划依据都没变）时可用，否则 `CONTEXT_STALE`。`?action=rollback`：对已应用的复盘，生成一条恢复到复盘前计划的新预览；只在当前计划仍是该复盘应用的计划时可用，之后的修改不会被悄悄撤掉。两者都不调用模型、不计额度，仍需用户在账本里批准并执行；历史运行全部保留。同一请求键重试返回第一次生成的预览，全部接受在应用后重试仍返回同一运行；键被别的动作用过返回 `KEY_CONFLICT`。复盘记录（`workout_review` 事件，含复盘前计划）现在与预览在同一事务内写入。今日训练数据库测试作业补上了 M2-3 的复盘测试。
- **实际运行**：产品 PostgreSQL（本地 `postgres:16`）复盘测试 6 项通过，新增 2 项：只接受加组 → 新预览、原预览 declined、重试同一预览、批准执行后深蹲 4 组且 RPE 不变、回滚批准执行后回到 3 组、计划再变后回滚返回 `CONTEXT_STALE`；计划变化后旧复盘不能接受、跨动作复用键返回 `KEY_CONFLICT`、应用后再“全部接受”返回同一运行、越界序号返回 `REVIEW_NOT_FOUND`。账本相关的对话模型/执行/历史/计划对话/计划依据测试复跑通过。单元测试、lint、全量 tsc 通过。
- **未运行**：路由层请求（同源、登录、请求体）的端到端测试留到 M2-4b 界面的 Playwright。
- **下一步**：M2-4b 网页复盘卡片（逐条勾选、接受、回滚）与 Playwright。

## 2026-10-19 — M2-3 训练后复盘服务端（用户点按触发，结果进批准账本）

- **原因**：方案第 4 节 M2：训练结束后 Agent 输出封闭类型的离散修改或 `nochange`；长期计划改动只走批准账本（展品方案第 2 节规则 6）。
- **实现**：`POST /api/workout-review`（Cookie 或 Bearer，需同意版本）只在用户点按时调用一次模型，计入教练每日额度，同一请求键不会重复付费。服务读本次与之前最多 4 次结束训练里同动作的组（带组 ID，经白名单），以及计划里各动作的目标、进阶规则和替换候选（候选只来自用户选择的器械）。模型只能回 M2-2 的封闭 JSON；校验不过（含编造的组 ID、给重量的类型）一律不写。有效修改用 `applyReview` 算出新计划，作为一次普通的账本预览（待批准）提交，并在该运行上记一条 `workout_review` 事件保存复盘内容；现行计划不变。只支持经账本生成的计划（旧计划返回 `PLAN_NOT_EDITABLE`）。默认不自动生成（不额外花费模型调用）。
- **实际运行**：产品 PostgreSQL 新增测试 4 项（本地 `postgres:16`）：有效修改生成一条待批准提案、提案计划里深蹲 3→4 组而现行计划仍为 3 组、复盘事件已记录、发给模型的内容不含设置备注与用户 ID；编造证据、`set_weight` 类型、`nochange` 都不产生运行；他人会话无可复盘内容且不调用模型。单元测试（白名单哈希更新）、lint、全量 tsc 通过。
- **未运行**：API 路由的端到端请求（含额度与模型配置分支）留到 M2-4 界面的 Playwright；真实模型输出质量未评测（M2-5 录制回放）。
- **下一步**：M2-4 逐条接受与回滚。

## 2026-10-19 — M2-2 训练后复盘的封闭修改类型

- **原因**：方案第 6 节规则 1、2：引擎管数字，模型管结构；Agent 只能提出封闭类型的修改，新增类型必须同时有校验、应用和测试。
- **实现**：`@liftcut/core/review-changes`：复盘结果只能是 `nochange`（附理由与引用的组）或 1–5 条修改：`adjust_sets`（±1 组）、`adjust_rpe`（±0.5）、`switch_rule`（线性 ↔ 双重进阶，次数范围由代码算：5 → 5-8，8-12 → 8）、`replace_exercise`（只能选动作目录给出的替换候选，受可用器械限制）。不能给重量。`reviewProblems` 检查：引用的组必须存在且属于该动作、动作在计划里、范围不越界、规则确有变化、每个动作每类最多一条且替换不与其他修改并存。`applyReview` 纯函数，对计划里该动作的每次出现生效，不改输入。
- **实际运行**：单元测试 3 项（只解析封闭类型并拒绝重量/越界步长/多余字段、应用到每次出现且不改原计划、证据与边界与冲突检查）；核心包边界测试、lint 通过。
- **边界**：尚未接入服务端与界面（M2-3、M2-4）；动作按计划中的名称匹配。
- **下一步**：M2-3 训练后复盘服务端，结果进批准账本。

## 2026-10-19 — M2-1b 白名单覆盖计划依据与进行中训练

- **原因**：M2-1 只过滤了记录与记忆读取；教练的 `plan_context`（计划依据）和 `current_workout`（进行中训练）同样把个人数据发给模型（方案第 6 节规则 3）。
- **实现**：模型数据清单新增“进行中的训练”“生成或调整计划时的计划依据”两类（仅账号，访客不显示）；两个工具的返回值经同一过滤器，只保留列出的键（训练的动作与组逐条过滤）。单元测试固定计划依据的键（含 `profileContext` 的年龄、性别、身高、备注等与 `precautions`）：以后多发一个键，必须同时改同意清单说明。同意版本仍为 v1，列表哈希随之更新（这两类数据此前已在发送，属于写明而非扩大）。
- **实际运行**：单元测试 4 项通过；W1b Chromium 90 项通过（同意清单 9 项，教练读进行中训练与计划草稿的用例不受影响）；WebKit 规格本机未安装 WebKit，未运行。
- **边界**：计划依据内部（如目标、器械的取值来源）整体放行，以键名清单而非逐值约束；对话历史本身不在过滤范围内。
- **下一步**：M2-2 封闭修改类型。

## 2026-10-19 — M2-1 发给模型的数据白名单（记录与记忆读取）

- **原因**：方案第 6 节规则 3：发给模型的数据是白名单，新增字段必须同时更新同意界面的类别列表。
- **实现**：`@liftcut/core/model-data`：7 个类别（对话、身体、饮食、训练、已确认记忆、计划、个人设置），每类列出允许的字段；`allowModelRows` 逐字段过滤（训练组列表逐条过滤，计划里的食物整体保留），未列出的主题一律不发。教练的 `read_records` 与 `read_memory`（含访客本机记录）在进入本次请求时过滤，模型和来源卡看到的是同一份。同意界面改为从同一份列表渲染（访客不显示计划与设置两类）。列表哈希与同意版本绑定：改了列表而不升同意版本，测试失败。个人设置一项按生成计划时实际会发送的内容列全（年龄、性别、身高、伤病与饮食备注等，原文案概括为“生成计划所需的个人设置”），属于把原同意内容写明而非扩大，本次不要求用户重新同意。
- **实际运行**：新增单元测试 3 项（同意版本与列表哈希、过滤规则、确认记录与记忆的每个字段都在列表中）；产品 PostgreSQL 新增 1 项：身体、饮食、训练、计划、设置、记忆的真实读取结果经过滤后不丢任何字段（本地 `postgres:16`，coach-model 8/8）；W1b Chromium 90 项通过（含同意列表 7 项/访客 5 项断言与截图 `model-data-consent-mobile.png`；之后只改了个人设置一项的说明文字，未重跑浏览器测试）；WebKit 规格本机未安装 WebKit，未运行。
- **边界**：`plan_context`、`current_workout` 的返回值尚未过滤，列为 M2-1b。
- **下一步**：M2-1b。

## 2026-10-19 — M2 拆分清单

- **原因**：简报第 18 步：M2（App 内 Agent）先在 PR 中提交拆分清单再实现。
- **实现**：`docs/product/M2_SPLIT.md`：列出已有基础（网页流式对话、来源卡与确认卡、批准账本、进阶引擎、单一同意开关）和 7 个子任务：发送数据白名单与同意界面同源、封闭修改类型与纯函数应用、训练后复盘服务端（结果进批准账本）、逐条接受与补偿回滚、复盘录制回放评测进 CI、手机端对话、手机端复盘卡；每项写明约束与验证方式，以及开始复盘前要维护者决定的触发方式（建议用户点按触发）。
- **实际运行**：仅文档；现状描述对照了 `coach-conversation.tsx`、`coach-agent.ts`、`agent/store.ts`、`training-program.ts` 的代码。
- **下一步**：清单 PR 合并后按顺序实现 M2-1。

## 2026-10-19 — M4-5 GPU 训练交接

- **原因**：简报第 17 步：云端会话不能 SSH，GPU 训练由维护者开服务器后执行。
- **实现**：`docs/product/M4_GPU_HANDOFF.md`：服务器要求（显存 ≥ 16 GB、数据盘 ≥ 20 GB、估计 45–90 分钟、4 小时总时限、费用上限约 10 元）；国内获取基座（ModelScope，与 Hugging Face 修订逐字节相同，按哈希校验）、清华 PyPI 与 npmmirror 镜像、可复用服务器自带 CUDA torch；一条命令；结果只带回指标与哈希（新分支推送），权重留数据盘；完成后关机与记录用时；失败保留日志、最多手动重试一次。
- **实际运行**：文档中的时长来自本会话的 CPU 冒烟实测（370 秒）与估算，GPU 时长未实测；命令中的环境变量均为 `run_all.sh` 已实现的选项。
- **下一步**：在会话中通知维护者可以开服务器；继续 M2 拆分清单。

## 2026-10-19 — M4-4 端侧解析模型训练包（Qwen3-0.6B）

- **原因**：简报第 16 步：固定种子的 SFT、评测、GGUF 导出与量化一致性检查，一个入口、有总时限，先在 CPU 上跑通。
- **实现**：`research/m4-parser/run_all.sh`：环境检查 → Python 环境（`torch==2.14.1` 与固定版本依赖）→ 基座 `Qwen/Qwen3-0.6B`（Apache-2.0，固定修订，7 个文件按哈希校验；ModelScope 与 Hugging Face 文件经核对相同）→ 数据（按清单哈希校验）→ LoRA SFT（`train/sft.py`，只对答案计损失，种子固定，不联网）→ 合并模型评测 → llama.cpp 转 f16 并量化 Q4_K_M（转换器取自固定版本 `llama-cpp-python==0.3.36` 源码包，哈希与 PyPI 一致）→ 量化模型评测 → 一致性（`consistency.py`）→ 只把指标和文件哈希写入 `results/run-*`，权重留在 `WORK_DIR`。总时限 `MAX_SECONDS`，每步记录用时与退出码，失败步骤的日志末尾写入结果目录。微调用一行系统提示（`SFT_SYSTEM_PROMPT`），手机端提示更短。
- **实际运行**：CPU 冒烟（`SMOKE=1`，真实基座、16 条、3 步，在本提交的父提交 + 本次文件上运行）全部步骤跑通，370 秒：训练 67 秒、合并模型评测 48 条 152 秒、导出 38 秒、Q4 评测 83 秒；结果见 `results/run-20261019T102235Z-smoke/`。3 步模型的输出是 JSON 但不合 schema（0/48），编造 0，量化前后一致率 0.06，最终状态 `done-consistency-below-threshold`：这只证明流程可用，**不是模型效果**。第一次冒烟暴露“一致性未达标时脚本中止、不写哈希”的问题，已修正后重跑。Python 编译检查、lint、全量 tsc 通过；未安装 shellcheck，未运行。
- **未运行**：GPU 训练与正式评测（待维护者开服务器，见 M4-5 交接）。
- **下一步**：M4-5 GPU 交接文档。

## 2026-10-19 — M4-3 解析基线（规则）与云端基线脚本

- **原因**：简报第 15 步：在开发集和测试集上跑规则解析器和 DeepSeek，结果入库，作为端侧模型的对照。
- **实现**：共享提示词 `research/m4-parser/src/prompt.ts`（只给动作名和原话，不给计划值；云端基线与端侧微调用同一格式）；`scripts/predict-deepseek.ts`（温度 0、JSON 模式、并发 4、失败重试一次、按 id 断点续跑，密钥由环境代理注入，脚本不读不发）；规则基线指标入库 `research/m4-parser/results/`，说明见其中 README。
- **实际运行**：规则解析器 dev 163/500、test（留出模板）142/500、手写 24/60 完全一致，150 条规则评测 150/150；test 上**编造 6 次**，均为“无单位重量，逗号，次数”（如“10，3次”）被读成两组，已列为待维护者决定的线上行为问题。DeepSeek 脚本仅在本地桩服务上验证（请求格式、500 重试、续跑、代码块输出可解析）；真实 API 返回 401，基线**未运行**。新增测试 1 项（提示词不含计划值、训练目标可被评测判为满分）。
- **下一步**：M4-4 训练包（Qwen3-0.6B）；DeepSeek 密钥更新后补跑云端基线。

## 2026-10-19 — M4-2 统一解析评测工具

- **原因**：简报第 14 步：规则解析器、云端模型、端侧模型要在同一份测试集上用同一套指标比较。
- **实现**：`@liftcut/core/eval/parse-label-eval`：把任一系统的答案按条目自带的会话状态解析成“会保存什么”（动作、组号、各组值或更正内容），对不上会话的一律当作追问；规则解析器的草稿走同一条解析路径。指标：完全一致率、意图准确率、字段准确率、**编造次数**（标准为空却给了值，含该追问却给了值）、遗漏率、更正定位准确率、追问精确率/召回率、JSON 与 schema 合法率、延迟 p50/p95。模型输出只容忍代码块包裹，不做修补；缺答案按无效输出计。命令 `npm run m4:eval`。
- **实际运行**：新增测试 5 项（会话解析与越界追问、模型文本合法性、编造/遗漏/更正定位/追问指标、全部数据集的标准答案都能解析回自身意图、规则草稿与标签同路解析）；`npm test` 6 + 161、lint、全量 tsc、核心类型检查通过。开发中试跑规则解析器：手写集完全一致 24/60、生成 dev 185/500，编造 0；正式基线在 M4-3 记录。
- **下一步**：M4-3 基线入库（规则；DeepSeek 待密钥更新）。

## 2026-10-19 — M4-1b 模板合成解析数据、手写测试集与数据卡

- **原因**：简报第 13 步：先生成结构化标签再生成句子，覆盖多组、部分 RPE、kg/lb/公斤/磅、自重、跳过、结束、更正、同上、中英混杂、口语数字和应追问的含糊句；评测集绝不进入训练。
- **实现**：`research/m4-parser/src/synth.ts` 按固定种子抽标签、按 137 个模板渲染句子（21 类，含 10 类追问原因）；test 只用 41 个留出模板。每条必须通过标签 schema、数字/单位一致性和动作在列表中，否则构建失败；每条带与句子相符的会话状态（已完成/计划组数）。`scripts/build-data.ts` 生成 train 4000 / dev 500 / test 500（不入库）与带哈希和分布的 `data/manifest.json`；另手写 60 条自然口语评测集（含干扰数字）。数据卡 `DATA_CARD.md`。生成器暴露并修正了核心数字读取的三个问题（“千克”的“千”、`60kg5个`、“十一下”），已并入 M4-1a。
- **实际运行**：`npm run m4:data` 与 `--check` 通过（1.6 秒）；新增测试 5 项：清单逐字节复现、全部条目通过校验且 test 只用留出模板、评测文本（dev、test、手写、150 条）不在 train、手写标签有效、口语数字往返一致；`npm test` 6 + 156、lint、全量 tsc、核心类型检查通过。
- **边界**：模板句式比真实口语整齐；精确去重不排除固定短语的近义改写；尚无模型改写。
- **下一步**：M4-1c 可选的 DeepSeek 改写与过滤率；M4-2 统一评测工具。

## 2026-10-19 — M4-1a 解析标签规格与确定性数字校验

- **原因**：M4 端侧解析模型要先有“标签是什么”和“句子与标签是否一致”的确定性标准（方案第 4 节 M4；简报第 13 步：先生成标签再生成句子，改写必须通过数字与单位校验）。
- **实现**：`@liftcut/core/parse-label`：与上下文无关的标签 v1（记录多组、同上、更正、跳过、结束、追问及原因），只含句中说出的值：重量与单位成对、RPE 以 0.5 为步长、未说即 `null`，组号/记录 ID/公斤换算留给确定性代码按会话解析；`numbersIn` 读出句中数字（阿拉伯数字、口语中文数字如“一百二”“七点五”、英文数词与序数），可先去掉动作名（“三头肌下压”不是 3），并忽略“最后一组”“一下”等固定说法里的“一”；`unitsIn` 区分 kg、lb 与“斤”；`labelTextProblems` 检查标签的每个数字都在句中、句中没有标签解释不了的数字、单位一致。端侧守卫（M4-6）将复用同一函数。
- **实际运行**：新增单元测试 3 项（schema 接受/拒绝、数字与单位读取、一致性检查）通过；核心包类型检查与 lint 通过；对现有 150 条评测中所有记录/更正句，标准答案里的数字都能被 `numbersIn` 读出（0 遗漏，临时脚本，未入库）。
- **边界**：口语数字只覆盖健身常用写法（不含“两三个”这类模糊量，它们应当追问）；英文“one”作代词时会被当成 1，生成器避免这类句式。
- **下一步**：M4-1b 模板合成数据、手写测试集与数据卡。

## 2026-10-19 — M1-6 EAS 构建配置

- **原因**：方案第 4 节 M1-6：开发版和安卓内部测试版要能在真机上安装，验证 SQLite、通知、常亮、震动。
- **实现**：`apps/mobile/eas.json` 两个内部分发配置：`development`（`expo-dev-client`，APK）和 `preview`（安卓内部测试 APK，版本号远端自增），不含上架配置。新增 `expo-dev-client`、`expo-system-ui`（安卓跟随系统深色模式）；`app.json` 移除模板默认的存储读写和悬浮窗权限。`MOBILE.md` 写明维护者首次构建步骤：`eas login`、写入包名、`eas init`、用 `eas env:set` 设置公开配置、`eas build`。
- **实际运行**：App 类型检查、单元测试 8 项、Android/iOS 打包、`expo install --check`、`expo-doctor` 20/20 通过；`eas.json` 用 eas-cli 25.2 的 `@expo/eas-json` 解析通过；`expo prebuild --platform android` 生成原生工程并核对权限与主题（生成目录未提交）。
- **未运行**：EAS 云端构建、安装包、真机（需要维护者的 Expo 账号和手机）；iOS（需要付费 Apple 账号，暂不做）。
- **待维护者决定**：Expo 账号由谁操作、安卓包名（建议 `com.liftcuttracker.app`），已在会话中询问。
- **下一步**：M4-1 解析数据规格与合成。

## 2026-10-19 — M1-5 手机端一句话记录

- **原因**：方案第 4 节 M1-5：在手机上用一句话记录，和网页同一份规则解析、同一条确认后写入路径（第 6 节规则 3、4）。
- **实现**：App 今日页新增“一句话记录”：可先选动作，原话用共享核心的规则解析器在本机生成草稿（断网也能预览），信息不足时给出澄清原因而不猜；预览列出每组重量、次数、RPE，未报告的显示“—”且不取计划值。确认后与网页相同的 `apply` 命令（客户端命令 ID、组 ID、`confirm_preview` 授权、上下文哈希）进入 SQLite 发件箱，联网后服务器再次核验并保存。上下文哈希用 `expo-crypto` 对同一规范序列化计算；预览后若又记了组，确认时自动重新预览，避免服务器判 `STALE_CONTEXT` 而暂停队列。最近 5 条回执可撤销，撤销是补偿命令，原记录保留为已作废。
- **实际运行**：App 类型检查、单元测试 8 项、Android/iOS 打包、网页导出、根 lint 通过；App 端到端 4 项通过，新增：含糊原话只得到澄清提示→完整原话预览两组且数据库仍为空→确认→数据库两组来源为 `user_said`、未说的 RPE 为空→回执撤销→两组变为已作废，请求只带 Bearer。截图 `node_modules/.cache/mobile-web/sentence-mobile.png`。
- **边界**：只有规则解析；网页上规则解析失败时的模型补录（服务器端）手机端尚未接入；“预览后自动重新预览”的分支没有单独的端到端用例；真机键盘与输入法未验证。
- **下一步**：M1-6 EAS 构建配置（需要维护者的 Expo 账号与应用标识，会在会话里询问）。

## 2026-10-19 — M1-4b 手机端 SQLite 离线发件箱

- **原因**：方案第 4 节 M1-4：断网冷启动可以记录，联网后按顺序补发，语义与网页一致（第 6 节规则 4）。
- **实现**：`MobileOutbox` 基于共享投影：客户端 UUID、原字节按序补发、队头未确认不跳过、冲突暂停整个队尾并由用户选择保留云端版本、登录失效暂停、网络错误退避重试与“立即同步”；同一操作重复点击只入队一次，内容不同的同 ID 操作被拒。原生端存 SQLite（`expo-sqlite`，按账号一行），网页导出用 AsyncStorage。今日页改为渲染“已确认快照 + 待同步操作”的投影，冷启动先显示本机数据；每 5 秒、回到前台和手动时补发。
- **实际运行**：App 单元测试 8 项（新增 3 项：断网冷启动后三组按序同步且恰好三条、双击与丢失响应只记一次、冲突暂停与放弃、认证暂停）；类型检查、Android/iOS 打包，并在不含根依赖的干净副本中复跑通过。App 端到端 3 项通过，新增：服务器断开时记三组→数据库仍为空→重新加载（冷启动）仍显示三组与“待同步 3 条”→恢复后“立即同步”→数据库恰好三组、次序与次数正确、请求只带 Bearer。截图 `node_modules/.cache/mobile-web/offline-queued-mobile.png`。
- **边界**：断网开始新训练只能排队（需要服务器确认处方）；两台设备同时修改由服务器修订号判冲突后暂停，真机双设备未测；SQLite 只在原生运行，CI 里没有真机执行。
- **下一步**：M1-5 一句话记录。

## 2026-10-19 — M1-4a 离线发件箱投影迁入共享核心

- **原因**：手机端 SQLite 发件箱要沿用网页的客户端 UUID、顺序补发和冲突暂停语义（方案第 4 节 M1-4、第 6 节规则 4），先让两端用同一份投影代码。
- **实现**：`workout-outbox.ts`（待同步操作的本地投影、操作 ID、冲突检测、重试/认证/冲突判定、确认合并）原样迁入 `packages/core`；其中唯一的 `structuredClone` 换成新的 `plain-data.ts` 纯数据深拷贝（保留值为 `undefined` 的键，规范序列化不变），因为 Hermes 不保证提供 `structuredClone`。解析评测的深比较/深拷贝改为复用同一文件。网页的 IndexedDB 客户端保持不变。
- **实际运行**：`npm test` 6 + 148、核心包类型检查、lint、构建通过；解析评测输出与 M0-2 前逐字节一致；产品 PostgreSQL 发件箱/替换/对话模型测试 17 项通过；W1b Playwright 发件箱、替换、一句话、今日、组间计时、对话共 34 项通过。
- **下一步**：M1-4b 手机端 SQLite 发件箱与离线记录。

## 2026-10-19 — M1-3c 手机端组间计时通知、常亮与震动

- **原因**：方案第 2、4 节 M1：健身房里省事的是计时、常亮和反馈，并且锁屏或切到后台时也要提醒。
- **实现**：完成新的一组后开始组间休息（60/90/120/180 秒，按设备记住），App 内顶部倒计时可 +30 秒或结束；同时用 `expo-notifications` 在休息结束时间排一条本地通知，锁屏或在后台也会提醒，延长或结束会重排或取消，结束训练时取消。通知权限只在第一次开始休息时询问，拒绝则只保留 App 内计时。训练进行中用 `expo-keep-awake` 保持常亮；完成一组成功震动，跳过/撤销轻触震动。计时按墙钟计算（纯函数并有单元测试），App 挂起后恢复不会算错。
- **实际运行**：App 类型检查、单元测试 5 项（新增计时 1 项）、Android/iOS Hermes 打包、网页导出通过；App 端到端用例新增：完成一组才开始计时、所选时长生效、+30 秒、结束、跳过不计时，2 项全部通过。
- **未验证**：通知、常亮和震动只在真机上有效；网页导出里这些调用被跳过，真机和通知权限流程未测（需要开发构建）。
- **下一步**：M1-4 SQLite 离线发件箱。

## 2026-10-19 — M1-3b 手机端今日训练记录

- **原因**：方案第 4 节 M1：手机上记录今日训练，且与网页共用同一套写入路径和幂等语义（第 6 节规则 4）。
- **实现**：点按记录一组的请求构造（预填来源、跳过不带实际值、撤销为补偿写入）抽成 `@liftcut/core/set-requests`，网页记录行改用它，App 也用它。App 今日页：选训练日并开始（客户端 UUID、设备时区）、每组预填上次重量和次数（RPE 不预填）、完成/跳过/撤销、结束训练；动作卡显示计划和进阶引擎的理由。每个未保存行的 UUID 在提交前就固定，断网失败后再点一次是同一写入，不会重复记录；409 冲突时重新读取服务器版本。
- **实际运行**：核心单元测试 3 项（预填来源、跳过、补偿撤销）；网页 W1b 写入相关 Playwright 29 项回归通过（今日、组间计时、进阶、一句话、离线发件箱、替换）；App 类型检查、单元测试、网页导出通过；App 端到端新增 1 项：开始→预填完成→改次数完成→跳过→撤销→结束，数据库逐行核对来源、修订号与状态，所有 API 请求只带 Bearer。截图 `node_modules/.cache/mobile-web/record-mobile.png`。
- **边界**：仍需联网（离线发件箱在 M1-4）；更正已保存的组、一句话记录、组间计时通知、常亮、震动在后续任务；真机未验证。
- **下一步**：M1-3c 组间计时本地通知、屏幕常亮、震动反馈。

## 2026-10-19 — M1-3a 今日训练写入契约迁入共享核心

- **原因**：方案第 6 节规则 4：手机与网页共用同一套写入接口和幂等语义。手机端记录前，先让两端用同一份 schema 构造请求。
- **实现**：`today.ts`（开始/记录一组/结束 schema、会话类型、`sessionsToWorkoutLogs`）、`workout-commands.ts`、`exercise-replacement.ts`、`workout-context.ts` 的纯函数（规范序列化、上下文、`storedSet`）原样迁入 `packages/core`，网页、服务端与测试改为从核心包引用。只有用 Web Crypto 计算的 `localContextHash` 留在网页（`src/lib/workout-context.ts`），因为 React Native 没有 `crypto.subtle`，手机端将用自己的加密模块对同一规范序列化计算哈希。行为不变。
- **实际运行**：`npm test` 6 + 145、核心包类型检查（无 DOM、无 Node 类型）、lint、构建通过；本地 `postgres:16` 上 P1 32、W1a 1、产品 PostgreSQL 77 项通过；完整 W1b Chromium 89/90（唯一失败为 M0-5a 规格的刷新竞态，已在 #98 修正）；App 网页导出端到端 1 项通过。
- **下一步**：M1-3b 手机端今日训练记录。

## 2026-10-19 — M1-2 Expo App 骨架

- **原因**：方案第 3、4 节 M1：原生 App 与网页共用核心代码和接口，先建立能登录、能读数据的骨架。
- **实现**：`apps/mobile`（Expo SDK 58、TypeScript、expo-router 的 `Stack.Protected` 登录保护）：邮箱密码登录（与网页同账号）、今日页（计划训练日或进行中训练的处方，动作名用 `@liftcut/core` 的动作目录）、设置页（跟随系统/中文/English、账号、退出）、黑白主题跟随系统深浅色、项目标志生成的图标。请求只带 Bearer 令牌和 `X-Workout-Owner`；令牌失效自动退出到登录页。
- **工程决定**：SDK 58 固定 React 19.3.0、网页是 19.2.4，故 App 是独立 npm 项目，`file:` 链接核心包，Metro 监听 `packages/core` 并把 `zod` 固定到 App 副本；网页 tsconfig、ESLint、Docker 排除 `apps/`。说明见 [MOBILE.md](MOBILE.md)。移除了模板自带的 Expo 许可证文件和插件启用配置。
- **实际运行**：App 类型检查（App 代码不含 Node 类型）、单元测试 4 项、Android/iOS Hermes 打包均通过，并在不含根目录依赖的干净副本中复跑通过；源映射确认只打包一份 React、一份 zod、核心包来自 `packages/core/src`。App 网页导出 + 本地生产服务器 + PostgreSQL + 认证替身的 Playwright 1 项通过（登录→计划日→用令牌开始训练后显示进行中→全部 API 请求带 Bearer、无 Cookie→切英文→退出），截图 `node_modules/.cache/mobile-web/*.png`。新增 CI `mobile` 任务与 `today-session` 中的网页导出验证。
- **未运行**：真机、iOS/安卓原生构建、`expo lint`（未配置）。会话存于未加密的 AsyncStorage。
- **下一步**：M1-3 今日训练记录（先把今日训练写入契约迁入核心包）。

## 2026-10-19 — M1-1 手机端认证：Bearer 访问令牌

- **原因**：原生 App 没有网页 Cookie；方案第 3 节“手机端在请求头带 Supabase 访问令牌，服务端校验”，第 6 节规则 4 手机与网页共用同一套写入接口。
- **实现**：`getRequestUser` 统一解析身份：有 `Authorization` 头时只用 `Bearer <JWT>`，交给 Supabase Auth 校验（不在本地解码信任），数据读取用带该令牌的客户端，仍受 RLS 约束；没有该头时沿用 Cookie。带 `Authorization` 的请求**不回退到 Cookie**，坏令牌即 401，也不会降级成访客。写接口的同源检查对合法格式的 Bearer 请求放行（没有浏览器自动携带的凭据，跨站伪造不了，且仍要求 JSON），Cookie 请求的同源检查不变。所有 API 路由经 `requireApiUser`/`requireApiContext` 自动支持，无需逐个修改。
- **实际运行**：新增 W1b Playwright 3 项（生产构建 + 本地 `postgres:16` + 认证替身）：仅令牌、无 Origin 读写本人训练，重放幂等、改内容冲突；第二个用户的令牌看不到、写不进、查不到第一个用户的会话和组（404/409，数据库无新增）；`X-Workout-Owner` 不一致 409；伪造签名、非 JWT、Basic 均 401，且浏览器已登录另一账号时也不回退；Bearer 但非 JSON 403；跨站 Cookie 写仍 403；对话历史、计划运行接口同样按令牌识别。单元测试 1 项（令牌格式）。完整 W1b Chromium 套件 90/90 通过。
- **边界**：认证替身按令牌字符串比对，不验证签名；真实签名校验由 Supabase Auth 完成，未在线上用真机令牌验证。访客模式不支持 Bearer。
- **下一步**：M1-2 Expo App 骨架。

## 2026-10-19 — M0-6 PWA 清单与只缓存外壳的 Service Worker

- **原因**：网页不能“安装”到主屏幕（[方案](2026-10-18-mobile-agent-plan.md)第 1 节缺口 3、第 4 节 M0），作为 App 上架前的过渡。
- **实现**：`src/app/manifest.ts`（独立窗口、项目自有 LiftCut 标志生成的 192/512/可遮罩图标、Apple 主屏图标）；`public/sw.js` 只缓存带内容哈希的 `/_next/static/` 构建产物、图标和静态 `offline.html`（最多 300 条，旧版本缓存在激活时清理）；页面导航始终走网络，只有加载失败时显示离线页；API、页面 HTML、RSC 请求、跨域请求一律不拦截、不缓存。仅生产构建注册；`/sw.js` 响应头禁止缓存并带 CSP。
- **实际运行**：新增 W1b Playwright 2 项（生产构建）：未登录可取清单、图标和 `sw.js` 头；Service Worker 控制页面后登录→开始训练→断网完成一组→“待同步 1 条”→联网→数据库恰好一组；缓存里只有 `offline.html`、图标和 `/_next/static/`；断网打开页面显示离线页，联网后重试恢复。带 Service Worker 的完整 W1b Chromium 套件 87/87 通过（含离线发件箱、登录导航、故障注入）。截图 `node_modules/.cache/w1b/pwa-offline-mobile.png`。
- **边界**：不是离线冷启动：断网时只能看到离线页，已排队的记录在联网后重新打开训练页继续同步；真正的离线冷启动留给 M1 原生 App（SQLite）。WebKit/iOS 主屏安装未验证。
- **下一步**：M0 阶段完成，进入 M1-1 手机端认证（Bearer 令牌）。

## 2026-10-19 — M0-5b 进阶目标与本组破纪录

- **原因**：“引擎管数字”需要在训练页可见：每个动作显示进阶引擎算出的目标和理由，打破纪录时当场提示（[方案](2026-10-18-mobile-agent-plan.md)第 4 节 M0、第 6 节规则 1）。
- **实现**：`GET /api/workout-sessions` 新增 `history`：当前计划与进行中处方里每个动作名最近 8 次已结束训练的全部组（含跳过/撤销状态）和全部历史最好成绩（含旧版记录）；查询在原 RLS 事务内，只读本人数据。动作卡显示“进阶目标 · 62.5 kg × 5 次 × 3 组”和中英文理由；没有确认过的重量时写“暂不给数字”。完成一组后，若重量或估算 1RM 超过此前最好（历史 + 本次更早的组）就提示“本组破纪录”；首次记录不叫破纪录。
- **规则映射**：`ruleForExercise`：“5”线性，“8-12”双重进阶，目录里无器械的动作按自重；“AMRAP”“30s”等不给自动目标。目标只显示，不写入、不预填；预填仍是上次实际值，需用户确认。
- **实际运行**：单元测试新增 2 项（规则映射、破纪录判断）；新 PostgreSQL 测试 1 项（只含已结束训练、保留跳过、旧版记录计入最好成绩、看不到他人数据），已加入 CI；新 W1b Playwright 1 项（无历史不给数字→结束→新训练显示 62.5 kg 与理由→破纪录提示→相同重量不再提示→目标不产生记录），截图 `node_modules/.cache/w1b/progression-mobile.png`。其余检查见 PR。
- **边界**：动作按名称匹配历史，改名后历史不连续；窗口为最近 8 次，减载计数只看窗口内；单位固定 kg（训练页本身只支持 kg）；离线时使用上次加载的历史。
- **下一步**：M0-6 PWA。

## 2026-10-19 — M0-5a 组间计时自动开始与屏幕常亮

- **原因**：健身房里真正省事的是计时和常亮，不是表单（[方案](2026-10-18-mobile-agent-plan.md)第 1 节缺口 2、第 4 节 M0）。
- **实现**：训练页完成新的一组后自动开始组间休息（默认 90 秒，可选 60/90/120/180，按设备记住）；顶部固定显示倒计时，可 +30 秒或结束，结束时震动（不支持则跳过）。按墙钟计算剩余时间，后台节流不会拉长休息。跳过和更正不会触发计时。训练进行中通过 Screen Wake Lock 保持屏幕常亮，页面隐藏后回来重新获取；浏览器不支持或拒绝时静默降级，结束训练即释放。
- **实际运行**：新增 W1b Playwright 3 项（390×844，Chromium，生产构建 + 本地 `postgres:16`）：完成一组→倒计时、+30 秒、快进到结束、更正与跳过不计时、隐藏后重新获取且不重复、刷新后时长保留、结束训练释放；拒绝与不支持两种情况训练照常、无页面错误。`today.spec` 3 项回归通过。截图 `node_modules/.cache/w1b/rest-timer-mobile.png`。
- **边界**：计时只在训练页（`/today`、当前计划记录页），不在 Agent 对话面板；页面关闭后不提醒（手机端本地通知在 M1-3）。iOS Safari 16.4 以下没有 Wake Lock，会静默无效，真机未验证。
- **下一步**：M0-5b 本组破纪录提示与进阶引擎的下次目标。

## 2026-10-19 — M0-4 估算 1RM

- **原因**：方案第 2、4 节：估算 1RM 只用确认过的实际值，超过 12 次不估，这是诚实的边界。
- **实现**：`packages/core/src/one-rep-max.ts`（Brzycki），重量或次数为 `null`、重量 ≤ 0、次数不是 1–12 的整数、跳过或撤销的组都返回 `null`；结果附所用的那一组，同分取最早达到的一组。历史页（`/workout`）新增“估算 1RM”卡片：每个动作的估算值和“依据 日期 · 重量 × 次数”；只有超过 12 次的组时明确写“不估算”。
- **修复**：原 `pr-tracker` 的 1RM 公式没有次数上限，40 kg × 30 次会算出约 205.7 kg，37 次以上还会出现无穷大或负数。现改用核心包，PR 记录、进度数据里的 1RM 在无法估算时为 `null`，不再用 0 代替。
- **实际运行**：3 项新单元测试；新增 W1a 手机宽度（390×844）Playwright 场景：访客保存 60 kg × 5、20 kg × 15、只填重量三行，卡片显示 67.5 kg 与依据，15 次的动作显示“不估算”，未填次数的行不出现；截图 `node_modules/.cache/w1a/one-rep-max-mobile.png`（CI 产物 `w1a-browser-evidence`）。
- **边界**：只统计已完成训练里勾选完成、重量和次数都记录了的组；估算值不是实测，也不进入进阶引擎。
- **下一步**：M0-5 训练页体验（组间计时、屏幕常亮、本组破纪录、下次目标）。

## 2026-10-19 — M0-3 确定性进阶引擎

- **原因**：计划里的组数和 RPE 变化由模型给出，下一次用多重没有可审计的规则（[方案](2026-10-18-mobile-agent-plan.md)第 1 节缺口 1、第 6 节规则 1“引擎管数字，模型管结构”）。
- **实现**：`packages/core/src/progression.ts`，纯函数 `nextTarget(规则, 历史)`：按日期对确认过的实际组做折叠，不存计数器，改一条记录立即重算。策略：线性（固定次数加重）、双重进阶（次数满上限再加重；自重只加次数，到上限只建议加负重或换变式，不推算重量）、计时（加秒数到上限）。连续未达成默认 3 次减载 10%，向下取到加重步长。kg/lb：库内统一存 kg，按规则单位换算，lb 换算不漂移。
- **未知值**：缺组、跳过、撤销、重量/次数/时长为 `null` 都算“未达成”，永不推进；从未确认过重量时输出 `weight: null`，不编数字也不累计减载。结果附依据会话与第几组为何未达成，中英文“为什么”。
- **实际运行**：12 项新单元测试（未知、跳过、撤销、缺组、减载与自定义减载、首次基准、kg/lb、双重进阶、自重、超过 12 次、计时、乱序与更正后重算、中英文无空值）；其余检查见 PR 描述。
- **设计来源**：参考 opengym 的“进阶是历史的纯函数”“引擎管数字”设计思路，仅参考设计，未复制代码或文案。
- **边界**：本 PR 只有引擎，网页尚未调用；处方 `repRange` 到规则的映射和训练页展示在 M0-5。计时动作目前数据库没有时长字段，计时策略只在核心包测试中使用。
- **下一步**：M0-4 估算 1RM。

## 2026-10-19 — M0-2 规则解析器、动作目录与 150 条评测迁入共享核心

- **原因**：手机 App 断网时也要用同一个规则解析器做一句话记录；M4 端侧模型需要在共享核心里的同一评测上对比（[方案](2026-10-18-mobile-agent-plan.md)第 4 节 M0）。
- **实现**：`workout-log-parser.ts`、60 个动作的 `exercise-catalog.ts` 原样迁入 `packages/core`；150 条合成语料与评测器迁入 `packages/core/src/eval/`。评测器把 Node 的深度严格比较和结构化克隆换成等价的纯数据实现，使其也能在 Expo 和浏览器里运行；CI 仍用 `scripts/eval-workout-parser.ts` 产出评测报告。
- **评测**：迁移前后 `eval-workout-parser` 输出逐字节一致：150/150 完全匹配，编造（标准为空却给值）0，错误生成草稿 0，遗漏 0，更正定位 7/7。新增反例：草稿多一个值为 `undefined` 的字段也不算匹配。
- **边界检查**：核心包允许包内 `../` 引用，但不能越出包目录；用越界引用做了反向验证，测试会失败。
- **实际运行**：见 PR 描述中的命令与结果（单元、lint、构建、核心类型检查、本地 `postgres:16` 产品数据库测试、手机宽度 Playwright）。
- **计划调整**：今日训练写入契约（`today.ts`、`workout-commands.ts`、`exercise-replacement.ts`）依赖 `workout-context.ts` 里用 Web Crypto 计算的上下文哈希，需拆分后才能进核心包；改为在 M1-3 手机端实际使用时迁移，避免现在为未使用的代码拆文件。
- **下一步**：M0-3 确定性进阶引擎。

## 2026-10-19 — M0-1 单仓库与共享核心包

- **原因**：手机 App（M1）要与网页共用同一套 schema 和契约（[方案](2026-10-18-mobile-agent-plan.md)第 3、4 节 M0），先建立不依赖框架的共享包。
- **实现**：根目录启用 npm workspaces，新建 `packages/core`（`@liftcut/core`）；原样迁入领域类型、计划生成类型、应用 Zod schema、实际值 schema、计划导入 schema、AI 计划 schema 与批准账本契约，网页、测试、脚本与研究脚本改为 `@liftcut/core/<文件>` 引用。文件内容除内部相对引用外未改，行为不变。
- **边界检查**：新测试要求核心包只引用自身文件和 `zod`；核心包用无 DOM、无 Node 类型的独立 tsconfig 做类型检查，已加入 CI。`next.config.ts` 显式列入 `transpilePackages`；Dockerfile 在 `npm ci` 前复制工作区清单。
- **实际运行**：`npm test` 6 + 127 通过；`npm run lint` 0 错误、2 个原研究警告；`npm run build` 通过；核心包类型检查通过；本地 `postgres:16` 容器跑 P1 32、W1a 1、产品 PostgreSQL 76 项全部通过；W1a 手机宽度 Playwright 1 项通过。
- **未运行**：Docker 镜像构建；WebKit 与其余 Playwright 场景（无界面改动，依赖 CI）。
- **边界**：网页仍在仓库根目录，未移到 `apps/web`（避免改 Vercel 根目录）；解析器、动作目录与今日训练写入契约在 M0-2 迁移。
- **下一步**：M0-2 迁移规则解析器、150 条评测与动作目录。

## 2026-10-18 — 下一阶段：手机 App + 训练 Agent（仅文档）

- **原因**：用户在健身房带的是手机；网页已记录的最大局限是离线冷启动和真机未验证。维护者决定最终上线手机 App。
- **参考**：研读 `alexpcosta/opengym`（AGPL-3.0，只借鉴设计）：确定性进阶引擎、“引擎管数字，AI 管计划”、封闭类型的离散修改与逐条接受、发送数据白名单、训练中计时与常亮。
- **方案**：[手机 App + Agent 方案](2026-10-18-mobile-agent-plan.md)（M0 共享核心与训练体验 → M1 Expo App → M2 App 内复盘 Agent → M3 展示 → 可选 M4 端侧蒸馏解析），[云端开发说明](CLOUD_AGENT_BRIEF.md)；更新 `AGENTS.md`。
- **发现的缺口**：没有确定性进阶引擎（组数与 RPE 变化由模型给出）；训练页缺组间计时自动开始、屏幕常亮、本组 PR 提示；没有 PWA 清单和 Service Worker。
- **实际运行**：只读代码审查与参考仓库阅读；没有运行测试、构建、数据库或模型。
- **维护者决定**：采用 Expo；Apple 开发者账号在本轮升级完成后注册；开启 M4；完全授权 Agent 在 CI 通过后自行合并（合并即部署）。`AGENTS.md` 与云端说明已同步。
- **环境限制**：云端会话只能走 HTTPS 代理，不能 SSH 或直连生产数据库；生产迁移和 GPU 训练改为写交接文档，由维护者或其本地会话执行。
- **下一步**：云端会话从 M0-1 开始。

## 2026-10-17 — 访客真实 AI、确认同步与健身记忆

- **原因**：访客需要自然对话与可同步的补录；重要身体数据、动作负重和偏好不能依赖最近六轮聊天。
- **实现**：访客接入现有流式工具循环，服务端签名身份和并发安全的个人/网络/全站试用预算；确认前不保存。
- **同步**：登录先核对清单与目标账号，事务导入、稳定 UUID 与内容哈希确保响应丢失后不重复；仅在完整回执后清理本批本机数据。
- **记忆**：实际体重、腰围、动作重量按日期保留；确认偏好独立追加；设置新增记忆子页与确认撤销。模型用只读工具查询，未知值仍为 null。
- **验证**：128 单元/行为测试、66 产品 PostgreSQL、80 全量浏览器和 10 移动 WebKit 场景通过，含访客流式→确认→刷新→登录导入→新聊天读取→确认撤销；构建通过，lint 仅 2 原研究警告。精确 CI 与正式站结果另存发布交接。
- **边界**：访客每日 10 次，额外网络/全站预算；无痕清理可能丢失未同步数据；访客聊天仍为页面会话；不引入通用记忆/向量库，不自动激活计划。
- **证据/后续**：[数据流、额度与边界](GUEST_AI_AND_FITNESS_MEMORY.md)。继续结合真实使用反馈完善动作别名与历史区间。

## 2026-10-16 — 访客问候与按日期读取长期记录

- **原因**：访客组合问候落入未开始训练分支；「两个月前」在本地查询中被忽略，可能误答最新记录。
- **修复**：区分访客数据模式与登录 AI，补录未保存时明确说明；共享日历日期解析，本地和模型查询都按所问日期读取，不用当前值或目标补历史空缺。
- **记忆**：说明六轮仅限制模型上下文；确认记录按日期独立保存，聊天删除/新建不影响事实；访客本机存储和无痕边界可见。
- **验证**：125 单测、18 PostgreSQL 相关测试、12 Chromium 登录/历史/记录场景通过，含确认前零写入、八轮后及新对话仍查询旧体重；构建/类型通过，lint 仅 2 原警告。
- **全量回归修正**：首轮 CI 76/77，发现切首页会中止结束训练请求；同步工作器移至账号外壳，新增挂起回执跨页回归，26 项本地记录/历史/离线/账号隔离测试通过，最终完整 CI 另存交接。
- **边界**：不开放匿名模型接口，不引入通用记忆或向量库，不改现有确认、幂等、账户权限；完整 CI、WebKit 与正式站结果留在发布交接。
- **证据/后续**：[定位、记忆结构与验证](AGENT_RECORD_MEMORY.md)。继续按反馈完善明确的历史时间区间。

## 2026-10-16 — 登录后清理匿名导航缓存

- **原因**：当前计划正式站验收中，登录后 Agent 返回首页曾绕回登录页；计划未丢失，缓存的匿名重定向仍被复用。
- **修复**：登录、带会话注册和游客入口成功后重新建立页面；账户数据仅在目的页面初始化一次，认证页不预取首页，正常三个标签继续客户端导航。
- **验证**：122 单元、19 登录/当前计划/历史/计划批准浏览器测试及 8 WebKit 回归通过；构建通过，lint 无错误、2 个原研究警告。游客源码匹配测试由真正的入口、切页和刷新行为测试替代。
- **重验**：WebKit 首轮捕获刷新中止查询，改为等待特定读取完成后再刷新；后续捕获登录页面重复初始化的中止请求并修复。失败轨迹与最终通过日志均保留。
- **边界**：不改权限、模型、数据库和确认账本；本地认证是 HTTP 夹具，最终 CI 与正式站 Supabase 验收另外留档。
- **证据/后续**：[定位与修复](AUTH_NAVIGATION_FIX.md)。继续核对正式站确认、训练实际记录、跨账号隔离及合成数据清理。

## 2026-10-16 — 首页当前计划与紧凑批准预览

- **原因**：长计划在 Agent 中持续展开，挤占对话；用户需要首页入口、周期进度和当天动作。
- **实现**：首页「当前计划」→ 进度/动作子页 → 现有记录流程；未记录训练按顺序推荐，可选日，已有会话保留原处方。
- **确认**：方案改为紧凑入口，完整预览在弹窗内核对；批准后只留简短回执。未确认方案不进入首页，原哈希、版本和幂等流程保留。
- **验证**：123 单元、58 产品 PostgreSQL、71 全量浏览器和 5 追加 WebKit 测试通过，补充仅有重量/RPE 的旧记录计数边界；构建通过，lint 无错误、仅 2 个原研究脚本警告。精确 CI 与正式站验收见本次发布交接。
- **边界**：12 周按 84 个日历日显示，实际记录独立计数；周期绑定当前计划版本日期，不跨版本累计，不自动推断休息日；无数据库迁移。
- **证据/后续**：[实现与边界](CURRENT_PLAN_BRIEF.md)。保留简单黑白 UI，后续按真实反馈完善开始日期与训练节奏。

## 2026-10-16 — 长周期训练计划超时修复

- **原因**：三个月计划逐周重复生成，在持续输出时命中 22 秒单步超时；线上 23.75 秒、本地同题 23.65 秒均失败。
- **修复**：新计划用动作模板和连续阶段，程序展开完整 1–16 周并复用原批准账本；不增加总预算，改为首片段/片段间隔超时，补充不含内容的进行中诊断。
- **验证**：真实模型同题首次 10.12 秒完成 12 周 × 3 天、单次 ≤90 分钟；115 单元、12 计划数据库、20 浏览器回归通过，含 25.8 秒持续生成、刷新恢复、显式批准、幂等和 WebKit。
- **边界**：单次测速不代表 P95；无数据迁移，实际训练记录不变；最终提交完整 CI 后上线并进行正式站合成账号验收和清理。
- **证据/后续**：[定位与修复](AGENT_LONG_PLAN_FIX.md)。继续验证长周期后续调整及真实手机网络体验。

## 2026-10-15 — 对话历史、切页连续性与冷启动

- **原因**：切到设置再回来会丢聊天，刷新无历史；需要明确 AI 记忆范围并继续排查鉴权/限额抖动。
- **实现**：账号级共享会话、后台生成、云端分页历史、本机未同步队列、刷新恢复、顶部历史/新对话和删除确认；不保存可执行签名或半成品。
- **确认/记忆**：AI 仅接收当前对话最近 6 个完整轮次；其他聊天不混入，事实仍查新数据；历史草稿不自动应用，原计划批准账本保留。
- **速度**：首屏能力配置拆出模型模块，模块加载与鉴权重叠；页面公开密钥验签；数据 API 仍新鲜鉴权；限额锁/计数/插入 3 次往返合为 1 次并细分计时；独立问候/介绍使用短指令。
- **实际验证**：111 单元、57 产品 PostgreSQL、64 浏览器及最后 11 项补充回归通过；构建/类型通过，lint 仅 2 原警告。修复并发插入死锁、分页边界、跨设备缓存、计划跨页结果及长训练进度保存。
- **故障保留**：首轮浏览器 58/63，四个旧清空聊天预期及一处限额夹具清理遗漏；均保留原失败，更新断言后全量通过。
- **手机/国内**：Android 微信 UA 弱网模拟、iPhone 尺寸 WebKit 通过；6 个国内云机房 HTTP 探针均 200，不能替代真实微信/运营商网络。
- **证据/后续**：[实现与边界](AGENT_HISTORY_STARTUP_BRIEF.md)、[验证索引](evidence/coach-history/verification.json)。精确 CI 后增量迁移上线，正式站同题测速和真实账号恢复/确认/隔离验收，清理合成数据。

## 2026-10-14 — Agent 分段计时与只读查询提速

- **原因**：已有真实流式输出，但首字与完整回答仍需区分模型、工具和网络等待，不能把流式当作模型提速。
- **实现**：鉴权/限额、每轮模型首片段/完整生成/响应头、工具与数据库阶段计时；清晰记录查询预读后直接回答，独立只读工具并行，当前训练去掉无关页面查询；“已保存的数据”按查询处理，复合保存要求仍回退。
- **事务**：固定初始化 SQL 合并，5 次往返减到 2 次；每次验证受限角色和事务内 owner。计划上下文、草稿与最终回答使用顺序屏障，批准/幂等/RLS 不变。
- **真实模型**：基线四场景与优化后两轮共八场景完成；双主题查询由两轮模型降为一轮，6.18 秒降至 3.28/3.05 秒，普通聊天和计划未见一致同幅收益。
- **实际测试**：103 单元、50 产品 PostgreSQL、32 批准账本、57 浏览器通过；最终补测 14 个模型/流式浏览器场景和查询边界通过；构建/类型通过，lint 0 错误/2 原警告，当前训练等价读取通过。
- **关键故障验证**：真实 PG 表锁阻塞身体查询时，饮食查询先完成且最终文字仍被阻止；重复准备只有一个未保存草稿，池复用不残留用户身份。
- **CI 修正**：首轮 56/57，旧跨账号测试在退出请求完成前跳转并取消该请求；改为等待服务端 401，350 ms 慢退出故障注入连续 3 次通过，保留全部隔离断言。
- **证据/规划**：[性能说明](AGENT_LATENCY_BRIEF.md)、[验证索引](evidence/coach-latency/verification.json)、[转型状态](PRODUCT_TRANSITION_STATUS.md)。
- **边界与下一步**：无生产 schema/角色变更，无 P95/国内真机结论；最终提交 CI 后上线、同提示词正式站对照、确认流程及跨账号验收，最后清理合成账号。

## 2026-10-14 — Agent 首屏与真实流式回复

- **为什么**：首次进入与回答等待过长；维护者要求边生成边显示，并保留简洁界面和修改前确认。
- **实现**：SDK 流式工具输入 → 已核验来源的增量文字 → 完整终态；即时显示消息与简短状态，停止/断流丢弃未完成回答，不传入后续历史；1800 字长回复响应小于 25 KB。
- **首屏**：输入框不等资料与全量历史；公开能力随路由下发、登录初始化时预取；旧账号缓存和迟到响应隔离。
- **确认边界**：部分计划不暴露确认入口，完整预览、批准账本、版本与幂等校验不变；模型错误日志不输出请求内容。
- **实际运行**：98 单元、48 产品 PostgreSQL、32 批准账本 PostgreSQL、56 浏览器全部通过；构建/类型通过，lint 0 错误/2 原警告。
- **真实模型**：三轮各 4 个本地合成数据场景通过；末轮聊天首段/完成 2.45/3.66 秒，双主题查询 3.79/4.51 秒；补录与计划仍完整校验后显示。
- **边界与后续**：无并发压测或国内 P95 结论；最终提交通过全量 CI 后部署，并在正式域名对照测量和验证确认写入、清理合成账号。
- **证据**：[方案](AGENT_STREAMING_BRIEF.md)、[验证索引](evidence/coach-stream/verification.json)。

## 2026-10-14 — 托管数据库的计划锁权限修复

- **发现**：#82 正式站生成、修改预览成功，但首次确认因托管 `auth` schema 权限返回 409 / SQLSTATE 42501；保存事务完整回滚，无回执或半份计划。
- **原因**：托管 schema 由 `supabase_admin` 管理，迁移管理员的 USAGE 授权未生效；本地管理员环境掩盖了 PL/pgSQL 运行期解析差异。
- **修复**：锁触发器按 `auth.uid()` 的同一 JWT subject 约定读取事务配置，仍为 SECURITY INVOKER，不扩大运行账户权限，不改 RLS 或批准校验。
- **回归**：本地夹具撤销运行角色的 auth schema USAGE，覆盖独立 subject / JSON claims 两种格式、本人锁争用、其他用户锁独立及跨账户写入拒绝。
- **实际运行**：48 产品数据库测试 + 32 批准账本测试通过；改动文件 lint 和 diff 检查通过；正式数据库回滚诊断通过，原批准使用同一个操作键已成功保存。
- **证据/后续**：[权限修复记录](evidence/coach-plans/auth-schema-fix.json)。保留首次失败；最终全链路验收、清理与部署提交在发布交接中记录。

## 2026-10-14 — 对话内训练与饮食计划

- **为什么**：维护者要求计划生成、调整和确认留在 Agent，对并发、响应时间和记忆给出真实边界。
- **做了什么**：完整预览、局部字段调整、明确确认、恢复最近预览/回执；训练与饮食共用版本绑定和幂等事务，计划不计入实际记录。
- **界面**：设置改分组菜单与子页面；Agent 只常驻对话，训练和回执按提问显示；首页去掉聊天跳转框，文案使用英文句点，三个主入口预取且输入框不等待训练读取。
- **性能**：批量并行读取、请求内去重、按阶段收窄工具、字段补丁和有效预览直接返回；不增加无依赖保证的写并发。
- **实际运行**：93 单元、47 产品 PostgreSQL、32 批准账本 PostgreSQL、49 浏览器通过；构建/类型通过，lint 0 错误/2 原警告。
- **真实模型**：两轮各 8 个本地合成库场景通过；第二轮新计划约 5 秒、局部调整约 2–3 秒，非线上 P95 或负载测试。
- **边界**：聊天六轮页面内记忆，设置/记录/计划账本持久保存；无通用长期记忆；模型不持有批准/执行工具。
- **证据**：[流程与工具说明](AGENT_PLANS_BRIEF.md)；[验证索引](evidence/coach-plans/verification.json)。
- **下一步**：最终提交全量 CI、生产补齐批准账本/受限连接、正式域名全链路验收及临时账号清理。

## 2026-10-14 — 线上追检：补录工具收窄与草稿直接返回

- **为什么**：#80 上线后来源核对通过，但一句同日追加体重两次未出草稿：一次耗尽 5 步，另一次误把参数校验解释为重复记录；两次都没有新增写入。
- **做了什么**：身体和饮食使用各自的有限字段，未知仍为 null；有效草稿直接返回确认卡，不再依赖模型额外生成结尾；支持“现在/刚刚”明确时间短语。
- **实际运行**：90 单元、完整 44 浏览器通过，构建/类型通过，lint 0 错误/2 原警告；新增错误跨主题字段 → 修正 → 草稿返回 → 确认后恰好一条的端到端回归。
- **真实模型**：8 个既有场景通过；原线上失败用语及上下文另外连续两次通过，均只用一步。以上真实 API 调用使用本地合成库。
- **证据**：[补录工具验证索引](evidence/coach-model-entry-tools/verification.json) 保存两次线上失败、零写入检查、改前工具格式问题和改后记录。
- **边界**：不改变数据结构、签名、原话校验、用户确认和幂等队列；模型仍可能失败，不承诺任意表达全部正确。
- **下一步**：最终提交完整 CI 后发布，原样重跑托管场景、独立 SQL 核实并清理两个人工账号。

## 2026-10-14 — 线上追检：训练来源完整与去重

- **为什么**：#79 已受检上线，真实模型回答实际与计划正确，但“当前训练”读取未进入来源卡；日期追问也出现重复来源。
- **做了什么**：当前会话增加实际来源和范围说明，完整展示本次读取并去重，训练重量明确标为负重；原话片段校验其来源消息与数字边界，拒绝上一轮目标或“80 kg”截出的“0 kg”成为实际值。
- **实际运行**：最终 89 单元、43 浏览器通过，构建/类型通过，lint 0 错误/2 原警告；来源遗漏、重复读取、活动会话计数、跨轮目标和数字片段均有回归断言。
- **线上已验证**：真实登录/同意、体重口语补录、及时查询、日期追问、饮食离线/丢响应重试、自然训练 NULL；来源展示检查失败如实保留。
- **证据**：[开放对话验证](MODEL_CONVERSATION_VERIFICATION.md) 与来源修正证据索引；不改变数据库结构、幂等队列或长期计划批准。
- **下一步**：精确 CI 后更新正式版本，基于原合成记录继续验收、独立 SQL 核对及清理账号，不能重复原补录当作重试。

## 2026-10-14 — 开放式模型对话与确认补录

- **为什么**：维护者要求自然提问和补录，测试后上线；将规则助手扩展为有读取工具的模型对话，保留黑白三入口。
- **做了什么**：独立同意、六轮页面上下文、最新本人来源、体重/饮食/训练草稿、原话数值校验、签名绑定与既有幂等队列、失败/停止/限额、NULL 与模型来源。
- **实际运行**：87 单元、37 PostgreSQL、43 浏览器场景通过；构建/类型通过，lint 0 错误/2 原警告；运行时依赖审计 0。浏览器模型为 HTTP 契约替身。
- **真实模型**：DeepSeek Flash 8 个合成场景通过；修复“昨天”追问范围及“今早”日期校验。真实模型 + 本地库不等于线上认证验收。
- **修正**：截图发现确认后旧回复状态，已清除；旧多标签页测试需等待本次撤销入队，不能读取上一操作的同步状态。
- **证据**：[验证记录](MODEL_CONVERSATION_VERIFICATION.md) 和带哈希的合成证据；最终精确 CI/迁移/托管验收与清理随发布交接单独记录。
- **边界**：一条补录/一个训练草稿、无长期记忆或营养猜测；计划变更仍走原批准流程；不新增 GPU/研究、未做手机真机验证。
- **下一步**：完成正式域名真实模型全链路验收，确认旧记录无变化并清理临时账号。

产品线每个 PR 一条，不超过 15 行。区分“已实际运行”“只是脚本或模拟”“计划中”。研究线记录仍在 [`docs/research/EXPERIMENT_LOG.md`](../research/EXPERIMENT_LOG.md)。

## 2026-10-13 — 优先级转向产品展品（仅文档）

- **为什么**：E1 模板任务 A/D 均 48/48，继续开 GPU 对展品价值低；P1（#62）已经提供真实的批准、撤销、幂等事务，可以直接支撑产品。维护者决定本项目以工程交付展品为目标，面向国内，免费不商业化。
- **做了什么**：新增 [展品方案](2026-10-13-showcase-plan.md)、[第 1 周 Codex 任务](WEEK1_CODEX_BRIEF.md)；更新 `AGENTS.md`、研究路线图和研究进度中的优先级。
- **审查中发现的现有问题（未修复）**：`workout_log_exercises` 三个实际值列为 `not null`；读取时缺失值映射为 0；记录表单把目标 RPE 预填为实际 RPE。已列入第 1 周 W1a。
- **实际运行**：只读代码审查；没有运行测试、构建或数据库。
- **复审**：Codex 核对了三处现有缺陷、官方登记/标识条文；补齐邀请测试不自动豁免、导出标识、服务端版本冲突与离线冷启动边界。原 `6896d1d` 的七项自动 CI 已成功；复审提交须重新通过检查，不能沿用旧结果。
- **砍掉**：多 Agent、附近餐饮、泛化“个人 Agent”定位、App Store、通用记忆系统、新模型训练。
- **下一步**：按第 1 周任务实现 W1a，合并后实现 W1b。

## 2026-10-13 — W1a：未知实际值保持为空

- **为什么**：目标 RPE 被当作实际值、空值被存成 0，会污染历史记录与统计；先修数据真实性再做今日训练卡。
- **做了什么**：三列可空、旧 RPE 0 转 null；类型、校验、数据库读写、访客与 JSON 往返保留空值；实际输入为空、目标只提示；个人纪录跳过缺测，热量假设仅用于估算。
- **运行中发现**：可选数字清空后会恢复、访客不能查看自己的详情；均已修正，用户之间的数据库隔离保留。
- **实际运行**：基线 47 项测试；修改后 54 项单元测试、本地真实 PostgreSQL 迁移/本人写入/跨用户 RLS、1 个 Chromium 手机宽度完整保存刷新场景通过；lint 仅两条原有警告，生产构建通过。
- **证据与过程**：[W1a 验证记录](W1A_VERIFICATION.md) 含每步原因、失败与修正、实际输出、手机宽度截图和部署顺序；P1-M CI 继续校验原冻结副本，未改变研究文件。
- **局限**：未跑托管认证全链路、真机微信或生产迁移；历史重量/次数 0 和目标误填的非零 RPE 无法自动分类；旧保存流程的多请求事务问题未在此次解决。
- **下一步**：W1a PR 完成检查后由维护者审阅；合并后按 W1b 做带功能开关的今日训练卡。本次不启动 GPU、不直接合并 W1a 或部署生产。

## 2026-10-13 — W1b：今日训练卡与可追踪的逐组写入

- **为什么**：把可靠记录落实到健身房点按流程，同时避免重复保存、旧请求覆盖和误把计划计为完成。
- **做了什么**：开关后的 `/today`、计划快照、逐组输入/历史确认、更正/跳过/撤销、版本和内容检查、追加事件、单活跃会话、本人 RLS、时区及新旧历史适配。
- **实际运行**：57 项单元测试、7 项真实 PostgreSQL 验证、4 个 Chromium 手机宽度流程通过；lint 仅 2 个原警告；生产构建通过；数据库安全检查仅原 public pgcrypto 警告。
- **发现与修正**：基线 UTC/本地日期夹具不一致；更正 NULL 不能再次套历史值；浏览器 alert 定位需排除 Next 播报器；旧 CI 配置误扫新数据库流程，限定原测试后本地回归通过。失败输出保留。
- **证据**：[W1b 验证记录](W1B_VERIFICATION.md) 含每步原因、实际输出、数据库/响应丢失验证、截图、局限和部署顺序。
- **交付边界**：叠加在已受检 W1a 上单独审阅，实际合并仍先 W1a 后 W1b；未动生产数据库、未部署、未改研究和批准账本、未开 GPU。
- **局限**：认证是本地 HTTP 契约替身，非托管 GoTrue；未做真机微信、离线发件箱、结束后修订或 AI 解析。
- **下一步**：审阅两 PR、受控环境迁移/登录验收后进入第 2 周解析与更正；暂不需要服务器实验。

## 2026-10-13 — W1 真实环境迁移与安全连接

- **为什么**：维护者授权自行完成迁移和继续交付；原本只在本地验证的功能需要真正连通现有服务。
- **做了什么**：恢复原免费项目、受影响表私有快照、两条增量迁移、受限运行账号、严格 TLS/CA 配置；运行区靠近首尔数据库；修复长邮箱撑开手机页头。
- **真实结果**：旧 100 条动作记录和备份逐条一致；三列可空，新三表强制 RLS；#65 七项、#66 八项检查成功后按顺序合并。
- **验证**：60 项单元测试、lint 0 error/2 原警告、生产构建；两个合成账号经真实 GoTrue → 本机 Next → 托管 PostgreSQL 完成保存/丢响应重试/更正/撤销/跨用户隔离，7 条事件，无编造 RPE。
- **失败与学习**：恢复中的瞬时空表不能当空库；初始化尝试失败后切回增量。私有 CA 要显式配置而非关闭 TLS 验证；浏览器断言超时不等于服务端未提交。
- **详细证据**：[W1 托管发布记录](W1_DEPLOYMENT.md)。当前记录区分托管服务联通与生产域名最终验收，后者随发布补齐。
- **局限**：同库表快照不是全库灾备；真机微信、离线和一句话解析仍在后续里程碑；未改研究/P1 账本、未开 GPU 或调用模型。
- **下一步**：完成最终生产域名验收与临时账号清理，然后进入 W2 的解析草稿、唯一更正定位和空值评测。

## 2026-10-13 — W2a：一句话解析草稿与空值评测

- **为什么**：自然语言不能重新引入计划冒充实际的问题；先固定草稿与更正目标，再接入事务写入。
- **接续 W1**：#67 八项成功后合并并部署首尔；生产域名完整流程通过，清理两个合成账号后原 6 账号/100 动作仍在、逐条差异 0。详见 [托管发布](W1_DEPLOYMENT.md)。
- **做了什么**：纯规则解析、kg/lb 原值与换算、多组部分 RPE、唯一 ID/revision 更正、跳过/结束草稿；含糊或未支持语句澄清，不接网络/模型/数据库。
- **实际运行**：150 条人工合成预期、10 类语法，79 草稿/71 澄清全部匹配；153 个应空字段编造 0、207 个明确数字遗漏 0、更正定位 7/7；6 针对测试和全套 66 测试通过，lint 0 error/2 原警告、构建通过。
- **指标核验**：全部拒绝、乱填 RPE、更正错组的故障替身均能被评测检出，避免只看空值指标。
- **证据与学习**：[W2a 验证记录](W2A_VERIFICATION.md)；测试预期直接编写而非从解析输出生成，属于开发覆盖，不宣称口语泛化。
- **局限**：未接自然语言界面/API，未做模型评测；中文数词、同上、复合语句、重量/RPE 更正仍澄清；本 PR 不等于 W2 完成。
- **下一步**：W2b 共用 TodayStore 的原子批量写入、回执和有版本检查的补偿撤销，再做真实浏览器验收；无需 GPU。

## 2026-10-13 — W2b：一句话接入、批量保存与可撤销回执

- **为什么**：W2a 只有草稿；真实界面需要防止半批写入、重复提交和撤销覆盖后来修改。
- **做了什么**：认证只读规则预览、确认整句、共用事务写入、UUID/版本/摘要、追加式回执与补偿、原话/来源、20 条刷新恢复；结束仍单独确认。
- **实际验证**：66 单测、7 个 W1 数据库回归、9 个批量/补偿数据库测试、6 个浏览器流程；构建通过，lint 仅 2 个既有警告。
- **数据库**：03:04:41 UTC 新回执表已迁移；RLS/权限通过，6 原用户与 100 旧记录保持不变、与备份差异 0。
- **过程**：[W2b 验证记录](W2B_VERIFICATION.md) 记录设计原因、原始输出、失败修正、迁移、截图和部署边界；全部示例为合成数据。
- **发布**：#69 精确 `35996ac` 全部 8 项检查成功后合 main `e46c6a7`，受检/合并树相同；正式域名验收见下一条独立发布记录。
- **局限**：规则优先，无模型/GPU；一次一个动作；句子更正仅次数，其他值点按；内存重试不等于离线发件箱或真机验收。
- **下一步**：完成此次生产验收后进入 W3 IndexedDB 发件箱与本次动作替换；现阶段不需开服务器。

## 2026-10-13 — W2b 正式域名验收与清理

- **为什么**：本地认证替身和 preview 不能证明正式域名的真实登录、写入、恢复与隔离。
- **实际执行**：核对 main SHA 对应生产 READY/正式别名后，用两个新合成账号经 GoTrue → Vercel → 托管数据库完成 8 段完整流程，无 JS 错误、无模型调用。
- **结果**：三组双击/并发仍一份；第二组失败全回滚；保存/撤销响应丢失重试无重复；更正补偿与旧请求/过期撤销安全；跨账号 404；结束不补未报组。
- **独立证据**：查库为 5 组、3 原回执、2 补偿回执、16 事件；实看两张线上手机宽度截图。[详细发布记录](W2B_VERIFICATION.md) 含提交、时间、数据库结果和 HTTP 时长观察。
- **清理与保全**：先撤销两合成账号的刷新令牌/会话，再清理其级联数据与本地口令；夹具残留 0，6 原账号/100 原动作与备份差异 0。
- **学习/局限**：必须把提交成功但响应丢失与未提交分开；单次 HTTP 观察不代表稳定 p95，手机宽度 Chromium 也不等于微信/iOS 真机。
- **下一步**：W2 已上线；W3 先写 IndexedDB 发件箱的顺序、冲突、账号切换和存储不可用验收，再做本次动作替换；无需 GPU。

## 2026-10-13 — W3a：离线发件箱与有序恢复

- **为什么**：内存重试不能跨关页保留；断网不等于服务端未提交，连续操作也不能越过未知结果。
- **做了什么**：账号分区 IndexedDB、事务落盘、固定字节队列、多标签租约、退避重试、本机整句预览与待同步回执、冲突比较/明确放弃、账号绑定。
- **真实验证**：70 单测、17 本地 PostgreSQL 测试、16 手机宽度浏览器场景通过；构建通过，lint 仅 2 原警告；无迁移、模型调用或 GPU。
- **发现与修正**：旧浏览器测试把乐观 UI 当提交完成；自审补上过期整句草稿的本地摘要检查，避免槽位变化。故障注入覆盖存储拒绝、401、响应丢失、失效租约及账号切换。
- **证据/学习**：[W3a 验证记录](W3A_VERIFICATION.md) 保留每步原因、失败输出、截图和摘要。六步链逐步回放后投影与实际数据库一致；落盘/提交/收到回执必须分开。
- **局限**：本地认证为契约替身，正式域名验收待部署；无离线冷启动、关闭后台补发、存储永不被清理或真机微信通过承诺。
- **下一步**：最终精确提交全检查后合并、验证生产并清理合成数据；W3b 本次动作替换另行实施，无需服务器实验。

## 2026-10-13 — W3a 正式验收与新账号真实性修正

- **发布**：#71 精确 ed8529c 八项成功后合并 8d2223e、树一致；正式域名自动部署 READY，真实 Auth 七段流程通过，无模型调用或 JS 异常。
- **数据库证据**：离线补发/补偿/丢响应/双标签/冲突/账号切换后，2 个会话、7 组、2 份回执、17 事件；空值与来源保留，未记录组不补写。
- **发现与原因**：新账号无计划时，既有 bootstrap 自动写演示训练、饮食和身体历史；临时账号因此多出 5 条旧明细，不能把样例作为用户实测。
- **修正**：真实登录仅初始化 profile/settings，使用已有空计划视图，演示入口保留；增加登录入口的跨表写请求回归，不改已有用户历史。
- **修正验证**：70 单测、17 个浏览器流程（含全部离线回归）、构建通过，lint 仅两条原警告；首次漏配编译时认证环境的失败和修正均保留。
- **保全与清理**：两测试账号的令牌/会话和级联数据已清理；原 6 账号/100 明细与备份差异 0，私有口令已删除。
- **过程与边界**：[线上证据](W3A_VERIFICATION.md)、[新账号修正](ACCOUNT_BOOTSTRAP_VERIFICATION.md) 保留真实失败/原因/修正；新账号修正的正式发布核验仍待精确提交检查与部署，不提前记通过。
- **下一步**：完成修正后的真实新账号验证，再做 W3b 本次动作替换；离线冷启动与真机微信仍未验证，无需 GPU。

## 2026-10-13 — 真实新账号生产核验与 W3b 实施设计

- **为什么**：修正初始化后，必须证明真实 Auth 登录不会再写演示历史；不能只看空白界面或本地认证替身。
- **发布**：#72 精确 c265fe9 全八项成功，合 main 4b469b3，受检/合并树一致；05:27:03 UTC 正式域名 READY。
- **实际验证**：一个全新合成账号完成真实登录、主动填写资料、今日页/历史读取、刷新与重新登录；只发生 profile/settings 写入，无 JS 错误或模型请求。
- **独立查库**：profile/settings 各 1；计划、训练、饮食、身体、会话、组、回执及事件全为 0；按精确账号清理后夹具残留 0，原 6 账号/100 明细与备份差异 0。
- **证据与学习**：[新账号发布记录](ACCOUNT_BOOTSTRAP_VERIFICATION.md) 含实际截图、脚本、原始结果/哈希；初始化、用户明确填写和真实训练历史必须区分。
- **下一步设计**：[W3b](W3B_IMPLEMENTATION_DESIGN.md) 首版仅替换未开始的会话动作；新动作 ID 防止旧设备请求被套到新动作上，补偿也不能覆盖后来记录。
- **边界**：W3b 仍未实现，原历史不猜测性删除，真机微信/iOS/Android 待验；本轮无迁移、GPU 或模型调用。
## 2026-10-14 — W3b 仅本次动作替换

- **原因**：现场器械不可用时调整当前训练；直接重命名旧 ID 会把其他设备旧队列误记到新动作。
- **实现**：60 项固定双语目录与完整器械筛选，确认后只改会话；替换/补偿都用新动作 UUID，零历史限制、追加回执、版本与上下文检查。
- **离线**：复用本人 IndexedDB 队列；替换→撤销→替换→组→结束按原字节补发，冲突暂停依赖队尾，明确放弃后恢复云端。
- **结果**：75 单测、25 真实 PostgreSQL 测试、25 浏览器场景通过；构建成功、lint 仅 2 原警告。新动作实际值为空，长期计划全字段快照不变。
- **失败/学习**：修正 numeric/语言替身、CI lint 和回执等待竞态；最终 25 浏览器再通过。旧文本或旧回执可见不证明新操作落盘，撤销不能复活旧身份。
- **证据**：[详细记录](W3B_VERIFICATION.md) 保存每步原因、失败输出、截图和当前发布边界。
- **局限/下一步**：精确 CI 后迁移、部署、真实 Auth 验收/清理；无 GPU、模型调用、离线冷启动或真机微信通过声明。

## 2026-10-14 — W3b 正式验收与历史查询兼容修复

- **原因**：本地认证替身不能证明正式保存；成功 HTTP 也不能替代数据库与运行日志核验。
- **发布**：#74 精确 de3689a 八项全成功，合 main d329751、树一致；06:55:52 UTC 正式域名 READY，新增回执表权限/RLS 实际核验通过。
- **实际结果**：真实登录后 3 会话覆盖五步离线链、丢响应/双标签重试、补偿与两个方向的跨设备冲突、英文刷新；3 组/6 回执/15 事件，实际 NULL、长期计划不变。
- **清理**：精确测试账号及认证会话/令牌已删除，夹具残留 0；原 6 账号/100 明细与备份差异 0，临时密码文件已删除。
- **修复/学习**：生产 stderr 的 2 条 pg 弃用警告来自单连接并发历史查询；真实 PG 回归先失败峰值 20，再改顺序 await 后峰值 1，数据与隔离不变。
- **验证**：兼容修复后 26 数据库测试、25 浏览器场景、构建/类型/lint 通过（2 旧警告）；实际过程、截图、日志与哈希在 [W3b 记录](W3B_VERIFICATION.md)。
- **下一步**：最终精确检查后发布兼容修复并定向核对；继续产品里程碑，真机微信/移动端需独立验证，无 GPU/模型调用。

## 2026-10-14 — C1 可互动的训练助手

- **原因**：维护者希望尽快亲自交谈试用；将已验证动作集中到 `/coach`，复用同一队列/API，避免第二套写入语义。
- **实现**：本机规则对话、计划/进度、缺动作澄清、内联草稿/确认/取消、回执补偿、仅本次替换；新消息关闭旧草稿，完整上下文变化不能确认。
- **持久化**：聊天文字仅本页；已确认原话/回执恢复，离线按原 UUID 与字节补发，跨页仍可重试，计划目标不转实际、未知值不补零。
- **结果**：78 单测、26 PostgreSQL 测试、最终 31 浏览器场景、生产构建和类型通过；lint 仅 2 条既有警告，中文/英文实际截图已查看。
- **发现/修正**：补结束后重新选日入口；保留初次失败。首次 CI 27/30，修正旧同步状态断言，并按既有租约窗口验证账号恢复、新增活租约原字节恢复场景及失败 trace。
- **证据**：[任务](COACH_CONVERSATION_BRIEF.md)、[逐步验证与截图](COACH_CONVERSATION_VERIFICATION.md)；React 钩子/账号卸载/键盘/溢出检查完成。
- **边界/下一步**：精确 CI 后上线、真实 Auth 合成验收与清理；本轮无迁移/GPU/模型调用，自由问答、真机微信、完整轨迹查看仍待后续。

## 2026-10-14 — 首页 / Agent / 设置与黑白数据助手

- **原因**：维护者反馈多模块界面杂乱，要求三个主入口，并让 Agent 统一查询和代填数据。
- **实现**：黑白灰、留白首页、折叠补录、简化登录/设置；统一 `/agent`，旧训练与计划工具从 Agent 进入。
- **数据**：新增可空身体/饮食账本，手动与对话共用确认 API；固定 UUID/内容重试、本人 RLS、补偿撤销、原话来源和导出，不猜测营养或改写旧值。
- **规划推进**：训练组可看版本/事件/原话；补充产品工程问答、README 与 90 秒演示脚本，录屏仍未执行。
- **实际结果**：80 单测、31 真实 PostgreSQL 测试、最终 35 浏览器场景通过；生产构建/类型通过，lint 仅 2 原警告；手机/桌面/深色截图已实看。
- **发现与修正**：更新旧导航场景与加载态截图；目标不冒充实测，读取失败不冒充无记录，导出保留 NULL 和撤销。[详细记录](MINIMAL_AGENT_VERIFICATION.md)。
- **边界/下一步**：精确 CI 后执行增量迁移、上线、真实 Auth 验收和清理；规则模式、旧详情页读取适配、真机与正式录屏仍有边界，无 GPU/模型调用。

## 2026-10-14 — 修复保存后的 Agent 查询与演示交付

- **原因**：#77 真实托管验收发现训练已结束，紧接着查询仍读取旧缓存并回答 0 次；保留失败，不当作通过。
- **实现**：每次查询等待本人最新历史，严格读取错误不降级为空数组；15 秒截止、处理中提示、history API 账号保护；收紧手机欢迎区并验证发送按钮位于底栏上方。
- **实际结果**：80 单测、最终 38/38 浏览器场景、生产构建/类型通过；全量 lint 只有 2 原警告，改动文件 lint 无问题；新增挂起后台刷新、挂起初始加载及失败/离线回归。
- **测试修正**：首轮全回归 36/38；补实际训练组、独立检查服务器历史，并按 SDK 真实退避等待 503 结果。详见 [验证记录](AGENT_QUERY_FRESHNESS.md)。
- **W4 交付**：已完成合成账号 90.20 秒 WebM 演示、README 与工程问答；影片使用本地认证替身和真实 API/PG，不能替代生产或真机验收。
- **边界/下一步**：精确 CI 后合并部署，在真实托管登录下重跑即时查询、导出/主题/语言/跨账号，然后精确清理两个人工账号；无新迁移、模型或 GPU。

## 2026-10-17 — 训练与饮食计划自动采用已确认记忆

- **原因**：已保存的目标、身体数据与动作重量应直接用于生成/调整，不能反复要求输入，也不能在数据变化后应用旧预览。
- **实现**：同一本人事务读取设置/计划/事实，明确本次要求、确认偏好、旧设置的优先级；按日期使用最新身体数据与每动作最多 3 条实际负荷。
- **一致性**：服务器保存提案依据哈希，发布/批准/执行复查；新测量或撤销使旧方案失效，已应用回执保持可重放；增量只读授权与语句级本人锁，不增加实际数据写权限。
- **验证**：131 单测、76 PostgreSQL 测试、82 浏览器场景通过（81 首次通过 + 1 文案断言修正后通过），WebKit 最终 4/4；构建/类型通过，lint 仅 2 旧警告。
- **真实模型**：4/4 合成预检覆盖训练、饮食、局部修改与临时目标覆盖；完整耗时 2.964–7.575 秒，仅本地 DB，无托管鉴权或 P95 结论。
- **发现/修正**：保留初始化依赖竞态、失效预览入口、旧文案与 WebKit 恢复等待的初次失败；[完整验证](PLAN_MEMORY_VERIFICATION.md) 区分模型与脚本证据。
- **交付**：更新 README、工程问答和[转型进展/简历边界](AGENT_PRODUCT_STATUS.md)；精确 CI 后迁移上线、真实 Auth 合成验收及清理。
- **边界/下一步**：补当前版本演示、真实试用与国内网络/真机测量；不声称临床效果、规模化用户或通用模型规划质量，无新研究/GPU。

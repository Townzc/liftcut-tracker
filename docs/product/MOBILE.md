# LiftCut 手机 App（Expo）

`apps/mobile` 是 Expo（SDK 58，React Native 0.88，expo-router）原生客户端。它与网页共用 `packages/core`（schema、规则解析器、动作目录、进阶引擎），以及同一套 API 与写入语义（方案第 6 节规则 4）。

## 为什么不是 npm workspace

Expo SDK 58 固定 React 19.3.0，网页是 React 19.2.4。放进同一个 workspace 会提升出一份共享的 React，并让 Vercel 和网页 CI 安装 React Native。所以 `apps/mobile` 是独立的 npm 项目（自己的 `package-lock.json`），通过 `"@liftcut/core": "file:../../packages/core"` 链接核心包；`metro.config.js` 监听 `packages/core`，并把核心包唯一的依赖 `zod` 固定解析到 App 自己的副本。网页的 `tsconfig`、ESLint 和 Docker 构建都排除 `apps/`。

## 本地开发

```sh
cd apps/mobile
npm ci
cp .env.example .env.local   # 只放公开值：Supabase URL、anon key、API 地址
npm run typecheck            # App 代码（无 Node 类型）+ 测试代码
npm test                     # 纯逻辑单元测试
npm run export:check         # Android 与 iOS 的 Hermes JS 包（Linux 上不做原生构建）
npx expo start               # 开发服务器；原生模块需要开发构建，见下
```

- 登录使用网页同一账号（Supabase 邮箱密码）。请求带 `Authorization: Bearer <访问令牌>` 和 `X-Workout-Owner`，不使用 Cookie；服务端用 Supabase Auth 校验令牌（M1-1）。
- 会话存放在 AsyncStorage（Supabase 官方 React Native 方案）。它不加密；上架前评估改用加密存储。
- 语言默认跟随系统（`zh*` 为中文，其余英文），设置里可切换；主题黑白，跟随系统浅色/深色。

## 离线记录

- 发件箱沿用网页语义（共享 `@liftcut/core/workout-outbox`）：每个操作带客户端 UUID，按入队顺序发送完全相同的字节，队头没确认前不跳过；冲突（409 等）暂停整个队尾，由用户选择“放弃本机这些操作，使用云端版本”；登录失效暂停但保留；网络错误按 10 秒起、最长 60 秒退避重试，也可“立即同步”。
- 存储：原生端是 SQLite 文件 `liftcut.db`（`outbox` 表，按账号一行），不依赖可能被系统清理的 WebView 存储；网页导出（仅自动化验证用）改用 AsyncStorage。
- 冷启动：先显示本机保存的快照和待同步操作，再联网刷新；断网时仍可在**已开始**的训练里记录。
- 限制：开始新训练需要服务器确认当天处方，断网时开始会排队，联网后才出现训练内容。

## 一句话记录

- 原话用共享核心的规则解析器在本机解析，断网也能预览；信息不足只给澄清原因，不猜测、不补计划值。
- 确认后与网页相同的 `apply`/`undo` 命令进入发件箱，服务器按上下文哈希（`expo-crypto` SHA-256，同一规范序列化）再次核验；撤销是补偿命令。
- 尚未接入：规则解析失败时的服务器端模型补录。

## Agent 连续对话与历史

- 手机与网页共用请求/响应契约，支持 `workout`、`workoutReview`、`personal` 和 `plan`；未知提案拒绝，整份计划仍到网页确认.
- 更正、沿用和撤销引用服务端已确认的 ID/revision；六轮只是发给模型的文字窗口，不是训练记录保存期限. 确认后仍走原 outbox 和不可变 review，不另建批准账本.
- 历史使用既有 `/api/coach/history` 和共享状态机，AsyncStorage 按账号缓存聊天及输入草稿. 切页保留，重启恢复；弱网失败可重试，退出清理该账号缓存，已同步聊天可从历史列表重开.
- 恢复仅恢复文字，旧提案关闭，签名、来源行和可执行操作不进入聊天缓存. “已保存”必须有服务端记录依据；恢复的旧文字提示重新核对训练记录. 删除聊天要确认，已确认的训练事实保留.
- 本地 `playwright.mobile.config.ts` 用单页路由回退服务托管 Expo 网页导出，供刷新/导航自动化验证；这不是原生安装包或手机生产发布.

## 构建安装包（EAS）

`apps/mobile/eas.json` 提供开发、内部测试和 iOS 模拟器配置（上架不在当前范围）：

- `development`：开发构建，含 `expo-dev-client`，安卓出 APK。装到手机后用 `npx expo start` 连本机开发服务器，原生模块（SQLite、通知、常亮、震动）都可调试。
- `preview`：安卓 APK / iOS ad hoc Release，内置 JS、不依赖 Metro；版本号由 EAS 远端自增（`appVersionSource: remote`）.
- `ios-simulator`：无签名 Release 模拟器包，不能安装到 iPhone. 免费准备、账号、签名、费用及独立安装验收见 [iOS 构建交接](IOS_BUILD.md).

后续构建在维护者现有 Expo 项目中进行，先核对免费额度；账号令牌不写入仓库：

```sh
cd apps/mobile
npx eas-cli@latest whoami
npx eas-cli@latest project:info
npx eas-cli@latest account:usage zhicetang
# 1. 在 app.json 写入确认后的 expo.android.package（上架后不能改）
# 2. preview 的三个公开变量已配置；development 需要另行设置公开值，服务端密钥绝不放进 App
npx eas-cli@latest env:set --environment development --visibility plaintext --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://<项目>.supabase.co
npx eas-cli@latest env:set --environment development --visibility plaintext --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <public-key>
# 3. 构建（排队在 Expo 云端完成，结束后给出安装链接和二维码）
npx eas-cli@latest build --platform android --profile preview
npx eas-cli@latest build --platform android --profile development
```

- EAS 以 Git 根目录打包；根 `.easignore` 只保留手机构建输入及 `packages/core`，排除网页、研究、环境文件和本机产物. App 是独立 npm 项目，只在 `apps/mobile` 安装依赖.
- 安卓权限只保留联网与震动（通知权限由 `expo-notifications` 在 Android 13+ 运行时申请）；模板默认的存储读写和悬浮窗权限已在 `app.json` 的 `blockedPermissions` 移除。
- 独立 iPhone 安装仍待签名；目前只做免费构建准备，不购买会员. 个人免费签名需要 Mac/Xcode，并有七天有效期限制.

## 已验证与未验证

- CI `mobile` 任务：独立安装、类型检查、单元测试、Android/iOS JS 打包。
- CI `today-session` 任务：App 的网页导出在本地生产构建 + PostgreSQL + 认证替身上完成登录、按令牌读取今日训练、切换语言、退出（`tests/mobile-web/`，390×844 截图）。网页导出只用于自动化验证界面与接口，不是发布目标。
- 本地（M1-6）：`eas.json` 用 eas-cli 25.2 自带的 `@expo/eas-json` 解析通过；`expo prebuild --platform android` 能生成原生工程（DayNight 主题、权限如上）；`expo-doctor` 20/20。
- **未验证**：EAS 云端签名安装包、独立 iPhone 安装及其冷启动矩阵. Expo Go 真机结果和后续独立安装结果分开记录，见 [验收交接](MOBILE_ACCEPTANCE.md).

## 后续

EAS 项目已关联；Android 永久包名、iPhone 签名方式待确认. 独立安装后继续验证离线冷启动、组间计时通知、常亮与震动.

2026-10-26：独立合成账号已完成真实 Supabase 鉴权、DeepSeek 联调和 Expo Go iPhone 连续训练验收. EAS 已登录；独立签名包未制作. Expo 网页导出、Hermes JS 打包、模拟器编译与独立真机验收分别记录.

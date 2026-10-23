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

`apps/mobile/eas.json` 只有两个内部分发配置（上架不在当前范围）：

- `development`：开发构建，含 `expo-dev-client`，安卓出 APK。装到手机后用 `npx expo start` 连本机开发服务器，原生模块（SQLite、通知、常亮、震动）都可调试。
- `preview`：安卓内部测试版 APK，不含开发工具，行为接近正式版；版本号由 EAS 远端自增（`appVersionSource: remote`）。

维护者首次构建（需要自己的 Expo 账号，免费额度即可；云端会话不持有账号或令牌）：

```sh
npm install -g eas-cli              # 25 或更高
eas login
cd apps/mobile
# 1. 在 app.json 写入确认后的 expo.android.package（上架后不能改）
eas init                            # 创建 EAS 项目，把 extra.eas.projectId 和 owner 写进 app.json；提交这两处改动
# 2. 公开配置写入 EAS 环境变量。只放公开值：anon key 本来就随网页发布；服务端密钥绝不放进 App
eas env:set --environment development --environment preview --visibility plaintext --name EXPO_PUBLIC_SUPABASE_URL --value https://<项目>.supabase.co
eas env:set --environment development --environment preview --visibility plaintext --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key>
#    EXPO_PUBLIC_API_URL 不设置时默认 https://www.liftcuttracker.com
# 3. 构建（排队在 Expo 云端完成，结束后给出安装链接和二维码）
eas build --platform android --profile preview
eas build --platform android --profile development
```

- EAS 上传整个 Git 仓库（App 通过 `file:../../packages/core` 引用核心包），只在 `apps/mobile` 里安装依赖（它不在根 workspaces 里，eas-cli 用的 `resolve-workspace-root` 本地核对为无工作区根），不会安装网页依赖。
- 安卓权限只保留联网与震动（通知权限由 `expo-notifications` 在 Android 13+ 运行时申请）；模板默认的存储读写和悬浮窗权限已在 `app.json` 的 `blockedPermissions` 移除。
- iOS 安装需要 Apple 开发者账号（付费），当前不做。

## 已验证与未验证

- CI `mobile` 任务：独立安装、类型检查、单元测试、Android/iOS JS 打包。
- CI `today-session` 任务：App 的网页导出在本地生产构建 + PostgreSQL + 认证替身上完成登录、按令牌读取今日训练、切换语言、退出（`tests/mobile-web/`，390×844 截图）。网页导出只用于自动化验证界面与接口，不是发布目标。
- 本地（M1-6）：`eas.json` 用 eas-cli 25.2 自带的 `@expo/eas-json` 解析通过；`expo prebuild --platform android` 能生成原生工程（DayNight 主题、权限如上）；`expo-doctor` 20/20。
- **未验证**：EAS 云端构建与安装包（需要维护者的 Expo 账号）、真机、iOS 原生构建（需要 Mac 或 EAS 与 Apple 账号）。

## 后续

应用标识（Android 包名）与 EAS 项目 ID 待维护者确认后写入 `app.json`；之后在真机上验证离线记录、组间计时通知、常亮与震动。

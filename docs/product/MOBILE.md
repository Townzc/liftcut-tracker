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

## 已验证与未验证

- CI `mobile` 任务：独立安装、类型检查、单元测试、Android/iOS JS 打包。
- CI `today-session` 任务：App 的网页导出在本地生产构建 + PostgreSQL + 认证替身上完成登录、按令牌读取今日训练、切换语言、退出（`tests/mobile-web/`，390×844 截图）。网页导出只用于自动化验证界面与接口，不是发布目标。
- **未验证**：真机、iOS 原生构建（需要 Mac 或 EAS）、安卓安装包（M1-6 需要维护者的 Expo 账号）。

## 后续

M1-3 今日训练记录、M1-4 SQLite 离线发件箱、M1-5 一句话记录、M1-6 EAS 构建配置（开发版、安卓内部测试版）。应用标识（Android 包名、iOS Bundle ID）在 M1-6 与维护者确认后再写入 `app.json`。

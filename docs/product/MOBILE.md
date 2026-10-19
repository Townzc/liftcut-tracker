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

## 已验证与未验证

- CI `mobile` 任务：独立安装、类型检查、单元测试、Android/iOS JS 打包。
- CI `today-session` 任务：App 的网页导出在本地生产构建 + PostgreSQL + 认证替身上完成登录、按令牌读取今日训练、切换语言、退出（`tests/mobile-web/`，390×844 截图）。网页导出只用于自动化验证界面与接口，不是发布目标。
- **未验证**：真机、iOS 原生构建（需要 Mac 或 EAS）、安卓安装包（M1-6 需要维护者的 Expo 账号）。

## 后续

M1-3 今日训练记录、M1-4 SQLite 离线发件箱、M1-5 一句话记录、M1-6 EAS 构建配置（开发版、安卓内部测试版）。应用标识（Android 包名、iOS Bundle ID）在 M1-6 与维护者确认后再写入 `app.json`。

// Pure dictionaries so tests can check both languages without React Native.
const zh = {
  signInTitle: "登录 LiftCut",
  signInHint: "使用网页版的同一账号。还没有账号？请先在网页注册。",
  email: "邮箱",
  password: "密码",
  signIn: "登录",
  signingIn: "正在登录…",
  signInFailed: "登录失败：邮箱或密码不正确，或网络不可用。",
  notConfigured: "App 未配置服务器地址，暂时无法登录。",
  today: "今日训练",
  settings: "设置",
  loading: "正在读取…",
  retry: "重试",
  networkError: "无法连接服务器。请联网后重试。",
  sessionExpired: "登录已失效，请重新登录。",
  noPlan: "还没有训练计划。请先在网页版或 Agent 对话里制定计划。",
  planDays: "计划中的训练日",
  day: "第 {week} 周第 {day} 天",
  activeSession: "进行中的训练",
  progress: "已完成 {done} / {total} 组",
  target: "计划：{sets} 组 × {reps} 次 · 目标 RPE {rpe}",
  recordingSoon: "在手机上开始和记录训练将在下一版本提供；目前请在网页版记录。",
  language: "语言",
  followSystem: "跟随系统",
  account: "账号",
  server: "服务器",
  signOut: "退出登录",
} as const;
export type MessageKey = keyof typeof zh;
const en: Record<MessageKey, string> = {
  signInTitle: "Sign in to LiftCut",
  signInHint: "Use the same account as the web app. No account yet? Register on the web first.",
  email: "Email",
  password: "Password",
  signIn: "Sign in",
  signingIn: "Signing in…",
  signInFailed: "Sign-in failed: wrong email or password, or no connection.",
  notConfigured: "This build has no server configured, so sign-in is unavailable.",
  today: "Today",
  settings: "Settings",
  loading: "Loading…",
  retry: "Retry",
  networkError: "Cannot reach the server. Reconnect and retry.",
  sessionExpired: "Your sign-in expired. Please sign in again.",
  noPlan: "No training plan yet. Create one on the web or in the Agent chat first.",
  planDays: "Planned training days",
  day: "Week {week}, day {day}",
  activeSession: "Workout in progress",
  progress: "{done} / {total} sets done",
  target: "Plan: {sets} sets × {reps} reps · target RPE {rpe}",
  recordingSoon: "Starting and recording workouts on the phone arrives in the next version; record on the web for now.",
  language: "Language",
  followSystem: "Follow system",
  account: "Account",
  server: "Server",
  signOut: "Sign out",
};
export type Locale = "zh-CN" | "en";
export const messages: Record<Locale, Record<MessageKey, string>> = { "zh-CN": zh, en };

export function format(template: string, values: Record<string, string | number> = {}) {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => key in values ? String(values[key]) : all);
}
/** Chinese for any zh-* system language, English otherwise. */
export const localeFor = (languageCode: string | null | undefined): Locale => languageCode?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";

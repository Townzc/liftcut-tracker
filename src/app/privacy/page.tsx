import type { Metadata } from "next";
import Link from "next/link";
import { MODEL_DATA } from "@liftcut/core/model-data";

type PrivacyProps = { searchParams: Promise<{ lang?: string | string[] }> };
const privacyLocale = (lang: string | string[] | undefined) => lang === "en" ? "en" : "zh-CN";
const policy = {
  "zh-CN": {
    title: "隐私政策", date: "更新日期：2026-10-27", contact: "隐私联系", support: "帮助与支持",
    intro: "LiftCut Tracker 由项目作者 Zhice Tang 维护. 这份说明介绍当前服务如何处理数据，以及你可以进行的控制.",
    sections: [
      ["账号与记录", "邮箱、账号标识、昵称和你选择上传的头像用于登录、展示个人资料及区分账号. 你填写的训练、身体、饮食记录、目标、器械、单位及其他偏好用于记录、查询、统计和生成建议. 伤病或其他备注可能包含敏感信息，请只填写完成请求所需的内容."],
      ["对话与确认", "对话、来源信息、澄清原话和修改预览可能在你确认前保存，以支持回复、历史恢复和核对. 提案中的业务修改需要你的确认；待同步表示仍等待服务端确认. AI 说“已完成”不等于写入成功."],
      ["设备与同步", "设备会保存登录状态、语言等偏好、未发送草稿及待同步操作. 已登录用户的已同步记录和对话由服务器保存；访客记录主要保存在当前设备，可在登录后通过导入流程同步. 访客使用云端 AI 时，相关请求也会离开设备. 清除应用或浏览器数据可能丢失尚未同步的内容."],
      ["保存范围", "最近六轮是单次模型请求的对话窗口，不是数据保存期限. 已确认记录可按日期查询. 当前没有为所有业务记录设置统一的自动到期删除期限. 来源、确认回执和更正历史用于解释记录、处理重试及避免重复写入；它们与聊天正文分别保存."],
      ["服务商与诊断", "LiftCut 使用 Supabase 提供账号、数据库和文件存储，使用 Vercel 托管网页与服务端接口. 当前 AI 界面标识为 DeepSeek，云端 AI 会处理下文列出的请求内容. 应用与基础设施会处理完成请求所需的网络信息、错误和性能诊断. 实际 AI 转发地址、各服务处理地点、日志与备份期限仍在核对；本页不承诺零留存、固定删除天数或供应商不使用数据训练."],
      ["删除账号", "入口可用时，手机可从「设置 → 删除账号」进入，网页可从「设置 → 账号与个人资料 → 删除账号」进入. 先核对账号和删除范围，使用当前密码或刚重新登录的会话重新验证，再明确勾选并确认永久删除. 登录或打开页面本身不会删除账号. 删除处理中会暂停此账号的普通同步；若结果尚未确认，请保留本机恢复状态并重试，不要将失败提示当成删除完成."],
      ["删除范围与限制", "删除流程处理此账号的在线资料、头像、训练和饮食计划、身体/饮食/训练记录、对话及关联来源和回执. 收到服务端删除完成确认后，才清理当前设备上能明确归属于此账号的草稿、对话缓存及待同步记录；其他账号、访客数据和语言偏好保留. 历史迁移备份、服务商备份、已导出副本及其他设备上的本地副本不属于本次即时清理范围. 无法可靠归属账号的旧版草稿不会被自动删除. 备份及日志保存期限仍在核对，不承诺固定删除天数."],
      ["撤回与联系", "删除聊天不等于删除已确认的记录、计划或全部来源历史. 撤销训练组会保留作废和更正轨迹；退出登录也不是删除账号或所有本机数据. 你可以查看、更正记录及关闭 AI 同意，撤回不代表已发送给服务商的数据被收回. 删除入口不可用、结果无法核实，或需要其他隐私协助时，请联系下方邮箱，我们会核实身份及可处理范围. 发送邮件不表示删除已经完成."],
      ["政策更新", "数据用途或服务方式变化时，我们会更新此页的日期和说明. 本页不是启用 AI 的同意按钮；使用 AI 仍需经过应用内的同意流程."],
    ],
    aiTitle: "发送给 AI 的内容",
    aiBody: "启用云端 AI 后，为回答你的问题、解释记录或生成提案，LiftCut 可发送以下类别中与功能相关的信息. 这些类别与应用内同意说明共用同一份清单. 自由文本不会自动变成匿名信息，请勿输入密码、验证码或无关的个人信息.",
  },
  en: {
    title: "Privacy policy", date: "Updated: 2026-10-27", contact: "Privacy contact", support: "Help & support",
    intro: "LiftCut Tracker is maintained by project author Zhice Tang. This notice describes current data handling and the controls available to you.",
    sections: [
      ["Account and records", "Your email, account identifier, display name and optional avatar support sign-in, your profile and account separation. Workout, body and food records, goals, equipment, units and other preferences support recording, queries, summaries and suggestions. Injury or other notes may contain sensitive information; provide only what is needed for your request."],
      ["Conversation and confirmation", "Messages, sources, clarification text and change previews may be stored before you confirm, to support replies, history restoration and review. Proposed changes to business records require your confirmation; pending sync means server confirmation is still outstanding. AI text saying “done” is not proof of a saved record."],
      ["Device and sync", "Your device stores sign-in state, preferences such as language, unsent drafts and pending operations. The server stores synced records and conversations for signed-in users. Guest records mainly stay on the current device and can be synced through import after sign-in. Guest cloud AI requests also leave the device. Clearing app or browser data can lose content that has not synced."],
      ["Retention scope", "The latest six turns form the conversation window for a model request, not a data retention period. Confirmed records can be queried by date. There is currently no single automatic expiry period for all business records. Sources, confirmation receipts and correction history support explanations, retries and duplicate prevention; they are stored separately from chat text."],
      ["Service providers and diagnostics", "LiftCut uses Supabase for authentication, database and file storage, and Vercel to host the website and server APIs. The current AI interface identifies DeepSeek; cloud AI processes the request content listed below. The app and infrastructure process network information, errors and performance diagnostics needed to serve requests. The actual AI forwarding endpoint, processing locations and log and backup periods are still being verified; this page does not promise zero retention, fixed deletion periods or that providers never use data for training."],
      ["Delete account", "When the entry is available, open Settings → Delete account on mobile, or Settings → Account & profile → Delete account on the web. Check the account and deletion scope, verify again with your current password or a recent sign-in session, then explicitly check and confirm permanent deletion. Signing in or opening the page does not delete the account. Ordinary sync for that account pauses during deletion. If the outcome is unknown, keep the local recovery state and retry; an error does not prove deletion completed."],
      ["Deletion scope and limits", "The flow deletes this account's online profile, avatar, training and nutrition plans, body/food/workout records, conversations and associated sources and receipts. Only after the server confirms deletion does it clear drafts, conversation caches and pending records attributable to that account on the current device. Other accounts, guest data and language preferences remain. Historical migration backups, provider backups, exported copies and local copies on other devices are outside immediate cleanup. Legacy drafts that cannot reliably be attributed to an account are not automatically deleted. Backup and log retention periods are still being verified; no fixed deletion period is promised."],
      ["Withdrawal and contact", "Deleting a conversation does not delete confirmed records, plans or all source history. Undoing a set retains its voiding and correction history. Signing out does not delete your account or all local data. You can view and correct records and turn off AI consent; withdrawal does not recall data already sent to a provider. If the deletion entry is unavailable, the outcome cannot be verified, or you need other privacy assistance, contact the email below. We will verify identity and the scope we can handle. Sending an email does not mean deletion has completed."],
      ["Policy updates", "When data purposes or services change, we will update this page and its date. This notice is not an AI opt-in button; AI use still requires the in-app consent flow."],
    ],
    aiTitle: "Data sent to AI",
    aiBody: "When cloud AI is enabled, LiftCut may send relevant information from the categories below to answer questions, explain records or prepare proposals. The same category list is used for in-app consent. Free text is not automatically anonymized. Do not include passwords, verification codes or unrelated personal information.",
  },
};

export async function generateMetadata({ searchParams }: PrivacyProps): Promise<Metadata> {
  const locale = privacyLocale((await searchParams).lang), content = policy[locale];
  return { title: content.title, description: content.intro, alternates: { canonical: `/privacy?lang=${locale}` } };
}

export default async function Privacy({ searchParams }: PrivacyProps) {
  const locale = privacyLocale((await searchParams).lang), content = policy[locale];
  return <article lang={locale} className="mx-auto w-full max-w-2xl space-y-9 py-4">
    <header className="flex items-center justify-between gap-4">
      <span className="text-xl font-semibold tracking-[-0.06em]">liftcut.</span>
      <nav aria-label={locale === "en" ? "Language" : "语言"} className="flex gap-4 text-sm">
        {(["zh-CN", "en"] as const).map(language => <Link key={language} href={`/privacy?lang=${language}`} prefetch={false}
          lang={language} aria-current={locale === language ? "page" : undefined}
          className="inline-flex min-h-11 items-center underline underline-offset-4">
          {language === "en" ? "English" : "中文"}
        </Link>)}
      </nav>
    </header>
    <section className="space-y-3">
      <h1 className="text-3xl font-semibold tracking-tight">{content.title}</h1>
      <p className="text-sm text-muted-foreground">{content.date}</p>
      <p className="leading-7 text-muted-foreground">{content.intro}</p>
      <a href="mailto:townzc1@gmail.com" aria-label={`${content.contact}: townzc1@gmail.com`}
        className="inline-flex min-h-11 items-center underline underline-offset-4">townzc1@gmail.com</a>
    </section>
    {content.sections.map(([title, body]) => <section key={title} className="space-y-3 border-t pt-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="leading-7 text-muted-foreground">{body}</p>
    </section>)}
    <section className="space-y-3 border-t pt-6">
      <h2 className="text-lg font-semibold">{content.aiTitle}</h2>
      <p className="leading-7 text-muted-foreground">{content.aiBody}</p>
      <ul className="list-disc space-y-3 pl-5 text-sm leading-6 text-muted-foreground">
        {MODEL_DATA.map(category => <li key={category.id}>{locale === "en" ? category.en : category.zh}</li>)}
      </ul>
    </section>
    <Link href={`/support?lang=${locale}`} prefetch={false} className="inline-flex min-h-11 items-center underline underline-offset-4">{content.support}</Link>
  </article>;
}

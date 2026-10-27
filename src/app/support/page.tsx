import type { Metadata } from "next";
import Link from "next/link";

type SupportProps = { searchParams: Promise<{ lang?: string | string[] }> };
const supportLocale = (lang: string | string[] | undefined) => lang === "en" ? "en" : "zh-CN";

const help = {
  "zh-CN": {
    title: "帮助与支持",
    intro: "遇到问题，可以直接联系我们，无需登录.",
    contact: "联系支持",
    sections: [
      ["草稿与确认", "对话中的建议和预览还不是已保存的记录. 核对动作、重量、次数和来源后再确认；没有提供的信息应保持未记录."],
      ["待同步与已保存", "待同步表示操作仍在本机等待服务器确认. 恢复网络后等待自动同步，必要时点“立即同步”. 同步前请保留应用数据，避免重复补录. 以服务端确认回执和记录为准，AI 文字里说“已完成”不代表保存成功."],
      ["更正、撤销与重做", "告诉 Agent 要修改哪个动作的第几组，检查预览后确认. 撤销会将原组标为作废；重做需另行记录并确认，避免把两组都算作完成."],
    ],
    feedback: "反馈时可以提供",
    details: "应用版本、设备型号和系统版本、界面语言、Wi-Fi 或移动网络、发生时间、操作步骤和错误提示. 截图前请遮住姓名、邮箱和训练等个人数据. 不要发送密码、验证码或登录令牌.",
  },
  en: {
    title: "Help & support",
    intro: "Contact us if something is not working. No sign-in is required.",
    contact: "Contact support",
    sections: [
      ["Drafts and confirmation", "Suggestions and previews in chat are not saved records. Check the exercise, weight, reps and sources before confirming. Information you have not provided should remain unrecorded."],
      ["Pending and saved", "Pending means an operation is waiting on your device for server confirmation. Reconnect and allow automatic sync, or tap Sync now if needed. Keep your app data until sync finishes and avoid entering the same record again. Check the server receipt and records: AI text saying “done” does not prove a save."],
      ["Corrections, undo and redo", "Tell Agent which exercise and set to change, then review and confirm the preview. Undo marks the original set as voided. Record and confirm a redo separately so both sets are not counted as completed."],
    ],
    feedback: "Helpful details to include",
    details: "App version, device and OS version, interface language, Wi-Fi or mobile network, time, steps and error message. Hide names, email addresses and personal data such as training records in screenshots. Do not send passwords, verification codes or session tokens.",
  },
};

export async function generateMetadata({ searchParams }: SupportProps): Promise<Metadata> {
  const locale = supportLocale((await searchParams).lang), content = help[locale];
  return { title: content.title, description: content.intro, alternates: { canonical: `/support?lang=${locale}` } };
}

export default async function Support({ searchParams }: SupportProps) {
  const locale = supportLocale((await searchParams).lang);
  const content = help[locale];
  return <article lang={locale} className="mx-auto w-full max-w-2xl space-y-9 py-4">
    <header className="flex items-center justify-between gap-4">
      <span className="text-xl font-semibold tracking-[-0.06em]">liftcut.</span>
      <nav aria-label={locale === "en" ? "Language" : "语言"} className="flex gap-4 text-sm">
        {(["zh-CN", "en"] as const).map(language => <Link key={language} href={`/support?lang=${language}`} prefetch={false}
          lang={language} aria-current={locale === language ? "page" : undefined}
          className="inline-flex min-h-11 items-center underline underline-offset-4">
          {language === "en" ? "English" : "中文"}
        </Link>)}
      </nav>
    </header>
    <section className="space-y-3">
      <h1 className="text-3xl font-semibold tracking-tight">{content.title}</h1>
      <p className="leading-7 text-muted-foreground">{content.intro}</p>
      <a href="mailto:townzc1@gmail.com" aria-label={`${content.contact}: townzc1@gmail.com`}
        className="inline-flex min-h-11 items-center underline underline-offset-4">townzc1@gmail.com</a>
    </section>
    {content.sections.map(([title, body]) => <section key={title} className="space-y-3 border-t pt-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="leading-7 text-muted-foreground">{body}</p>
    </section>)}
    <section className="space-y-3 border-t pt-6">
      <h2 className="text-lg font-semibold">{content.feedback}</h2>
      <p className="leading-7 text-muted-foreground">{content.details}</p>
    </section>
  </article>;
}

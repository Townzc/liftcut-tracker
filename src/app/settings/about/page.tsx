"use client";
import Link from "next/link";
import {useLocale} from "next-intl";
import {ArrowLeft,Volleyball} from "lucide-react";
export default function Page(){const en=useLocale()==="en";return <div className="mx-auto max-w-2xl space-y-8 pt-5">
  <Link href="/settings" prefetch className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4"/>{en?"Settings":"设置"}</Link>
  <div><Volleyball className="mb-5 size-9" strokeWidth={1.3}/><h1 className="text-2xl font-medium">{en?"A little better, every day.":"一点点，变得更好."}</h1></div>
  <div className="space-y-6 text-sm leading-7 text-muted-foreground">
    <p>{en?"Ask Agent about your records, add a measurement or meal, and create or adjust your training and nutrition plans. Review the preview and confirm before anything is applied.":"在 Agent 里查记录、补录身体和饮食数据，也可以生成或调整训练与饮食计划. 每次修改先看预览，确认后才应用."}</p>
    <p>{en?"Say “start workout” to choose a session, or “show receipts” to review saved changes. You can also add entries yourself on Home.":"说「开始训练」选择本次训练，说「查看回执」核对已保存的修改. 也可以在首页手动补充数据."}</p>
    <p>{en?"The six-turn limit applies to AI conversation context, not saved data. Confirmed measurements keep their dates; ask about a specific date or two months ago to query them again. Clearing chat does not delete account records, settings or plan receipts.":"六轮限制的是 AI 聊天上下文，不是数据保存期限. 确认保存的测量值保留日期，问具体日期或「两个月前」就会重新查询. 清空聊天不会删除账号记录、设置或计划回执."}</p>
    <p>{en?"Guest mode uses local data rules; AI chat and Agent entry require sign-in. Guest records stay in this browser only. Private browsing or clearing site data can erase them.":"访客使用本机数据模式，AI 自然对话和 Agent 补录需要登录. 访客记录只在当前浏览器，无痕浏览结束或清除网站数据可能丢失."}</p>
  </div>
</div>;}

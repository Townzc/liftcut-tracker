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
    <p>{en?"Chat uses the latest six turns on this page. Your records, settings and plan receipts stay with your account. Clearing chat does not delete them.":"聊天只使用当前页面最近六轮上下文. 记录、设置与计划回执保存在账户中，清空对话不会删除它们."}</p>
  </div>
</div>;}

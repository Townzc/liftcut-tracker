"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowUp, ArrowUpRight, ChevronDown, Plus } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { PersonalEntryForm, PersonalReceipts, RecordSyncStatus } from "@/components/agent/personal-entry";
import { usePersonalRecords } from "@/components/agent/personal-records-provider";

export function DashboardPage() {
  const en = useLocale() === "en", {profile} = useAuth(), {records} = usePersonalRecords();
  const date = new Date().toLocaleDateString(en ? "en-US" : "zh-CN", {month:"long",day:"numeric",weekday:"long"});
  const prompts = en ? ["My recent weight", "What did I eat today?", "Training this week"] : ["最近体重", "今天吃了什么", "本周训练"];
  return <div className="mx-auto max-w-2xl pt-10 sm:pt-16" data-testid="minimal-home">
    <p className="text-xs tracking-wide text-muted-foreground">{date}</p>
    <section className="pb-12 pt-7 sm:pb-16">
      <p className="mb-3 text-sm text-muted-foreground">{en ? "Welcome back" : "你好"}{profile?.displayName ? `${en?", ":"，"}${profile.displayName}` : ""}{en?".":"。"}</p>
      <h1 className="text-[32px] leading-[1.4] font-medium tracking-tight sm:text-[42px]">{en ? "A little better, every day." : "把注意力留给自己。"}</h1>
      <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base">{en ? "Your training, meals and progress. Just ask Agent." : "训练、饮食、身体变化，问 Agent 就好。"}</p>
      <Link href="/agent" className="mt-9 flex min-h-20 items-center justify-between gap-5 rounded-[24px] border bg-muted/40 px-6 transition-colors hover:bg-muted focus-visible:outline-2">
        <span className="text-sm text-muted-foreground">{en ? "What's on your mind today?" : "今天想聊点什么？"}</span>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><ArrowUp className="size-5" aria-hidden="true" /></span>
      </Link>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1">{prompts.map(prompt=><Link key={prompt} href={`/agent?prompt=${encodeURIComponent(prompt)}`} className="inline-flex min-h-10 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">{prompt}<ArrowUpRight className="size-3.5" /></Link>)}</div>
    </section>
    <details className="group border-t py-5" data-testid="manual-entry">
      <summary className="flex min-h-12 list-none items-center justify-between gap-3">
        <span className="flex items-center gap-3"><Plus className="size-4" /><span className="text-sm">{en ? "Add an entry yourself" : "手动补充一条数据"}</span></span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <PersonalEntryForm />
    </details>
    <RecordSyncStatus />
    {records.length>0 && <details className="border-t py-4"><summary className="min-h-11 py-3 text-sm text-muted-foreground">{en ? "Recent entries & receipts" : "最近补录与回执"} <span className="ml-2 text-xs">{records.length}</span></summary><PersonalReceipts /></details>}
    <p className="mt-10 text-center text-xs leading-6 text-muted-foreground">{en ? "One place for your records. At your own pace." : "一点点记录，按自己的节奏来。"}</p>
  </div>;
}

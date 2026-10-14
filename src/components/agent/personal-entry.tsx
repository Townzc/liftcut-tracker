"use client";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useRef, useState } from "react";
import { ArrowUpRight, Check, Plus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { entryLines, personalEntrySchema, type PersonalEntry } from "@/lib/personal-records";
import { toDateString } from "@/lib/date";
import { usePersonalRecords } from "./personal-records-provider";

export function RecordSyncStatus() {
  const {pending,error,retry,discard} = usePersonalRecords(), en = useLocale() === "en";
  if (!pending.length && !error) return null;
  const labels: Record<string,string> = en ? {auth:"Sign in again to sync your entries.",conflict:"This entry could not be saved. Review it before removing the pending request.",storage:"Could not save on this device. Nothing was sent.",load:"Records could not be loaded.",unavailable:"Recording is not available yet.",retry:"Sync is unconfirmed. Retry safely with the same request."} :
    {auth:"请重新登录后同步。",conflict:"这条补录未获通过。核对后可移除待发送请求。",storage:"无法在本机保存，未发送数据。",load:"记录暂时无法读取。",unavailable:"补录功能暂未开放。",retry:"同步结果尚未确认，可以安全重试。"};
  return <div className="space-y-2 rounded-2xl border p-4 text-sm" role="status" data-testid="personal-sync">
    <p>{error ? labels[error] : en ? `${pending.length} entries waiting to sync` : `${pending.length} 条补录待同步`}</p>
    <div className="flex gap-3"><Button variant="outline" onClick={retry}>{en ? "Retry" : "重试补录同步"}</Button>
      {error === "conflict" && <Button variant="ghost" onClick={discard}>{en ? "Remove rejected request" : "移除被拒绝的请求"}</Button>}
      {error === "auth" && <Link href="/login" className="underline">{en ? "Sign in" : "登录"}</Link>}</div>
  </div>;
}

export function PersonalEntryForm() {
  const en = useLocale() === "en", {owner,submit,pending,error} = usePersonalRecords();
  const [kind,setKind] = useState("body"), [date,setDate] = useState(()=>toDateString(new Date()));
  const [weight,setWeight] = useState(""), [waist,setWaist] = useState(""), [foodName,setFoodName] = useState("");
  const [calories,setCalories] = useState(""), [protein,setProtein] = useState(""), [mealType,setMealType] = useState("lunch");
  const [message,setMessage] = useState(""), flight = useRef(false);
  const value = (s:string) => s.trim() === "" ? null : Number(s);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (flight.current) return; flight.current=true;
    try {
      const parsed = personalEntrySchema.safeParse(kind === "body" ? {kind,date,weightKg:value(weight),waistCm:value(waist)} :
        {kind,date,foodName,mealType,calories:value(calories),protein:value(protein)});
      if (!parsed.success) {setMessage(en ? "Check the date and values. Enter a measurement or a food name." : "请检查日期和数值，至少填写一项身体数据或食物名称。");return;}
      if (await submit({action:"create",id:crypto.randomUUID(),entry:parsed.data,source:"manual",text:"",anchorDate:toDateString(new Date())})) {
        setWeight("");setWaist("");setFoodName("");setCalories("");setProtein("");
        setMessage(en ? "Entry queued. Sync status and receipts appear below." : "已加入补录队列，可在下方查看同步结果和回执。");
      }
    } finally {flight.current=false;}
  }
  if (!owner) return <p className="py-4 text-sm text-muted-foreground">{en ? "Sign in to record and sync your data." : "登录后即可补录并同步数据。"} <Link href="/login" className="underline">{en ? "Sign in" : "去登录"}</Link></p>;
  return <form onSubmit={save} className="space-y-5 pt-5" data-testid="personal-entry-form">
    <div className="flex flex-wrap gap-2">{[["body",en?"Body":"身体数据"],["food",en?"Food":"饮食记录"]].map(([id,label])=><Button type="button" key={id} variant={kind === id ? "secondary" : "ghost"} onClick={()=>{setKind(id);setMessage("");}} aria-pressed={kind===id} className="min-h-10 rounded-full px-4">{label}</Button>)}
      <Link href="/today" className="inline-flex min-h-10 items-center gap-1 px-4 text-sm">{en ? "Log a workout" : "补充训练"}<ArrowUpRight className="size-3.5" /></Link></div>
    <label className="block space-y-2 text-sm">{en ? "Date" : "记录日期"}<Input type="date" value={date} onChange={e=>setDate(e.target.value)} required className="h-11" /></label>
    {kind === "body" ? <div className="grid grid-cols-2 gap-4">
      <label className="space-y-2 text-sm">{en ? "Weight (kg)" : "体重（kg）"}<Input type="number" min="0.1" max="500" step="any" inputMode="decimal" value={weight} onChange={e=>setWeight(e.target.value)} placeholder="—" className="h-11" /></label>
      <label className="space-y-2 text-sm">{en ? "Waist (cm)" : "腰围（cm）"}<Input type="number" min="0.1" max="300" step="any" inputMode="decimal" value={waist} onChange={e=>setWaist(e.target.value)} placeholder="—" className="h-11" /></label>
    </div> : <>
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]"><label className="space-y-2 text-sm">{en ? "Food" : "吃了什么"}<Input value={foodName} onChange={e=>setFoodName(e.target.value)} maxLength={100} placeholder={en ? "e.g. Chicken and rice" : "例如，鸡肉饭"} required className="h-11" /></label>
        <label className="space-y-2 text-sm">{en ? "Meal" : "餐次"}<select value={mealType} onChange={e=>setMealType(e.target.value)} className="h-11 w-full rounded-lg border bg-background px-3">{["breakfast","lunch","dinner","snack"].map((m,i)=><option key={m} value={m}>{en ? m : ["早餐","午餐","晚餐","加餐"][i]}</option>)}</select></label></div>
      <div className="grid grid-cols-2 gap-4"><label className="space-y-2 text-sm">{en ? "Energy (kcal)" : "热量（kcal）"}<Input type="number" min="0" max="10000" step="any" value={calories} onChange={e=>setCalories(e.target.value)} placeholder="—" className="h-11" /></label>
        <label className="space-y-2 text-sm">{en ? "Protein (g)" : "蛋白质（g）"}<Input type="number" min="0" max="1000" step="any" value={protein} onChange={e=>setProtein(e.target.value)} placeholder="—" className="h-11" /></label></div>
    </>}
    <div className="flex items-center justify-between gap-4"><p className="text-xs leading-5 text-muted-foreground">{en ? "Leave anything you don't know blank." : "不知道的数值，留空就好。"}</p>
      <Button type="submit" disabled={pending.length>0 || error === "conflict"} className="h-11 rounded-full px-5"><Plus className="size-4" />{en ? "Save entry" : "保存补录"}</Button></div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}

export function EntryPreview({entry}: {entry:PersonalEntry}) {
  const en = useLocale() === "en";
  return <div className="space-y-1 text-sm"><p className="mb-2 text-xs text-muted-foreground">{entry.date}</p>{entryLines(entry,en).map((line,i)=><p key={i}>{line}</p>)}</div>;
}
export function PersonalReceipts({limit=5}: {limit?:number}) {
  const {records,pending,submit} = usePersonalRecords(), en=useLocale()==="en";
  return <div className="divide-y" data-testid="personal-receipts">{records.slice(0,limit).map(r=><div key={r.id} className="py-5" data-testid={`personal-receipt-${r.id}`}>
    <div className="mb-3 flex items-center justify-between gap-3"><span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="size-3.5" />{r.undo ? en ? "Voided" : "已撤销" : en ? "Saved" : "已保存"}</span>
      {!r.undo && <Button size="sm" variant="ghost" disabled={pending.length>0} onClick={()=>void submit({action:"undo",id:crypto.randomUUID(),recordId:r.id})}><Undo2 className="size-3.5" />{en?"Undo entry":"撤销补录"}</Button>}</div>
    <div className={r.undo?"opacity-50":""}><EntryPreview entry={r.entry} /></div>
    <details className="mt-3 text-xs text-muted-foreground"><summary className="w-fit py-1">{en?"Source & history":"来源与历史"}</summary>
      <div className="mt-2 space-y-2 break-words"><p>{r.source === "manual" ? en?"Entered on Home":"首页手动填写" : en?"Confirmed in Agent":"Agent 对话确认"}</p>
        {r.text && <p className="whitespace-pre-wrap">“{r.text}”</p>}<p>{new Date(r.createdAt).toLocaleString(en?"en":"zh-CN")}</p>
        {r.model&&<><p>{en?"AI interpreted, user confirmed":"AI 理解，用户确认"} · {r.model.model}</p>{r.model.sourceTexts.filter(x=>x!==r.text).map((x,i)=><p key={i} className="whitespace-pre-wrap">“{x}”</p>)}</>}
        {r.undo && <p>{en?"Compensating undo":"补偿撤销"} · {new Date(r.undo.createdAt).toLocaleString(en?"en":"zh-CN")}</p>}</div>
    </details>
  </div>)}</div>;
}

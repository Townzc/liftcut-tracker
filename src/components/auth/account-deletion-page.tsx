"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AccountDeletion } from "@liftcut/core/account-deletion-client";
import { useAuth } from "./auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { browserDeletion, deletionAvailable, freshCurrentSession, freshPassword } from "@/lib/account-deletion-client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function AccountDeletionLink() {
  const [available, setAvailable] = useState(false), en = useLocale() === "en";
  useEffect(() => { let alive = true; void deletionAvailable().then(v => { if (alive) setAvailable(v); }).catch(() => {}); return () => { alive = false; }; }, []);
  return available ? <Link className="block py-3 text-sm underline underline-offset-4" href="/delete-account" prefetch={false}>{en ? "Delete account" : "删除账号"} ›</Link> : null;
}
export function AccountDeletionPage() {
  const { user, loading } = useAuth(), current = useRef(user), en = useLocale() === "en";
  const [client, setClient] = useState<AccountDeletion | null>(null);
  useEffect(() => { current.current = user; }, [user]);
  useEffect(() => {
    let alive = true; const next = browserDeletion(() => current.current?.id);
    void next.load().then(() => { if (alive) setClient(next); });
    return () => { alive = false; };
  }, []);
  return client ? <SubscribedDeletion client={client} user={user} loading={loading} /> : <p role="status">{en ? "Loading…" : "正在读取…"}</p>;
}
function SubscribedDeletion({ client, user, loading }: { client: AccountDeletion; user: ReturnType<typeof useAuth>["user"]; loading: boolean }) {
  useSyncExternalStore(client.subscribe, client.snapshot, client.snapshot);
  return <DeletionForm key={user?.id ?? "signed-out"} client={client} user={user} loading={loading} />;
}
function DeletionForm({ client, user, loading }: { client: AccountDeletion; user: ReturnType<typeof useAuth>["user"]; loading: boolean }) {
  const en = useLocale() === "en", words = en ? english : chinese;
  const [available, setAvailable] = useState(false), [password, setPassword] = useState(""), [confirmed, setConfirmed] = useState(false), [localError, setLocalError] = useState(false);
  const flight = useRef(false), record = user ? client.records.get(user.id) : client.records.values().next().value;
  const owner = record?.owner ?? user?.id, email = record?.email ?? user?.email ?? null;
  useEffect(() => { let alive = true; void deletionAvailable().then(v => { if (alive) setAvailable(v); }).catch(() => {}); return () => { alive = false; }; }, []);
  async function begin(currentSession = false) {
    if (!available || !owner || !confirmed || flight.current || (!currentSession && (!password || !email))) return;
    flight.current = true; const secret = password; setPassword(""); setLocalError(false);
    try {
      await client.begin(owner, email, confirmed, () => currentSession ? freshCurrentSession(owner) : freshPassword(owner, email!, secret));
      if (!client.error && client.records.get(owner)?.receipt) await client.resume(owner);
    } finally { flight.current = false; }
  }
  async function relogin() {
    setLocalError(false);
    const { error } = await getSupabaseBrowserClient().auth.signOut({ scope: "local" });
    if (error) { setLocalError(true); return; }
    window.location.assign("/login?returnTo=delete-account");
  }
  return <section className="mx-auto w-full max-w-md space-y-5 py-8">
    <h1 className="text-2xl font-semibold">{words.title}</h1>
    {loading || !client.ready ? <><p role="status">{client.error ? words.local : words.loading}</p>{client.error && <Button onClick={() => void client.load()}>{words.retry}</Button>}</>
      : client.completed ? <p role="status">{words.done}</p> : <>
        {(email || owner) && <p className="break-all text-sm">{email || `${en ? "Account ID" : "账号 ID"}: ${owner}`}</p>}
        <p className="text-sm leading-6 text-muted-foreground">{words.scope}</p>
        {record && <div className="space-y-3 rounded-2xl border p-4"><p role="status" className="text-sm">{words.pending}</p>
          {(record.receipt || record.stage === "deleted") && <Button className="min-h-11 w-full" disabled={client.busy} onClick={() => void client.resume(record.owner)}>{words.resume}</Button>}</div>}
        {(client.error || localError) && <p role="alert" className="text-sm">{client.error === "receipt_expired" ? words.expired
          : ["AUTH", "reauthenticate", "ACCOUNT_CHANGED", "owner_mismatch"].includes(client.error) ? words.auth : words.unknown}</p>}
        {available && owner && record?.stage !== "deleted" && <form className="space-y-4 rounded-2xl border p-4" onSubmit={e => { e.preventDefault(); void begin(); }}>
          {email && <label className="block space-y-2 text-sm">{words.password}<Input type="password" autoComplete="current-password" maxLength={256} value={password} onChange={e => setPassword(e.target.value)} disabled={client.busy} /></label>}
          <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} disabled={client.busy} onChange={e => setConfirmed(e.target.checked)} />{words.confirm}</label>
          {email && <Button type="submit" className="min-h-11 w-full" disabled={client.busy || !confirmed || !password}>{words.submit}</Button>}
          {user && <Button type="button" variant="outline" className="min-h-11 w-full whitespace-normal" disabled={client.busy || !confirmed} onClick={() => void begin(true)}>{words.session}</Button>}
        </form>}
        {!available && !record && <p className="text-sm text-muted-foreground">{words.disabled}</p>}
        {available && <div className="space-y-3 text-sm"><p className="text-muted-foreground">{words.oauth}</p>
          <Button variant="outline" className="min-h-11 w-full" disabled={client.busy} onClick={() => void relogin()}>{words.relogin}</Button></div>}
      </>}
    <div className="flex gap-4 text-sm underline underline-offset-4"><Link href={`/privacy?lang=${en ? "en" : "zh-CN"}`} prefetch={false}>{words.privacy}</Link><Link href={`/support?lang=${en ? "en" : "zh-CN"}`} prefetch={false}>{words.support}</Link>
      {!record && <Link href={user ? "/settings/account" : "/login"} prefetch={false}>{words.back}</Link>}</div>
  </section>;
}
const chinese = {
  title: "删除账号", loading: "正在读取…", retry: "重试", local: "无法读取本机删除状态，请重试.",
  scope: "删除在线账号、资料、头像、训练和饮食计划、身体/饮食/训练记录及对话，并清理当前设备上此账号的待同步记录. 其他账号、访客数据和无法确认归属的旧版草稿会保留. 历史迁移备份、服务商备份及导出副本不在本次即时删除范围，保留期限尚未核定，详见隐私说明.",
  password: "当前账号密码", confirm: "我确认永久删除此账号及上述数据", submit: "确认并永久删除", session: "使用刚重新登录的会话确认",
  pending: "删除处理中或结果待核实. 普通同步已暂停，请保留浏览器数据并重试.", resume: "重试核实并完成清理", done: "账号已删除，本机该账号数据已清理.",
  unknown: "结果尚未确认. 请保留浏览器数据并重试，目前不会报告删除完成.", expired: "账号仍存在，继续删除需要重新验证. 请保留恢复凭据.",
  auth: "需要重新验证当前账号，或账号已变化. 请重新登录后再确认.", disabled: "账号删除暂未启用. 请稍后回来检查.",
  oauth: "没有密码或通过第三方登录？重新登录后回到本页，再勾选确认并使用新登录会话. 登录本身不会删除账号.", relogin: "重新登录并返回", privacy: "隐私说明", support: "帮助与支持", back: "返回",
};
const english: Record<keyof typeof chinese, string> = {
  title: "Delete account", loading: "Loading…", retry: "Retry", local: "Cannot read local deletion state. Please retry.",
  scope: "Delete your online account, profile, avatar, training and nutrition plans, body/food/workout records and conversations, plus this account's pending records on this device. Other accounts, guest data and unattributed legacy drafts remain. Historical migration backups, provider backups and exported copies are outside immediate deletion. Retention periods are not yet confirmed; see the privacy notice.",
  password: "Current account password", confirm: "I confirm permanent deletion of this account and the data above", submit: "Confirm permanent deletion", session: "Confirm using my new sign-in session",
  pending: "Deletion is pending or unknown. Ordinary sync is paused. Keep browser data and retry.", resume: "Retry verification and cleanup", done: "Account deleted. Its local data has been cleared.",
  unknown: "The outcome is not confirmed. Keep browser data and retry. Deletion is not reported as complete.", expired: "The account still exists. Verify again to continue deletion. Keep the receipt.",
  auth: "Verify the current account again, or the selected account changed. Sign in again before confirming.", disabled: "Account deletion is not enabled yet. Please check again later.",
  oauth: "No password or using a third-party sign-in? Sign in again, return here and explicitly confirm using that session. Signing in does not delete the account.", relogin: "Sign in again and return", privacy: "Privacy", support: "Help and support", back: "Back",
};

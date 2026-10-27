"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RunView } from "@liftcut/core/agent-contracts";
import type { ReviewChange } from "@liftcut/core/review-changes";
import { confirmPreview, previewOf, reviewBinding, reviewChanges as changesOf, type ReviewApi, type ReviewOutcome } from "@liftcut/core/review-client";
import { exerciseCatalog, exerciseLabel } from "@liftcut/core/exercise-catalog";
import { COACH_CONSENT_VERSION } from "@/lib/coach-model";
import { useTrackerStore } from "@/store/use-tracker-store";
import { ownerLifecycle } from "@/lib/owner-lifecycle";

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
async function ledger<T = RunView>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/agent/runs${path}`, { cache: "no-store", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || "OUTCOME_UNKNOWN");
  return result.value;
}
const api: ReviewApi = { ledger, async review(action, body) {
  const response = await fetch(`/api/workout-review${action && `?action=${action}`}`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  const result = await response.json().catch(() => null);
  if (!result?.status) throw new Error(result?.error || "OUTCOME_UNKNOWN");
  return result;
} };

/**
 * Post-workout review card: the model only suggests closed changes; each is chosen here and applied through the ledger.
 * Without a finished session it only shows the account's last review while it can still be applied or undone.
 */
export function WorkoutReview({ owner, sessionId }: { owner: string; sessionId?: string }) {
  const t = useTranslations("today.review"), locale = useLocale(), en = locale.startsWith("en");
  const refreshUserData = useTrackerStore(s => s.refreshUserData);
  const [run, setRun] = useState<RunView | null>(null), [undo, setUndo] = useState<RunView | null>(null), [why, setWhy] = useState("");
  const [selected, setSelected] = useState<boolean[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [consented, setConsented] = useState(false), [acted, setActed] = useState(false);
  // Request keys survive a lost response, so tapping again replays instead of writing twice.
  const keys = useRef<{ accept?: [string, string]; rollback?: string }>({}), flight = useRef(false), reviewed = useRef(sessionId);
  const stored = `liftcut-review:${owner}`;
  const remember = (value: { runId: string; undoId?: string }) => { try { ownerLifecycle.assertActive(owner);localStorage.setItem(stored, JSON.stringify({ sessionId: reviewed.current, ...value })); } catch {} };
  const show = (value: RunView) => { setRun(value); setSelected(changesOf(value).map(() => true)); };
  useEffect(() => {
    try { setConsented(localStorage.getItem(`liftcut-coach-consent:${owner}`) === COACH_CONSENT_VERSION); } catch { setConsented(false); }
    let saved: { sessionId: string; runId: string; undoId?: string } | null = null, alive = true;
    try { saved = JSON.parse(localStorage.getItem(stored) ?? "null"); } catch {}
    if (saved && sessionId && saved.sessionId !== sessionId) saved = null; // A newer workout starts a new review.
    reviewed.current = saved?.sessionId ?? sessionId;
    if (saved) void Promise.all([ledger(`/${saved.runId}`), saved.undoId ? ledger(`/${saved.undoId}`) : null])
      .then(([r, u]) => { if (alive) { setRun(r); setSelected(changesOf(r).map(() => true)); setUndo(u); } }).catch(() => {});
    return () => { alive = false; };
  }, [owner, sessionId, stored]);
  async function act(work: () => Promise<void>) {
    if (flight.current || !ownerLifecycle.active(owner)) return;
    flight.current = true; setBusy(true); setMessage(""); setActed(true);
    try { await ownerLifecycle.run(owner,work); } catch (e) {
      const code = e instanceof Error ? e.message : "OUTCOME_UNKNOWN";
      setMessage(code === "CONTEXT_STALE" ? t("stale") : t("failed", { code }));
      // Show what the ledger now says (e.g. stale or already applied) rather than guessing.
      if (run) await ledger(`/${run.id}`).then(show).catch(() => {});
    } finally { flight.current = false; setBusy(false); }
  }
  const proposed = (o: ReviewOutcome) => {
    if (o.status === "nochange") setWhy(o.review.outcome === "nochange" ? o.review.why : "");
    return previewOf(o);
  };
  const start = () => act(async () => {
    setWhy(""); setUndo(null); keys.current = {};
    const value = proposed(await api.review("", { sessionId: reviewed.current, requestKey: crypto.randomUUID(), consent: COACH_CONSENT_VERSION, locale: en ? "en" : "zh", timezone: timezone() }));
    if (value) { show(value); remember({ runId: value.id }); }
  });
  const apply = () => act(async () => {
    const accepted = selected.flatMap((on, i) => on ? [i] : []), signature = accepted.join(",");
    if (keys.current.accept?.[0] !== signature) keys.current.accept = [signature, crypto.randomUUID()];
    const preview = proposed(await api.review("accept", { runId: run!.id, requestKey: keys.current.accept[1], timezone: timezone(), accepted }))!;
    remember({ runId: preview.id });
    show(await confirmPreview(api, preview)); void refreshUserData().catch(() => {});
  });
  const rollback = () => act(async () => {
    keys.current.rollback ??= crypto.randomUUID();
    const preview = proposed(await api.review("rollback", { runId: run!.id, requestKey: keys.current.rollback, timezone: timezone() }))!;
    remember({ runId: run!.id, undoId: preview.id });
    setUndo(await confirmPreview(api, preview)); void refreshUserData().catch(() => {});
  });
  const decline = () => act(async () => { show(await ledger(`/${run!.id}/user-events`, { action: "decline", expectedRevision: run!.revision, binding: reviewBinding(run!) })); });

  const changes = changesOf(run), open = !!run && ["awaiting_approval", "approved"].includes(run.status), count = selected.filter(Boolean).length;
  if (!sessionId && !acted && !(open || run?.status === "applied" && undo?.status !== "applied")) return null;
  const name = (exercise: string) => exerciseLabel(exercise, locale);
  const label = (c: ReviewChange) => c.type === "adjust_sets" ? t(c.delta > 0 ? "setsUp" : "setsDown", { exercise: name(c.exercise) })
    : c.type === "adjust_rpe" ? t(c.delta > 0 ? "rpeUp" : "rpeDown", { exercise: name(c.exercise) })
    : c.type === "switch_rule" ? t(c.to === "linear" ? "ruleLinear" : "ruleDouble", { exercise: name(c.exercise) })
    : t("replace", { exercise: name(c.exercise), replacement: name(exerciseCatalog.find(x => x.id === c.replacement)?.zh ?? c.replacement) });
  return <Card data-testid="workout-review"><CardHeader><CardTitle>{t("title")}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    {!run && <><p className="text-muted-foreground">{t("intro")}</p>
      {why && <p role="status">{t("nochange", { why })}</p>}
      {consented ? <Button disabled={busy} onClick={() => void start()}>{busy ? t("working") : why ? t("again") : t("start")}</Button>
        : <p>{t("consent")} <Link className="underline underline-offset-4" href="/agent">{t("openCoach")}</Link></p>}</>}
    {run && <ul className="space-y-2">{changes.map((c, i) => <li key={i} className="rounded-xl border p-3">
      <label className="flex items-start gap-3">{open && <input type="checkbox" className="mt-1 size-4" checked={selected[i] ?? false} disabled={busy}
        onChange={e => setSelected(s => s.map((v, j) => j === i ? e.target.checked : v))} />}
        <span><span className="font-medium">{label(c)}</span><span className="block text-muted-foreground">{c.why} · {t("evidence", { count: c.evidence.length })}</span></span></label>
    </li>)}</ul>}
    {open && <><p className="text-xs text-muted-foreground">{t("note")}</p><div className="flex flex-wrap gap-2">
      <Button disabled={busy || !count} onClick={() => void apply()}>{t("apply", { count })}</Button>
      <Button variant="outline" disabled={busy} onClick={() => void decline()}>{t("decline")}</Button></div></>}
    {run?.status === "applied" && (undo?.status === "applied" ? <p role="status">{t("rolledBack")}</p> : <><p role="status">{t("applied")}</p>
      <Button variant="outline" disabled={busy} onClick={() => void rollback()}>{t("rollback")}</Button></>)}
    {run && ["declined", "stale"].includes(run.status) && <>{!message && <p role="status">{t(run.status === "stale" ? "stale" : "declined")}</p>}
      {consented && <Button variant="outline" disabled={busy} onClick={() => { setRun(null); void start(); }}>{t("again")}</Button>}</>}
    {message && <p role="alert">{message}</p>}
  </CardContent></Card>;
}

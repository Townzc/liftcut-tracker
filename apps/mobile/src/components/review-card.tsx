import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RunView } from "@liftcut/core/agent-contracts";
import { COACH_CONSENT_VERSION } from "@liftcut/core/coach-chat";
import { exerciseCatalog, exerciseLabel } from "@liftcut/core/exercise-catalog";
import type { ReviewChange } from "@liftcut/core/review-changes";
import { confirmPreview, previewOf, reviewBinding, reviewChanges, type ReviewOutcome } from "@liftcut/core/review-client";
import { randomUUID } from "expo-crypto";
import { getCalendars } from "expo-localization";
import { Link } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { reviewApi } from "@/lib/review";
import { useSession } from "@/lib/session";
import { useColors } from "@/lib/theme";

type Saved = { sessionId: string; runId: string; undoId?: string };
const timezone = () => getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The web's post-workout review card on the phone, through the same routes and ledger steps.
 * Without a finished session it shows the account's last review only while it can still be applied or undone.
 */
export function ReviewCard({ sessionId }: { sessionId?: string }) {
  const { session: auth } = useSession(), { t, locale } = useI18n(), c = useColors();
  const authRef = useRef(auth); authRef.current = auth;
  const api = useMemo(() => reviewApi(() => authRef.current), []), owner = auth?.user.id, stored = `liftcut-review:${owner}`;
  const [run, setRun] = useState<RunView | null>(null), [undo, setUndo] = useState<RunView | null>(null), [why, setWhy] = useState("");
  const [selected, setSelected] = useState<boolean[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [consented, setConsented] = useState(false), [acted, setActed] = useState(false);
  // Request keys survive a lost response, so tapping again replays instead of writing twice.
  const keys = useRef<{ accept?: [string, string]; rollback?: string }>({}), flight = useRef(false), reviewed = useRef(sessionId);
  const show = (value: RunView) => { setRun(value); setSelected(reviewChanges(value).map(() => true)); };
  const remember = (value: Omit<Saved, "sessionId">) => void AsyncStorage.setItem(stored, JSON.stringify({ sessionId: reviewed.current, ...value })).catch(() => {});
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(`liftcut-coach-consent:${owner}`).then(v => { if (alive) setConsented(v === COACH_CONSENT_VERSION); }).catch(() => {});
    AsyncStorage.getItem(stored).then(async raw => {
      let saved: Saved | null = raw ? JSON.parse(raw) : null;
      if (saved && sessionId && saved.sessionId !== sessionId) saved = null; // A newer workout starts a new review.
      reviewed.current = saved?.sessionId ?? sessionId;
      if (!saved) return;
      const [r, u] = await Promise.all([api.ledger(`/${saved.runId}`), saved.undoId ? api.ledger(`/${saved.undoId}`) : null]);
      if (alive) { show(r as RunView); setUndo(u as RunView | null); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [api, owner, sessionId, stored]);
  async function act(work: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true; setBusy(true); setMessage(""); setActed(true);
    try { await work(); } catch (e) {
      const code = e instanceof Error ? e.message : "OUTCOME_UNKNOWN";
      setMessage(code === "CONTEXT_STALE" ? t("reviewStale") : t("reviewFailed", { code }));
      if (run) await api.ledger(`/${run.id}`).then(r => show(r as RunView)).catch(() => {}); // Show what the ledger now says.
    } finally { flight.current = false; setBusy(false); }
  }
  const proposed = (o: ReviewOutcome) => { if (o.status === "nochange") setWhy(o.review.outcome === "nochange" ? o.review.why : ""); return previewOf(o); };
  const start = () => act(async () => {
    setWhy(""); setUndo(null); setRun(null); keys.current = {};
    const value = proposed(await api.review("", { sessionId: reviewed.current, requestKey: randomUUID(), consent: COACH_CONSENT_VERSION, locale: locale === "en" ? "en" : "zh", timezone: timezone() }));
    if (value) { show(value); remember({ runId: value.id }); }
  });
  const apply = () => act(async () => {
    const accepted = selected.flatMap((on, i) => on ? [i] : []), signature = accepted.join(",");
    if (keys.current.accept?.[0] !== signature) keys.current.accept = [signature, randomUUID()];
    const preview = proposed(await api.review("accept", { runId: run!.id, requestKey: keys.current.accept[1], timezone: timezone(), accepted }))!;
    remember({ runId: preview.id });
    show(await confirmPreview(api, preview));
  });
  const rollback = () => act(async () => {
    keys.current.rollback ??= randomUUID();
    const preview = proposed(await api.review("rollback", { runId: run!.id, requestKey: keys.current.rollback, timezone: timezone() }))!;
    remember({ runId: run!.id, undoId: preview.id });
    setUndo(await confirmPreview(api, preview));
  });
  const decline = () => act(async () => { show(await api.ledger(`/${run!.id}/user-events`, { action: "decline", expectedRevision: run!.revision, binding: reviewBinding(run!) }) as RunView); });

  const changes = reviewChanges(run), open = !!run && ["awaiting_approval", "approved"].includes(run.status), count = selected.filter(Boolean).length;
  if (!sessionId && !acted && !(open || run?.status === "applied" && undo?.status !== "applied")) return null;
  const name = (exercise: string) => exerciseLabel(exercise, locale);
  const label = (x: ReviewChange) => x.type === "adjust_sets" ? t(x.delta > 0 ? "reviewSetsUp" : "reviewSetsDown", { exercise: name(x.exercise) })
    : x.type === "adjust_rpe" ? t(x.delta > 0 ? "reviewRpeUp" : "reviewRpeDown", { exercise: name(x.exercise) })
    : x.type === "switch_rule" ? t(x.to === "linear" ? "reviewRuleLinear" : "reviewRuleDouble", { exercise: name(x.exercise) })
    : t("reviewReplace", { exercise: name(x.exercise), replacement: name(exerciseCatalog.find(e => e.id === x.replacement)?.zh ?? x.replacement) });
  const text = { color: c.text }, muted = { color: c.muted };
  return <View testID="review-card"><Card>
    <Text style={[text, styles.heading]}>{t("reviewTitle")}</Text>
    {!run && <>
      <Text style={muted}>{t("reviewIntro")}</Text>
      {why ? <Text accessibilityRole="alert" style={text}>{t("reviewNochange", { why })}</Text> : null}
      {consented ? <Button label={busy ? t("reviewWorking") : why ? t("reviewAgain") : t("reviewStart")} disabled={busy} onPress={() => void start()} />
        : <Text style={text}>{t("reviewConsent")} <Link href="/coach" style={styles.link}>{t("coach")}</Link></Text>}
    </>}
    {run && changes.map((x, i) => <Pressable key={i} accessibilityRole="checkbox" accessibilityState={{ checked: !!selected[i], disabled: !open || busy }} disabled={!open || busy}
      onPress={() => setSelected(s => s.map((v, j) => j === i ? !v : v))} style={[styles.change, { borderColor: c.border }]}>
      {open && <Text style={[text, styles.box]}>{selected[i] ? "☑" : "☐"}</Text>}
      <View style={styles.fill}><Text style={[text, styles.bold]}>{label(x)}</Text><Text style={muted}>{x.why} · {t("reviewEvidence", { count: x.evidence.length })}</Text></View>
    </Pressable>)}
    {open && <><Text style={muted}>{t("reviewNote")}</Text>
      <Button label={t("reviewApply", { count })} disabled={busy || !count} onPress={() => void apply()} />
      <Button variant="outline" label={t("reviewDecline")} disabled={busy} onPress={() => void decline()} /></>}
    {run?.status === "applied" && (undo?.status === "applied" ? <Text accessibilityRole="alert" style={text}>{t("reviewRolledBack")}</Text> : <>
      <Text accessibilityRole="alert" style={text}>{t("reviewApplied")}</Text>
      <Button variant="outline" label={t("reviewRollback")} disabled={busy} onPress={() => void rollback()} /></>)}
    {run && ["declined", "stale"].includes(run.status) && <>
      {!message && <Text accessibilityRole="alert" style={text}>{t(run.status === "stale" ? "reviewStale" : "reviewDeclined")}</Text>}
      {consented && sessionId && <Button variant="outline" label={t("reviewAgain")} disabled={busy} onPress={() => void start()} />}</>}
    {message ? <Text accessibilityRole="alert" style={text}>{message}</Text> : null}
  </Card></View>;
}
const styles = StyleSheet.create({
  heading: { fontSize: 18, fontWeight: "600" },
  bold: { fontWeight: "600" },
  fill: { flex: 1, gap: 2 },
  box: { fontSize: 20 },
  link: { textDecorationLine: "underline" },
  change: { flexDirection: "row", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, alignItems: "flex-start" },
});

import { identifyExercise, exerciseLabel } from "@liftcut/core/exercise-catalog";
import { nextTarget, ruleForExercise } from "@liftcut/core/progression";
import type { SetRequest } from "@liftcut/core/today";
import { projectOutbox, type OutboxState, type WorkoutOperation } from "@liftcut/core/workout-outbox";
import { randomUUID } from "expo-crypto";
import { getCalendars } from "expo-localization";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { KeepScreenOn, RestBar, RestLength, useRest } from "@/components/rest-bar";
import { SentenceEntry, SentenceReceipts } from "@/components/sentence-entry";
import { SetRow } from "@/components/set-row";
import { Button, Card } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { MobileOutbox } from "@/lib/outbox";
import { outboxApi } from "@/lib/outbox-api";
import { outboxStore } from "@/lib/outbox-store";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/theme";
import { feedback } from "@/lib/workout-aids";

export default function Today() {
  const { session: auth } = useSession(), { t, locale } = useI18n(), c = useColors();
  const authRef = useRef(auth); authRef.current = auth;
  const owner = auth?.user.id;
  const [state, setState] = useState<OutboxState | null>(null), [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<"offlineData" | "localConflict" | null>(null), [dayId, setDayId] = useState("");
  // One queue per account, kept in SQLite: it survives restarts and never mixes accounts.
  const outbox = useMemo(() => owner ? new MobileOutbox(owner, outboxStore, outboxApi(() => authRef.current), setState) : null, [owner]);
  const load = useCallback(async () => {
    if (!outbox) return;
    setLoading(true);
    try { await outbox.load(); await outbox.refresh(); setNotice(null); void outbox.drain(); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { await supabase?.auth.signOut(); return; }
      setNotice("offlineData"); // The stored snapshot and queue are already on screen.
    } finally { setLoading(false); }
  }, [outbox]);
  useFocusEffect(useCallback(() => {
    void load();
    const timer = setInterval(() => void outbox?.drain(), 5000);
    const foreground = AppState.addEventListener("change", s => { if (s === "active") void outbox?.drain(); });
    return () => { clearInterval(timer); foreground.remove(); };
  }, [load, outbox]));
  async function write(operation: WorkoutOperation) {
    if (!outbox) return false;
    try { await outbox.enqueue(operation); setNotice(null); return true; }
    catch { setNotice("localConflict"); return false; }
  }
  const rest = useRest();
  // Rest and the success haptic follow a newly completed set only; skips and undo get a light tap.
  const submitSet = async (body: SetRequest, completed: boolean) => {
    if (!(await write({ action: "set", body }))) return;
    if (completed) rest.start(); else feedback("light");
  };
  const view = state ? projectOutbox(state) : null, data = view?.data ?? null, head = state?.items[0];
  const session = data?.session, active = session?.status === "active", pending = state?.items.length ?? 0;
  const paused = head?.status === "conflict" || head?.status === "auth";
  const { stop } = rest;
  useEffect(() => { if (!active) stop(); }, [active, stop]); // Ending the workout cancels a pending rest notification.
  const text = { color: c.text }, muted = { color: c.muted };
  const chosen = dayId || data?.days[0]?.id || "";
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
    refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={() => void load()} />}>
    {state && <View testID="outbox-status" style={styles.gap}>
      {head?.status === "conflict" ? <Card>
        <Text accessibilityRole="alert" style={text}>{t("conflict", { count: pending })}</Text>
        <Button variant="outline" label={t("keepCloud")} onPress={() => void outbox?.discardConflict().catch(() => setNotice("offlineData"))} />
      </Card> : head?.status === "auth" ? <Card><Text accessibilityRole="alert" style={text}>{t("authPaused")}</Text></Card>
        : <View style={styles.row}><Text style={muted}>{pending ? t("pending", { count: pending }) : t("synced")}</Text>
          {pending > 0 && <Button variant="outline" label={t("syncNow")} onPress={() => void outbox?.retry()} />}</View>}
    </View>}
    {(notice ?? (head?.status === "retry" && head.error === "NETWORK" ? "offlineData" : null)) &&
      <Text accessibilityRole="alert" style={text}>{t(notice ?? "offlineData")}</Text>}
    {view?.error && <Text accessibilityRole="alert" style={text}>{t("localConflict")}</Text>}
    {!data ? <Text style={muted}>{t(loading ? "loading" : "networkError")}</Text>
      : !session ? state?.items.some(i => i.action === "start") ? <Card><Text style={text}>{t("starting")}</Text></Card>
        : data.days.length ? <Card>
          <Text style={[styles.heading, text]}>{t("chooseDay")}</Text>
          {data.days.map(d => <Button key={d.id} variant={d.id === chosen ? "primary" : "outline"} label={`${t("day", { week: d.weekNumber, day: d.dayNumber })} · ${d.title}`} onPress={() => setDayId(d.id)} />)}
          <Button label={t("start")} disabled={!chosen || paused} onPress={() => void write({ action: "start", body: { id: randomUUID(), dayId: chosen,
            timezone: getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone } })} />
        </Card> : <Text style={text}>{t("noPlan")}</Text>
      : <>
        <KeepScreenOn active={active} />
        {active && <RestBar rest={rest} />}
        <Card>
          <Text style={[styles.heading, text]}>{active ? t("activeSession") : t("ended")} · {session.prescription.title}</Text>
          <Text style={muted}>{t("progress", { done: session.sets.filter(s => s.status === "done").length, total: session.prescription.exercises.reduce((n, e) => n + e.sets, 0) })}</Text>
          {active && <RestLength rest={rest} />}
        </Card>
        {active && <SentenceEntry key={session.id} session={session} busy={paused} submit={write} />}
        {session.prescription.exercises.map(e => {
          const rule = ruleForExercise(e, { bodyweight: identifyExercise(e.name)?.equipment.length === 0 }), history = data.history?.[e.name];
          const target = rule && history ? nextTarget(rule, history.sessions) : null;
          return <Card key={e.id}>
            <Text style={[styles.heading, text]}>{exerciseLabel(e.name, locale)}</Text>
            <Text style={muted}>{t("target", { sets: e.sets, reps: e.repRange, rpe: e.targetRpe })}</Text>
            {target && <Text style={muted}>{t("progression")} · {locale === "en" ? target.why.en : target.why.zh}</Text>}
            {Array.from({ length: e.sets }, (_, i) => {
              const saved = session.sets.find(s => s.planExerciseId === e.id && s.setIndex === i + 1);
              return <SetRow key={`${session.id}-${e.id}-${i}-${saved?.revision ?? 0}`} sessionId={session.id} exerciseId={e.id} index={i + 1} saved={saved}
                previous={e.originalPlanExerciseId ? undefined : data.previous[e.name]} active={active} busy={paused} submit={submitSet} />;
            })}
          </Card>;
        })}
        <SentenceReceipts receipts={data.receipts ?? []} busy={paused} submit={write}
          pending={state?.items.filter(i => i.action === "apply" || i.action === "undo").map(i => i.action === "apply" ? JSON.parse(i.bodyJson).id : JSON.parse(i.bodyJson).commandId) ?? []} />
        {active ? <View style={styles.gap}><Text style={muted}>{t("endHint")}</Text>
          <Button label={t("end")} disabled={paused} onPress={() => void write({ action: "end", body: { id: session.id, revision: session.revision + 1, status: "ended" } })} /></View>
          : !pending && <Button variant="outline" label={t("anotherSession")} onPress={() => void load()} />}
      </>}
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  heading: { fontSize: 18, fontWeight: "600" },
  gap: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
});

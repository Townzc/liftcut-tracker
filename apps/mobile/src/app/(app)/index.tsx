import { identifyExercise, exerciseLabel } from "@liftcut/core/exercise-catalog";
import { nextTarget, ruleForExercise } from "@liftcut/core/progression";
import type { SetRequest } from "@liftcut/core/today";
import { randomUUID } from "expo-crypto";
import { getCalendars } from "expo-localization";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SetRow } from "@/components/set-row";
import { Button, Card } from "@/components/ui";
import { ApiError, getJson, postJson, sessionSchema, todaySchema, type TodaySummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/theme";

export default function Today() {
  const { session: auth } = useSession(), { t, locale } = useI18n(), c = useColors();
  const [data, setData] = useState<TodaySummary | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"networkError" | "saveFailed" | "changedElsewhere" | null>(null), [dayId, setDayId] = useState("");
  const fail = useCallback(async (error: unknown, fallback: "networkError" | "saveFailed") => {
    // An expired or revoked token signs out; the protected stack then shows sign-in.
    if (error instanceof ApiError && error.status === 401) { await supabase?.auth.signOut(); return true; }
    setNotice(error instanceof ApiError && error.status === 409 ? "changedElsewhere" : fallback); return false;
  }, []);
  const load = useCallback(async () => {
    if (!auth) return;
    setLoading(true);
    try { setData(await getJson("/api/workout-sessions", auth, todaySchema)); } catch (error) { await fail(error, "networkError"); }
    finally { setLoading(false); }
  }, [auth, fail]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function write(action: "start" | "set" | "end", body: unknown) {
    if (!auth || busy) return false;
    setBusy(true); setNotice(null);
    try {
      const session = await postJson(`/api/workout-sessions?action=${action}`, auth, body, sessionSchema);
      setData(d => d && { ...d, session }); return true;
    } catch (error) {
      // A conflict means another device changed this workout: show the server's version instead of guessing.
      if (!(await fail(error, "saveFailed")) && error instanceof ApiError && error.status === 409) await load();
      return false;
    } finally { setBusy(false); }
  }
  const submitSet = async (body: SetRequest) => { await write("set", body); };
  const session = data?.session, active = session?.status === "active";
  const text = { color: c.text }, muted = { color: c.muted };
  const chosen = dayId || data?.days[0]?.id || "";
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
    refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={() => void load()} />}>
    {notice && <Card><Text accessibilityRole="alert" style={text}>{t(notice)}</Text>
      {notice === "networkError" && <Button variant="outline" label={t("retry")} onPress={() => void load()} />}</Card>}
    {!data ? !notice && <Text style={muted}>{t("loading")}</Text>
      : !session ? data.days.length ? <Card>
        <Text style={[styles.heading, text]}>{t("chooseDay")}</Text>
        {data.days.map(d => <Button key={d.id} variant={d.id === chosen ? "primary" : "outline"} label={`${t("day", { week: d.weekNumber, day: d.dayNumber })} · ${d.title}`} onPress={() => setDayId(d.id)} />)}
        <Button label={t("start")} disabled={busy || !chosen} onPress={() => void write("start", { id: randomUUID(), dayId: chosen,
          timezone: getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone })} />
      </Card> : <Text style={text}>{t("noPlan")}</Text>
      : <>
        <Card>
          <Text style={[styles.heading, text]}>{active ? t("activeSession") : t("ended")} · {session.prescription.title}</Text>
          <Text style={muted}>{t("progress", { done: session.sets.filter(s => s.status === "done").length, total: session.prescription.exercises.reduce((n, e) => n + e.sets, 0) })}</Text>
        </Card>
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
                previous={e.originalPlanExerciseId ? undefined : data.previous[e.name]} active={active} busy={busy} submit={submitSet} />;
            })}
          </Card>;
        })}
        {active ? <View style={styles.gap}><Text style={muted}>{t("endHint")}</Text>
          <Button label={t("end")} disabled={busy} onPress={() => void write("end", { id: session.id, revision: session.revision + 1, status: "ended" })} /></View>
          : <Button variant="outline" label={t("anotherSession")} onPress={() => void load()} />}
      </>}
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  heading: { fontSize: 18, fontWeight: "600" },
  gap: { gap: 8 },
});

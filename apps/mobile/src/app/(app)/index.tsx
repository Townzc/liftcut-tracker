import { exerciseLabel } from "@liftcut/core/exercise-catalog";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text } from "react-native";
import { Button, Card } from "@/components/ui";
import { ApiError, getJson, todaySchema, type TodaySummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/theme";

export default function Today() {
  const { session } = useSession(), { t, locale } = useI18n(), c = useColors();
  const [state, setState] = useState<{ data?: TodaySummary; failed?: boolean; loading: boolean }>({ loading: true });
  const load = useCallback(async () => {
    if (!session) return;
    setState(s => ({ ...s, loading: true }));
    try { setState({ data: await getJson("/api/workout-sessions", session, todaySchema), loading: false }); }
    catch (error) {
      // An expired or revoked token signs out; the protected stack then shows sign-in.
      if (error instanceof ApiError && error.status === 401) { await supabase?.auth.signOut(); return; }
      setState(s => ({ data: s.data, failed: true, loading: false }));
    }
  }, [session]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const { data } = state, active = data?.session?.status === "active" ? data.session : null;
  const muted = { color: c.muted }, text = { color: c.text };
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={state.loading && !!data} onRefresh={() => void load()} />}>
    {state.failed && <Card><Text accessibilityRole="alert" style={text}>{t("networkError")}</Text><Button variant="outline" label={t("retry")} onPress={() => void load()} /></Card>}
    {!data ? !state.failed && <Text style={muted}>{t("loading")}</Text>
      : active ? <Card>
        <Text style={[styles.heading, text]}>{t("activeSession")} · {active.prescription.title}</Text>
        <Text style={muted}>{t("progress", { done: active.sets.filter(s => s.status === "done").length, total: active.prescription.exercises.reduce((n, e) => n + e.sets, 0) })}</Text>
        {active.prescription.exercises.map(e => <Text key={e.id} style={text}>{exerciseLabel(e.name, locale)} · {t("target", { sets: e.sets, reps: e.repRange, rpe: e.targetRpe })}</Text>)}
      </Card>
      : data.days.length ? <Card>
        <Text style={[styles.heading, text]}>{t("planDays")}</Text>
        {data.days.map(d => <Text key={d.id} style={text}>{t("day", { week: d.weekNumber, day: d.dayNumber })} · {d.title}</Text>)}
      </Card>
      : <Text style={text}>{t("noPlan")}</Text>}
    {data && <Text style={[muted, styles.note]}>{t("recordingSoon")}</Text>}
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  heading: { fontSize: 18, fontWeight: "600" },
  note: { fontSize: 13, lineHeight: 20 },
});

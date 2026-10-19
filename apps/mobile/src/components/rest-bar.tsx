import AsyncStorage from "@react-native-async-storage/async-storage";
import { useKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { REST_PRESETS, clock, extendRest, remaining, startRest, validPreset, type RestRun } from "@/lib/rest";
import { useColors } from "@/lib/theme";
import { cancelRestEnd, feedback, scheduleRestEnd } from "@/lib/workout-aids";

const KEY = "liftcut-rest-seconds";

/** Mounted only during an active workout; native only (the web export is a test surface). */
function KeepAwake() { useKeepAwake("liftcut-workout"); return null; }
export function KeepScreenOn({ active }: { active: boolean }) { return active && Platform.OS !== "web" ? <KeepAwake /> : null; }

export function useRest() {
  const { t } = useI18n();
  const [seconds, setSeconds] = useState(90), [run, setRun] = useState<RestRun | null>(null);
  const scheduled = useRef<string | null>(null);
  useEffect(() => { AsyncStorage.getItem(KEY).then(v => setSeconds(validPreset(v))).catch(() => {}); }, []);
  const notify = useCallback(async (next: RestRun | null) => {
    await cancelRestEnd(scheduled.current); scheduled.current = null;
    if (next) scheduled.current = await scheduleRestEnd((next.endsAt - Date.now()) / 1000, { title: t("restOver"), body: t("restOverBody") });
  }, [t]);
  const apply = useCallback((next: RestRun | null) => { setRun(next); void notify(next); }, [notify]);
  const stop = useCallback(() => apply(null), [apply]);
  return { seconds, run, stop,
    choose: (value: number) => { setSeconds(value); void AsyncStorage.setItem(KEY, String(value)).catch(() => {}); },
    start: () => { feedback("done"); apply(startRest(seconds, Date.now())); },
    extend: () => { if (run) apply(extendRest(run)); } };
}
export type Rest = ReturnType<typeof useRest>;

export function RestBar({ rest }: { rest: Rest }) {
  const { t } = useI18n(), c = useColors(), [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!rest.run) return; const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, [rest.run]);
  if (!rest.run) return null;
  const left = remaining(rest.run, now);
  return <View testID="rest-timer" style={[styles.bar, { backgroundColor: c.background, borderColor: c.border }]}>
    {left === 0 ? <Text accessibilityRole="alert" style={[styles.text, { color: c.text }]}>{t("restOver")}</Text>
      : <Text style={[styles.text, { color: c.text }]}>{t("rest")}  <Text style={styles.clock}>{clock(left)}</Text></Text>}
    <View style={styles.actions}>
      {left > 0 && <Button variant="outline" label={t("restAdd")} onPress={rest.extend} />}
      <Button variant="outline" label={t(left > 0 ? "restStop" : "restDismiss")} onPress={rest.stop} />
    </View>
  </View>;
}
export function RestLength({ rest }: { rest: Rest }) {
  const { t } = useI18n(), c = useColors();
  return <View style={styles.presets}>
    <Text style={{ color: c.muted }}>{t("restLength")}</Text>
    <View style={styles.actions}>{REST_PRESETS.map(s => <Button key={s} variant={s === rest.seconds ? "primary" : "outline"} label={t("seconds", { seconds: s })} onPress={() => rest.choose(s)} />)}</View>
  </View>;
}
const styles = StyleSheet.create({
  bar: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 12, gap: 8 },
  text: { fontSize: 16 },
  clock: { fontSize: 24, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  presets: { gap: 8 },
});

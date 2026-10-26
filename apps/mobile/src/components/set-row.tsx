import { tapSetRequest, voidSetRequest } from "@liftcut/core/set-requests";
import type { SetLog, SetRequest } from "@liftcut/core/today";
import { randomUUID } from "expo-crypto";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { confirmedValues } from "@/lib/display";
import { useColors } from "@/lib/theme";

type Saved = SetLog;
const number = (s: string) => s.trim() === "" ? null : Number(s.replace(",", "."));

/** Same write as the web row (shared builder): prefill provenance, skips without actuals, undo as compensation. */
export function SetRow({ sessionId, exerciseId, index, saved, previous, active, busy, submit }: {
  sessionId: string; exerciseId: string; index: number; saved?: Saved; previous?: { weightKg: number | null; reps: number | null };
  active: boolean; busy: boolean; submit: (body: SetRequest, completed: boolean) => Promise<void>;
}) {
  const { t, locale } = useI18n(), c = useColors();
  const [id] = useState(() => saved?.id ?? randomUUID()); // Stable before saving, so a retry is the same write.
  const [weight, setWeight] = useState(String(previous?.weightKg ?? "")), [reps, setReps] = useState(String(previous?.reps ?? ""));
  const [rpe, setRpe] = useState(""), [changed, setChanged] = useState({ weight: false, reps: false }), [invalid, setInvalid] = useState(false);
  function send(status: "done" | "skipped") {
    const result = tapSetRequest({ id, sessionId, planExerciseId: exerciseId, setIndex: index, prefilled: !!previous, changed, status,
      weightKg: number(weight), reps: number(reps), rpe: number(rpe) });
    setInvalid(!result.success);
    if (result.success) void submit(result.data, status === "done");
  }
  const text = { color: c.text }, muted = { color: c.muted }, input = [styles.input, { color: c.text, borderColor: c.border }];
  const label = t("set", { n: index });
  return <View style={[styles.row, { borderColor: c.border }]} testID={`set-${exerciseId}-${index}`}>
    <View style={styles.header}><Text style={[text, styles.bold]}>{label}</Text><Text style={muted}>{t(saved ? saved.status : "unrecorded")}</Text></View>
    {saved ? <>
      <Text style={text}>{confirmedValues(saved, locale)}</Text>
      {active && saved.status === "done" && <Button variant="outline" label={t("undo")} disabled={busy} onPress={() => void submit(voidSetRequest(saved), false)} />}
    </> : active && <>
      {previous && <Text style={muted}>{t("previous", { weight: previous.weightKg ?? "—", reps: previous.reps ?? "—" })}</Text>}
      <View style={styles.inputs}>
        <TextInput style={input} value={weight} placeholder="—" placeholderTextColor={c.muted} keyboardType="decimal-pad" accessibilityLabel={`${label} ${t("weight")}`}
          onChangeText={v => { setWeight(v); setChanged(s => ({ ...s, weight: true })); }} />
        <TextInput style={input} value={reps} placeholder="—" placeholderTextColor={c.muted} keyboardType="number-pad" accessibilityLabel={`${label} ${t("reps")}`}
          onChangeText={v => { setReps(v); setChanged(s => ({ ...s, reps: true })); }} />
        <TextInput style={input} value={rpe} placeholder={t("rpe")} placeholderTextColor={c.muted} keyboardType="decimal-pad" accessibilityLabel={`${label} ${t("rpeLabel")}`} onChangeText={setRpe} />
      </View>
      {invalid && <Text accessibilityRole="alert" style={text}>{t("invalid")}</Text>}
      <View style={styles.inputs}>
        <View style={styles.grow}><Button label={t("complete")} disabled={busy || reps.trim() === ""} onPress={() => send("done")} /></View>
        <View style={styles.grow}><Button variant="outline" label={t("skip")} disabled={busy} onPress={() => send("skipped")} /></View>
      </View>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  row: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 8 },
  header: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontWeight: "600" },
  inputs: { flexDirection: "row", gap: 8 },
  input: { flex: 1, minWidth: 0, minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 16 }, // minWidth lets web inputs shrink to a third.
  grow: { flex: 1 },
});

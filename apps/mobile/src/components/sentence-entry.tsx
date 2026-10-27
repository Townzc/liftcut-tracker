import type { Session } from "@liftcut/core/today";
import { exerciseLabel } from "@liftcut/core/exercise-display";
import type { CommandReceipt, CommandRequest } from "@liftcut/core/workout-commands";
import { workoutContext } from "@liftcut/core/workout-context";
import { parseWorkoutLog, type LogDraft, type ParseResult } from "@liftcut/core/workout-log-parser";
import type { WorkoutOperation } from "@liftcut/core/workout-outbox";
import { randomUUID } from "expo-crypto";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Card } from "@/components/ui";
import { contextHash } from "@/lib/context-hash";
import { useI18n } from "@/lib/i18n";
import { setValues } from "@/lib/display";
import type { MessageKey } from "@/lib/messages";
import { useColors } from "@/lib/theme";

/** The web's quick entry on the phone: rules-only draft (works offline), explicit confirmation, then the same queued command. */
export function SentenceEntry({ session, busy, submit }: { session: Session; busy: boolean; submit: (p: WorkoutOperation) => Promise<boolean> }) {
  const { t, locale } = useI18n(), c = useColors();
  const [text, setText] = useState(""), [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<{ result: ParseResult; command: CommandRequest | null } | null>(null);
  const draft = preview?.result.status === "draft" ? preview.result.draft : null;
  const exercise = draft && draft.kind !== "end" ? session.prescription.exercises.find(e => e.id === draft.exerciseId)?.name : "";
  async function parse() {
    const result = parseWorkoutLog(text, workoutContext(session, selected || undefined));
    let command: CommandRequest | null = null;
    if (result.status === "draft" && result.draft.kind !== "end") {
      const d = result.draft, count = d.kind === "record" ? d.sets.length : d.kind === "skip" ? 1 : 0;
      command = { sessionId: session.id, text, ...(selected ? { selectedExerciseId: selected } : {}), id: randomUUID(), version: 1,
        contextHash: await contextHash(session), setIds: Array.from({ length: count }, () => randomUUID()), authorization: "confirm_preview" };
    }
    setPreview({ result, command });
  }
  async function confirm() {
    // A set saved since the preview would make the server answer STALE_CONTEXT and pause the queue: preview again instead.
    if (preview?.command && await contextHash(session) !== preview.command.contextHash) return parse();
    const p: WorkoutOperation | null = draft?.kind === "end" ? { action: "end", body: { id: session.id, revision: session.revision + 1, status: "ended" } }
      : preview?.command ? { action: "apply", body: preview.command } : null;
    if (p && await submit(p)) { setText(""); setPreview(null); }
  }
  const text_ = { color: c.text }, muted = { color: c.muted };
  return <Card>
    <Text style={[styles.heading, text_]}>{t("sentenceTitle")}</Text>
    <Text style={muted}>{t("sentenceHint")}</Text>
    <View style={styles.wrap}>
      {[{ id: "", name: t("fromText") }, ...session.prescription.exercises].map(e => <Button key={e.id || "auto"} variant={selected === e.id ? "primary" : "outline"}
        label={exerciseLabel(e.name, locale)} onPress={() => { setSelected(e.id); setPreview(null); }} />)}
    </View>
    <TextInput style={[styles.input, { color: c.text, borderColor: c.border }]} value={text} multiline maxLength={400} accessibilityLabel={t("sentenceInput")}
      placeholder={t("sentenceExample")} placeholderTextColor={c.muted} onChangeText={v => { setText(v); setPreview(null); }} />
    <Button variant="outline" label={t("sentencePreview")} disabled={busy || !text.trim()} onPress={() => void parse()} />
    {preview?.result.status === "clarify" && <Text accessibilityRole="alert" style={text_}>{t(`clarify_${preview.result.reason}` as MessageKey)}</Text>}
    {draft && <View testID="sentence-preview" style={[styles.preview, { borderColor: c.border }]}>
      <Text style={[text_, styles.bold]}>{t("rulesDraft")}{exercise ? ` · ${exerciseLabel(exercise, locale)}` : ""}</Text>
      <DraftLines draft={draft} session={session} />
      <Button label={t(draft.kind === "end" ? "end" : "sentenceConfirm")} disabled={busy} onPress={() => void confirm()} />
      <Text style={muted}>{t("sentenceUnknown")}</Text>
    </View>}
  </Card>;
}

/** A draft's actual values as reported; unknown values show "—" and are never filled from the plan. */
export function DraftLines({ draft, session }: { draft: LogDraft; session: Session }) {
  const { t, locale } = useI18n(), text_ = { color: useColors().text };
  return <>
    {draft.kind === "record" && draft.sets.map(s => <Text key={s.setIndex} style={text_}>{t("set", { n: s.setIndex })}: {setValues({ load: s.reportedWeight, unit: s.inputUnit, reps: s.reps, rpe: s.rpe }, locale)}</Text>)}
    {draft.kind === "correct" && <Text style={text_}>{t("sentenceCorrection", { n: draft.setIndex, before: session.sets.find(s => s.id === draft.recordId)?.reps ?? "—", after: draft.changes.reps })}</Text>}
    {draft.kind === "skip" && <Text style={text_}>{t("sentenceSkip", { n: draft.setIndex })}</Text>}
    {draft.kind === "end" && <Text style={text_}>{t("endHint")}</Text>}
  </>;
}
export function SentenceReceipts({ receipts, pending, busy, submit }: { receipts: CommandReceipt[]; pending: string[]; busy: boolean; submit: (p: WorkoutOperation) => Promise<boolean> }) {
  const { t } = useI18n(), c = useColors();
  if (!receipts.length) return null;
  return <Card>
    <Text style={[styles.heading, { color: c.text }]}>{t("receipts")}</Text>
    {receipts.slice(0, 5).map(r => <View key={r.id} testID={`receipt-${r.id}`} style={[styles.preview, { borderColor: c.border }]}>
      <Text style={{ color: c.text }}>“{r.text}”</Text>
      <Text style={{ color: c.muted }}>{pending.includes(r.id) ? t("receiptPending") : r.undo ? t("receiptUndone") : t("receiptSaved")}</Text>
      {!r.undo && !pending.includes(r.id) && <Button variant="outline" label={t("receiptUndo")} disabled={busy}
        onPress={() => void submit({ action: "undo", body: { id: randomUUID(), commandId: r.id, version: 1 } })} />}
    </View>)}
  </Card>;
}
const styles = StyleSheet.create({
  heading: { fontSize: 18, fontWeight: "600" },
  bold: { fontWeight: "600" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { minHeight: 88, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16, textAlignVertical: "top" },
  preview: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 6 },
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { COACH_CONSENT_VERSION, conversationHistory } from "@liftcut/core/coach-chat";
import { MODEL_DATA } from "@liftcut/core/model-data";
import { entryLines } from "@liftcut/core/personal-records";
import { randomUUID } from "expo-crypto";
import { getCalendars } from "expo-localization";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import { DraftLines } from "@/components/sentence-entry";
import { CoachReview } from "@/components/coach-review";
import { Button, Card } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { askCoach, type CoachReply } from "@/lib/coach";
import { reviewWriteState } from "@/lib/coach-review";
import { contextHash } from "@/lib/context-hash";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useColors } from "@/lib/theme";
import { useWorkout } from "@/lib/workout";

type Turn = { id: string; text: string; reply: "data" | "draft" | "personal" | "queued" | "personalQueued" | "closed" | "stale"; live?: string; lines?: string[]; pending?: boolean; interrupted?: boolean;
  error?: string; sources?: CoachReply["sources"]; proposal?: CoachReply["proposal"] };

/** The web coach on the phone: same endpoint and consent; a draft is saved only after confirmation, through the same queues as the web. */
export default function Coach() {
  const { session } = useSession();
  return session ? <AccountCoach key={session.user.id} /> : null;
}
function AccountCoach() {
  const { session: auth } = useSession(), { t, locale } = useI18n(), c = useColors(), { outbox, state, personal } = useWorkout();
  const key = `liftcut-coach-consent:${auth?.user.id}`;
  const [consented, setConsented] = useState<boolean | null>(null), [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const [conversationId] = useState(randomUUID), flight = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => { AsyncStorage.getItem(key).then(v => setConsented(v === COACH_CONSENT_VERSION)).catch(() => setConsented(false)); }, [key]);
  useEffect(() => { void outbox?.load().catch(() => {}); }, [outbox]);
  const session = state?.confirmed?.session ?? null;
  const draftId = turns.findLast(x => x.proposal && x.proposal.kind !== "plan")?.id;
  const update = (id: string, patch: Partial<Turn>) => setTurns(ts => ts.map(x => x.id === id ? { ...x, ...patch } : x));
  const consent = (on: boolean) => { setConsented(on); void (on ? AsyncStorage.setItem(key, COACH_CONSENT_VERSION) : AsyncStorage.removeItem(key)).catch(() => {}); };

  async function send() {
    const input = text.trim();
    if (!input || busy || flight.current || !auth) return;
    flight.current = true; const abort = new AbortController(); controller.current = abort;
    const id = randomUUID(), history = conversationHistory(turns);
    // Only the newest draft can be confirmed; a new message closes an unconfirmed one.
    setTurns(ts => [...ts.map(x => x.id === draftId && (x.reply === "draft" || x.reply === "personal") ? { ...x, reply: "closed" as const } : x), { id, text: input, reply: "data", pending: true }]);
    setText(""); setBusy(true);
    try {
      const reply = await askCoach(auth, { id, conversationId, text: input, history, locale: locale === "en" ? "en" : "zh",
        timezone: getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone }, live => update(id, { live }), abort.signal);
      update(id, { pending: false, lines: [reply.message], sources: reply.sources, proposal: reply.proposal,
        reply: reply.proposal?.kind === "workout" || reply.proposal?.kind === "workoutReview" ? "draft" : reply.proposal?.kind === "personal" ? "personal" : "data" });
    } catch (error) {
      update(id, { pending: false, interrupted: true, error: error instanceof ApiError ? error.code : error instanceof Error ? error.message : "UNKNOWN" });
    } finally { flight.current = false; setBusy(false); }
  }
  async function confirm(turn: Turn) {
    const p = turn.proposal;
    if (busy || flight.current || !p || p.kind === "plan" || turn.id !== draftId || !["draft", "personal"].includes(turn.reply)) return;
    flight.current = true;
    setBusy(true); setNotice(false);
    try {
      if (p.kind === "personal") { if (!personal) return; await personal.submit(p.command); update(turn.id, { reply: "personalQueued" }); void personal.drain(); return; }
      if (!outbox) return;
      const current = await outbox.load(), confirmed = current.confirmed?.session;
      if (current.items.length || current.owner !== auth?.user.id) throw new Error("LOCAL_CONFLICT");
      if (!confirmed || confirmed.userId !== auth?.user.id || await contextHash(confirmed) !== p.hash
        || (p.kind === "workoutReview" && p.review.conversationId !== conversationId)) return update(turn.id, { reply: "stale" });
      await outbox.enqueue(p.operation); update(turn.id, { reply: "queued" }); void outbox.drain();
    } catch { setNotice(true); } finally { flight.current = false; setBusy(false); }
  }

  const text_ = { color: c.text }, muted = { color: c.muted };
  if (consented === null) return null;
  if (!consented) return <ScrollView contentContainerStyle={styles.content}><Card>
    <Text style={[text_, styles.bold]}>{t("coachConsentTitle")}</Text>
    <Text style={muted}>{t("coachConsentHint")}</Text>
    {MODEL_DATA.map(d => <Text key={d.id} testID="coach-data-category" style={text_}>· {locale === "en" ? d.en : d.zh}</Text>)}
    <Button label={t("coachConsent")} onPress={() => consent(true)} />
  </Card></ScrollView>;
  return <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView ref={scroll} contentContainerStyle={styles.content} onContentSizeChange={() => scroll.current?.scrollToEnd()} keyboardShouldPersistTaps="handled">
      {turns.map(turn => { const p = turn.proposal, draft = p?.kind === "workout" ? p.draft : null, entry = p?.kind === "personal" && p.command.action === "create" ? p.command.entry : null;
        const open = turn.id === draftId && (turn.reply === "draft" || turn.reply === "personal");
        const review = p?.kind === "workoutReview" ? p : null;
        const saved = review ? reviewWriteState(review, state) : null;
        return <View key={turn.id} testID="coach-turn" aria-busy={!!turn.pending} style={styles.gap}>
        <Text style={[text_, styles.user, { backgroundColor: c.card }]}>{turn.text}</Text>
        <Text style={text_}>{turn.interrupted ? t("coachFailed", { code: turn.error ?? "UNKNOWN" }) : turn.pending ? turn.live || t("coachReplying") : turn.lines?.join("\n")}</Text>
        {turn.sources?.map(s => <Text key={s.id} style={muted}>{t("coachSource", { topic: s.topic, from: s.from, to: s.to, count: s.rows.length })}</Text>)}
        {p?.kind === "plan" && <Text style={muted}>{t("coachWebOnly")}</Text>}
        {(turn.reply === "queued" || turn.reply === "personalQueued") && <Text accessibilityRole="alert" style={text_}>{t(saved === "saved" ? "coachSaved" : saved === "failed" ? "localConflict" : saved === "unknown" ? "coachReceiptUnknown" : "coachQueued")}</Text>}
        {(draft || entry || review) && !open && turn.reply !== "queued" && turn.reply !== "personalQueued" && <Text style={muted}>{t(turn.reply === "stale" ? "coachStale" : "coachClosed")}</Text>}
        {review && open && <CoachReview proposal={review} disabled={busy || !!state?.items.length} confirm={() => void confirm(turn)} />}
        {entry && open && <Card><Text style={[text_, styles.bold]}>{t("coachRecordDraft")} · {entry.date}</Text>
          {entryLines(entry, locale === "en").map((line, i) => <Text key={i} style={text_}>{line}</Text>)}
          <Button label={t("coachConfirmRecord")} disabled={busy} onPress={() => void confirm(turn)} />
          <Text style={muted}>{t("coachRecordUnknown")}</Text></Card>}
        {draft && open && session && <Card><Text style={[text_, styles.bold]}>{t("coachDraft")}{draft.kind !== "end" ? ` · ${session.prescription.exercises.find(e => e.id === draft.exerciseId)?.name ?? ""}` : ""}</Text>
            <DraftLines draft={draft} session={session} />
            <Button label={t("coachConfirm")} disabled={busy} onPress={() => void confirm(turn)} />
            <Text style={muted}>{t("sentenceUnknown")}</Text></Card>}
      </View>; })}
      {notice && <Text accessibilityRole="alert" style={text_}>{t("localConflict")}</Text>}
    </ScrollView>
    <View style={[styles.composer, { borderColor: c.border }]}>
      <TextInput style={[styles.input, { color: c.text, borderColor: c.border }]} value={text} onChangeText={setText} maxLength={400} multiline
        accessibilityLabel={t("coachInput")} placeholder={t("coachInput")} placeholderTextColor={c.muted} />
      <Button label={t("coachSend")} disabled={busy || !text.trim()} onPress={() => void send()} />
      <Button variant="outline" label={t("coachRevoke")} disabled={busy} onPress={() => consent(false)} />
    </View>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, gap: 16 },
  gap: { gap: 6 },
  bold: { fontWeight: "600" },
  user: { alignSelf: "flex-end", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, overflow: "hidden" },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16, minHeight: 48 },
});

import { Text, View } from "react-native";
import type { ReviewProposal } from "@/lib/coach-review";
import { useI18n } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { Button, Card } from "./ui";

export function CoachReview({ proposal: p, disabled, confirm }: { proposal: ReviewProposal; disabled: boolean; confirm: () => void }) {
  const { t, locale } = useI18n(), c = useColors(), en = locale === "en";
  const display = (s: ReviewProposal["review"]["requests"][number]) => s.status === "voided" ? (en ? "Voided" : "作废") :
    s.status === "skipped" ? (en ? "Skipped" : "跳过") :
    `${s.perHandLoad ? `${s.perHandLoad.value} ${s.perHandLoad.unit} ${en ? "per hand" : "/ 单边"}` : `${s.weightKg ?? "—"} kg`} × ${s.reps ?? "—"} · RPE ${s.rpe ?? "—"}`;
  return <Card><Text style={{ color: c.text, fontWeight: "600" }}>{t("coachReview")}</Text>
    {p.review.requests.map((s, i) => <View key={s.id}>
      <Text style={{ color: c.text }}>{p.session.prescription.exercises.find(e => e.id === s.planExerciseId)?.name}</Text>
      {p.review.before[i] && <Text style={{ color: c.muted }}>{display(p.review.before[i]!)} →</Text>}
      <Text style={{ color: c.text }}>{en ? `Set ${s.setIndex}` : `第 ${s.setIndex} 组`}: {display(s)}</Text>
    </View>)}
    {p.review.kind === "void" && <Text style={{ color: c.muted }}>{t("coachRedoHint")}</Text>}
    <Text style={{ color: c.muted }}>{t("sentenceUnknown")}</Text>
    <Button label={t("coachConfirm")} disabled={disabled} onPress={confirm} />
  </Card>;
}

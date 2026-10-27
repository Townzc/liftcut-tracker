import { Link } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput } from "react-native";
import { Button, Card } from "@/components/ui";
import { apiBase } from "@/lib/api";
import { deletionApi, freshDeletionAuth } from "@/lib/deletion-api";
import { useDeletion } from "@/lib/deletion-context";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useColors } from "@/lib/theme";
import { mobileDeletionAccess } from "@/lib/deletion-access";

/** Public route: a deleted Auth user or an expired main session cannot eject recovery. */
export default function DeleteAccount() {
  const { session } = useSession();
  return <DeletionForm key={session?.user.id ?? "signed-out"} />;
}
function DeletionForm() {
  const deletion = useDeletion(), { session } = useSession(), { t, locale } = useI18n(), c = useColors();
  const [available, setAvailable] = useState(false), [password, setPassword] = useState(""), [confirmed, setConfirmed] = useState(false);
  const flight = useRef(false), active = session?.user;
  const record = active ? deletion.records.get(active.id) : deletion.records.values().next().value;
  const owner = record?.owner ?? active?.id, email = record?.email ?? active?.email;
  const access = mobileDeletionAccess(available, record, active?.id);
  useEffect(() => { let alive = true; void deletionApi().available().then(v => { if (alive) setAvailable(v); }).catch(() => {}); return () => { alive = false; }; }, []);
  async function begin() {
    if (!owner || !email || !access.canBegin || !confirmed || !password || flight.current) return;
    flight.current = true; const secret = password; setPassword("");
    try {
      await deletion.begin(owner, email, confirmed, () => freshDeletionAuth(owner, email, secret));
      if (!deletion.error && deletion.records.get(owner)?.receipt) await deletion.resume(owner);
    } finally { flight.current = false; }
  }
  const text = { color: c.text }, muted = { color: c.muted };
  return <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 64, gap: 16 }} keyboardShouldPersistTaps="handled">
    <Text style={[text, { fontSize: 26, fontWeight: "600" }]}>{t("deleteAccount")}</Text>
    {!deletion.ready ? <><Text style={text}>{t(deletion.error ? "deletionLocal" : "loading")}</Text>{deletion.error && <Button label={t("retry")} onPress={() => void deletion.load()} />}</>
      : deletion.completed ? <Text accessibilityRole="alert" style={text}>{t("deletionDone")}</Text>
      : <>
        {email && <Text style={text}>{email}</Text>}
        <Text style={muted}>{t("deletionScope")}</Text>
        {record && <Card><Text style={text}>{t("deletionPending")}</Text>
          {(record.receipt || record.stage === "deleted") && <Button label={t(deletion.busy ? "deletionBusy" : "deletionResume")} disabled={deletion.busy} onPress={() => void deletion.resume(record.owner)} />}
        </Card>}
        {deletion.error && <Text accessibilityRole="alert" style={text}>{t(deletion.error === "receipt_expired" ? "deletionExpired" : deletion.error === "AUTH" || deletion.error === "reauthenticate" ? "deletionAuth" : "deletionUnknown")}</Text>}
        {access.canBegin && owner && email ? <Card>
          <TextInput accessibilityLabel={t("deletionPassword")} placeholder={t("deletionPassword")} placeholderTextColor={c.muted} secureTextEntry autoCapitalize="none"
            value={password} onChangeText={setPassword} editable={!deletion.busy} style={[text, { padding: 12, borderWidth: 1, borderColor: c.border, borderRadius: 12 }]} />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }} disabled={deletion.busy} onPress={() => setConfirmed(v => !v)} style={{ paddingVertical: 12 }}>
            <Text style={text}>{confirmed ? "☑" : "☐"} {t("deletionConfirm")}</Text>
          </Pressable>
          <Button label={t(deletion.busy ? "deletionBusy" : "deletionSubmit")} disabled={deletion.busy || !confirmed || !password} onPress={() => void begin()} />
        </Card> : !record && !access.canBegin && <Text style={muted}>{t(available ? "deletionBuildUnavailable" : "deletionUnavailable")}</Text>}
        {available && <><Text style={muted}>{t("deletionWeb")}</Text><Button variant="outline" label={t("deletionWebOpen")}
          onPress={() => void Linking.openURL(`${apiBase}/delete-account?lang=${locale}`).catch(() => {})} /></>}
      </>}
    {!record && deletion.ready && <Link href={session ? "/settings" : "/sign-in"} style={text}>{t("deletionBack")}</Link>}
  </ScrollView>;
}

import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui";
import { SupportLink } from "@/components/support-link";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/theme";

export default function SignIn() {
  const { t } = useI18n(), c = useColors();
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  async function submit() {
    if (!supabase) return;
    setBusy(true); setFailed(false);
    // On success the session listener swaps the protected stack in; nothing else to do here.
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }).catch(() => ({ error: true }));
    setBusy(false); setFailed(!!error);
  }
  const input = [styles.input, { color: c.text, borderColor: c.border }];
  return <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]}>
    <View style={styles.form}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>{t("signInTitle")}</Text>
      <Text style={{ color: c.muted, lineHeight: 22 }}>{t("signInHint")}</Text>
      {!supabase ? <Text accessibilityRole="alert" style={{ color: c.text }}>{t("notConfigured")}</Text> : <>
        <TextInput style={input} value={email} onChangeText={setEmail} placeholder={t("email")} placeholderTextColor={c.muted}
          accessibilityLabel={t("email")} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
        <TextInput style={input} value={password} onChangeText={setPassword} placeholder={t("password")} placeholderTextColor={c.muted}
          accessibilityLabel={t("password")} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={() => void submit()} />
        {failed && <Text accessibilityRole="alert" style={{ color: c.text }}>{t("signInFailed")}</Text>}
        <Button label={busy ? t("signingIn") : t("signIn")} disabled={busy || !email.trim() || !password} onPress={() => void submit()} />
      </>}
      <SupportLink />
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center" },
  form: { gap: 16, paddingHorizontal: 24, maxWidth: 480, width: "100%", alignSelf: "center" },
  title: { fontSize: 28, fontWeight: "600", letterSpacing: -0.5 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
});

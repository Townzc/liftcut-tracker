import { useRef, useState } from "react";
import { router } from "expo-router";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui";
import { PrivacyLink, SupportLink } from "@/components/support-link";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/theme";
import { cancelEmailSignup, mobileEmailSignupEnabled } from "@/lib/email-signup-native";

export default function SignIn() {
  const { t } = useI18n(), c = useColors();
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const submitting = useRef(false);
  async function submit() {
    if (!supabase || submitting.current) return;
    submitting.current = true;
    setBusy(true); setFailed(false);
    // On success the session listener swaps the protected stack in; nothing else to do here.
    try {
      await cancelEmailSignup();
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setFailed(!!error);
    } catch { setFailed(true); }
    finally { submitting.current = false; setBusy(false); }
  }
  const input = [styles.input, { color: c.text, borderColor: c.border }];
  return <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]}>
    <View style={styles.form}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>{t("signInTitle")}</Text>
      <Text style={{ color: c.muted, lineHeight: 22 }}>{t(mobileEmailSignupEnabled ? "signInSharedAccount" : "signInHint")}</Text>
      {!supabase ? <Text accessibilityRole="alert" style={{ color: c.text }}>{t("notConfigured")}</Text> : <>
        <TextInput style={input} value={email} onChangeText={setEmail} placeholder={t("email")} placeholderTextColor={c.muted}
          accessibilityLabel={t("email")} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
        <TextInput style={input} value={password} onChangeText={setPassword} placeholder={t("password")} placeholderTextColor={c.muted}
          accessibilityLabel={t("password")} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={() => void submit()} />
        {failed && <Text accessibilityRole="alert" style={{ color: c.text }}>{t("signInFailed")}</Text>}
        <Button label={busy ? t("signingIn") : t("signIn")} disabled={busy || !email.trim() || !password} onPress={() => void submit()} />
        {mobileEmailSignupEnabled && <Button label={t("signUp")} variant="outline" disabled={busy} onPress={() => router.push("/register")} />}
      </>}
      <SupportLink />
      <PrivacyLink />
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center" },
  form: { gap: 16, paddingHorizontal: 24, maxWidth: 480, width: "100%", alignSelf: "center" },
  title: { fontSize: 28, fontWeight: "600", letterSpacing: -0.5 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
});

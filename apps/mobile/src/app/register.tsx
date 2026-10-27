import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Button } from "@/components/ui";
import { SupportLink } from "@/components/support-link";
import { emailSignup, mobileEmailSignupEnabled, cancelEmailSignup } from "@/lib/email-signup-native";
import { useI18n } from "@/lib/i18n";
import { useColors } from "@/lib/theme";

export default function Register() {
  const { locale, t } = useI18n(), c = useColors();
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [pending, setPending] = useState<string | null>(null), [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), active = useRef(true), submitting = useRef(false);
  useEffect(() => {
    active.current = true;
    if (mobileEmailSignupEnabled) void emailSignup!.pending().then(value => { if (active.current) { setPending(value?.email ?? null); setReady(true); } }, () => { if (active.current) setFailed(true); });
    return () => { active.current = false; };
  }, []);
  async function submit() {
    if (!ready || !mobileEmailSignupEnabled || !emailSignup || submitting.current || pending) return;
    submitting.current = true; setBusy(true); setFailed(false);
    const suppliedPassword = password; setPassword("");
    try {
      const value = await emailSignup.start(email, suppliedPassword, locale);
      if (active.current) setPending(value.email);
    } catch { if (active.current) setFailed(true); }
    finally { submitting.current = false; if (active.current) setBusy(false); }
  }
  async function back() {
    try { await cancelEmailSignup(); router.replace("/sign-in"); }
    catch { if (active.current) setFailed(true); }
  }
  const input = { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: c.text, borderColor: c.border };
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}><View style={{ gap: 16, maxWidth: 480, width: "100%", alignSelf: "center" }}>
      <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: "600", color: c.text }}>{t("signUp")}</Text>
      <Text style={{ color: c.muted, lineHeight: 22 }}>{t(!mobileEmailSignupEnabled ? "signUpUnavailable" : pending ? "signUpWaiting" : "signUpHint", { email: pending ?? "" })}</Text>
      {mobileEmailSignupEnabled && !pending && <>
        <TextInput style={input} value={email} onChangeText={setEmail} placeholder={t("email")} placeholderTextColor={c.muted} accessibilityLabel={t("email")}
          editable={!busy} autoCapitalize="none" autoComplete="email" textContentType="emailAddress" keyboardType="email-address" />
        <TextInput style={input} value={password} onChangeText={setPassword} placeholder={t("password")} placeholderTextColor={c.muted} accessibilityLabel={t("password")}
          editable={!busy} secureTextEntry autoComplete="new-password" textContentType="newPassword" onSubmitEditing={() => void submit()} />
        <Button label={busy ? t("signUpSending") : t("signUpSend")} disabled={!ready || busy || !email.trim() || password.length < 8} onPress={() => void submit()} />
      </>}
      {failed && <Text accessibilityRole="alert" style={{ color: c.text }}>{t("signUpFailed")}</Text>}
      <Button label={t("signUpCancel")} variant="outline" onPress={() => void back()} />
      <SupportLink />
    </View></ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}

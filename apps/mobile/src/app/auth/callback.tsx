import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { clearInitialURL, useLinkingURL } from "expo-linking";
import { Button } from "@/components/ui";
import { emailSignup, mobileEmailSignupEnabled, cancelEmailSignup } from "@/lib/email-signup-native";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { useColors } from "@/lib/theme";

export default function EmailCallback() {
  const url = useLinkingURL(), { session } = useSession(), { t } = useI18n(), c = useColors();
  const [result, setResult] = useState<{ url: string; ok: boolean } | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    if (url && !session && mobileEmailSignupEnabled) void emailSignup!.verify(url).then(
      () => { if (active) setResult({ url, ok: true }); }, () => { if (active) setResult({ url, ok: false }); });
    return () => { active = false; }; // StrictMode remount attaches to the same controller promise.
  }, [url, session]);
  const status = session ? "signUpExistingAccount" : !mobileEmailSignupEnabled ? "signUpUnavailable" :
    result?.url === url ? result.ok ? "signUpVerified" : "signUpCallbackFailed" : url ? "signUpVerifying" : "signUpCallbackFailed";
  async function leave() {
    try { await cancelEmailSignup(); clearInitialURL(); router.replace(session ? "/" : "/sign-in"); }
    catch { setFailed(true); }
  }
  return <SafeAreaView style={{ flex: 1, justifyContent: "center", backgroundColor: c.background }}><View style={{ gap: 20, padding: 24, maxWidth: 480, width: "100%", alignSelf: "center" }}>
    <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: "600", color: c.text }}>{t("signUpConfirmTitle")}</Text>
    <Text accessibilityLiveRegion="polite" style={{ color: c.muted, lineHeight: 24 }}>{t(status)}</Text>
    {failed && <Text accessibilityRole="alert" style={{ color: c.text }}>{t("signUpFailed")}</Text>}
    <Button label={t(session ? "signUpReturn" : "signUpCancel")} onPress={() => void leave()} />
  </View></SafeAreaView>;
}

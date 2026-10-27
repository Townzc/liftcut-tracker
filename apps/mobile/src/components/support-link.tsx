import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { useI18n } from "@/lib/i18n";
import { useColors } from "@/lib/theme";

export function SupportLink() {
  const { locale, t } = useI18n(), c = useColors();
  const [failed, setFailed] = useState(false);
  async function open() {
    setFailed(false);
    // Only the explicit UI locale crosses into the browser, never account or record data.
    try { await Linking.openURL(`https://www.liftcuttracker.com/support?lang=${locale}`); }
    catch { setFailed(true); }
  }
  return <View>
    <Pressable accessibilityRole="link" onPress={() => void open()}
      style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: c.text, textDecorationLine: "underline", fontSize: 16 }}>{t("support")}</Text>
    </Pressable>
    {failed && <Text accessibilityRole="alert" style={{ color: c.muted, lineHeight: 22 }}>{t("supportOpenFailed")}</Text>}
  </View>;
}

import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useColors } from "@/lib/theme";

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>;
}
export function Button({ label, onPress, disabled, variant = "primary" }: { label: string; onPress: () => void; disabled?: boolean; variant?: "primary" | "outline" }) {
  const c = useColors(), primary = variant === "primary";
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, { backgroundColor: primary ? c.primary : "transparent", borderColor: primary ? c.primary : c.border, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
    <Text style={{ color: primary ? c.onPrimary : c.text, fontSize: 16, fontWeight: "600" }}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 6 },
  button: { minHeight: 48, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
});

import { useColorScheme } from "react-native";

// Black and white, matching the web app; the system setting picks light or dark.
const light = { background: "#ffffff", text: "#0a0a0a", muted: "#6b6b6b", border: "#e5e5e5", card: "#f5f5f5", primary: "#0a0a0a", onPrimary: "#ffffff" };
const dark: typeof light = { background: "#0a0a0a", text: "#fafafa", muted: "#a3a3a3", border: "#262626", card: "#171717", primary: "#fafafa", onPrimary: "#0a0a0a" };
export type Colors = typeof light;
export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

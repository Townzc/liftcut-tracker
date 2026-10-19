import { useColorScheme } from "react-native";

// Black and white, matching the web app; the system setting picks light or dark.
// `levels` shades history charts from none to most, in grays only.
const light = { background: "#ffffff", text: "#0a0a0a", muted: "#6b6b6b", border: "#e5e5e5", card: "#f5f5f5", primary: "#0a0a0a", onPrimary: "#ffffff",
  levels: ["#ededed", "#c4c4c4", "#8a8a8a", "#4a4a4a", "#0a0a0a"] };
const dark: typeof light = { background: "#0a0a0a", text: "#fafafa", muted: "#a3a3a3", border: "#262626", card: "#171717", primary: "#fafafa", onPrimary: "#0a0a0a",
  levels: ["#262626", "#4a4a4a", "#8a8a8a", "#c4c4c4", "#fafafa"] };
export type Colors = typeof light;
export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

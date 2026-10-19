import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// Side effects only; every call degrades silently (web export, denied permission, old devices).
const native = Platform.OS !== "web";
if (native) Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

/** Asks only when the first rest starts, never at launch. */
async function allowed() {
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("rest", { name: "Rest timer", importance: Notifications.AndroidImportance.HIGH });
  const current = await Notifications.getPermissionsAsync();
  return current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
}
/** A local notification at the end of the rest, so it still arrives with the screen off or the app in the background. */
export async function scheduleRestEnd(seconds: number, content: { title: string; body: string }): Promise<string | null> {
  if (!native) return null;
  try {
    if (!(await allowed())) return null;
    return await Notifications.scheduleNotificationAsync({ content: { ...content, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(1, Math.round(seconds)), channelId: "rest" } });
  } catch { return null; }
}
export async function cancelRestEnd(id: string | null) {
  if (native && id) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
}
export function feedback(kind: "done" | "light") {
  if (!native) return;
  void (kind === "done" ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync()).catch(() => {});
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { OutboxState } from "@liftcut/core/workout-outbox";

// The web export is an automated test surface only; expo-sqlite on web needs wasm and COOP/COEP headers.
const key = (owner: string) => `liftcut-outbox:${owner}`;
export const outboxStore = {
  async read(owner: string): Promise<OutboxState | null> {
    const value = await AsyncStorage.getItem(key(owner));
    return value ? JSON.parse(value) as OutboxState : null;
  },
  async write(owner: string, state: OutboxState) { await AsyncStorage.setItem(key(owner), JSON.stringify(state)); },
  async removeOwner(owner: string) { await AsyncStorage.removeItem(key(owner)); },
};

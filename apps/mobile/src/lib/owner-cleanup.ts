import { z } from "zod";
import type { CoachHistoryClient } from "@liftcut/core/coach-history-client";
import type { MobileOutbox, OutboxStore } from "./outbox";
import type { PersonalQueue, KeyValueStore } from "./personal-queue";

type Clients = { outbox: MobileOutbox; personal: PersonalQueue;
  history: { owner: string; client: Pick<CoachHistoryClient, "dispose" | "whenStored"> } };
type Stores = { outboxStore: OutboxStore & { removeOwner(owner: string): Promise<void> }; storage: KeyValueStore };
function owned(owner: string, clients: Clients) {
  z.uuid().parse(owner);
  if (clients.outbox.owner !== owner || clients.personal.owner !== owner || clients.history.owner !== owner) throw Error("ACCOUNT_CHANGED");
}
/** Future deletion UI: stop on pending, preserving exact queues and the deletion receipt.
 * The caller must also stop its scheduler/model/review requests and prevent remount for this owner.
 */
export function stopOwnerQueues(owner: string, clients: Clients) {
  owned(owner, clients); clients.outbox.dispose(); clients.personal.dispose(); clients.history.client.dispose(false);
}
/** Only call after this owner's server deletion was confirmed. No automatic purge on logout/error.
 * Queued local writes settle before removal; failure is retryable, never silently called complete.
 */
export async function purgeDeletedOwner(confirmed: { status: "deleted"; owner: string }, clients: Clients, stores: Stores) {
  const { owner } = z.object({ status: z.literal("deleted"), owner: z.uuid() }).strict().parse(confirmed);
  stopOwnerQueues(owner, clients); clients.history.client.dispose(true);
  await Promise.all([clients.outbox.whenIdle(), clients.personal.whenIdle(), clients.history.client.whenStored()]);
  await removeOwnerData(owner, stores);
}
/** Caller must first stop and drain every mounted owner writer, including model/review caches. */
export async function removeOwnerData(owner: string, stores: Stores) {
  z.uuid().parse(owner);
  await stores.outboxStore.removeOwner(owner);
  const exact = new Set([`liftcut-chat-history:${owner}`, `liftcut-review:${owner}`, `liftcut-coach-consent:${owner}`]);
  for (const key of await stores.storage.getAllKeys()) {
    if (exact.has(key) || key.startsWith(`liftcut-personal-v1:${owner}:`)) await stores.storage.removeItem(key);
  }
}

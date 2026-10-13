import "server-only";
import type { AgentStore } from "./store";

// Capabilities handed to a future model worker are bound to a trusted run/owner.
// User decisions are intentionally absent. Never hand a worker cookies or a DB URL.
export function planToolPort(store: AgentStore, verifiedUserId: string, runId: string) {
  return Object.freeze({
    read: () => store.get(verifiedUserId, runId),
    propose: (input: unknown) => store.publish(verifiedUserId, runId, input),
    execute: (input: unknown) => store.execute(verifiedUserId, runId, input),
  });
}

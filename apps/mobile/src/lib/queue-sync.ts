import type { MobileOutbox } from "./outbox";
import type { PersonalQueue } from "./personal-queue";

type Lifecycle = {
  currentState: string | null | undefined;
  addEventListener(event: "change", listener: (state: string) => void): { remove(): void };
};

/** Owned by the signed-in app, not the currently focused screen. */
export function startQueueSync(outbox: Pick<MobileOutbox, "resume" | "drain">, personal: Pick<PersonalQueue, "drain">, app: Lifecycle) {
  let stopped = false, active = app.currentState == null || app.currentState === "active";
  const run = (resume = false) => {
    if (stopped || !active) return;
    // A storage/network failure must not kill the next retry or the other queue.
    void (resume ? outbox.resume() : outbox.drain()).catch(() => {});
    void personal.drain().catch(() => {});
  };
  const subscription = app.addEventListener("change", state => {
    const wasActive = active;
    active = state === "active";
    if (active && !wasActive) run(true);
  });
  run(true);
  const timer = setInterval(run, 5000); // Queue backoff remains authoritative while foregrounded.
  return () => { stopped = true; clearInterval(timer); subscription.remove(); };
}

import type { Session, TodayData } from "@liftcut/core/today";
import { emptyOutbox, mergeConfirmed, operationBody, operationId, projectOperation, projectOutbox, retryDisposition,
  type OutboxItem, type OutboxState, type WorkoutOperation } from "@liftcut/core/workout-outbox";

export type OutboxStore = { read(owner: string): Promise<OutboxState | null>; write(owner: string, state: OutboxState): Promise<void> };
/** Network edge, injected so the queue logic is testable: a server answer, or a thrown error when the outcome is unknown. */
export type OutboxApi = {
  today(): Promise<TodayData>;
  send(action: WorkoutOperation["action"], bodyJson: string): Promise<{ ok: true; value: Session } | { ok: false; status: number; code: string }>;
};

/**
 * The web outbox's semantics on the phone, over the shared core projection: client
 * UUIDs, the exact bytes resent in order, the head never skipped, and a conflict or
 * auth failure pausing the whole tail until the user decides. The app has a single
 * JavaScript context, so a promise chain replaces the web's cross-tab leases.
 */
export class MobileOutbox {
  private chain: Promise<unknown> = Promise.resolve();
  private running: Promise<void> | null = null;
  private again = false;
  constructor(readonly owner: string, private store: OutboxStore, private api: OutboxApi, private emit: (state: OutboxState) => void,
    private now: () => number = Date.now) {}

  private change(mutate?: (state: OutboxState) => boolean): Promise<OutboxState> {
    const next = this.chain.then(async () => {
      const state = (await this.store.read(this.owner)) ?? emptyOutbox(this.owner);
      if (state.owner !== this.owner) throw new Error("ACCOUNT_CHANGED");
      if (mutate?.(state)) { state.revision++; await this.store.write(this.owner, state); }
      this.emit(state);
      return state;
    });
    this.chain = next.catch(() => {});
    return next;
  }
  /** Cold start: whatever was confirmed or queued before is shown immediately, online or not. */
  load() { return this.change(); }
  async refresh() {
    const before = await this.change();
    if (before.items.length) return before;
    const data = await this.api.today();
    if (data.session && data.session.userId !== this.owner) throw new Error("ACCOUNT_CHANGED");
    return this.change(s => { if (s.items.length || s.revision !== before.revision) return false; s.confirmed = data; return true; });
  }
  async enqueue(operation: WorkoutOperation) {
    const body = operationBody(operation), bodyJson = JSON.stringify(body), id = operationId(operation), at = new Date(this.now()).toISOString();
    const state = await this.change(s => {
      const duplicate = s.items.find(i => i.id === id);
      if (duplicate) { if (duplicate.bodyJson !== bodyJson) throw new Error("LOCAL_CONFLICT"); return false; } // A double tap is one write.
      if (s.items.some(i => i.status === "conflict" || i.status === "auth") || s.items.length >= 100) throw new Error("LOCAL_CONFLICT");
      const view = projectOutbox(s);
      if (!view.data || view.error || s.items.some(i => i.action === "start")) throw new Error("LOCAL_CONFLICT");
      projectOperation(view.data, { action: operation.action, body }, at); // Reject a stale or invalid step before it is stored.
      s.items.push({ id, action: operation.action, bodyJson, createdAt: at, status: "pending", attempts: 0, nextAttempt: 0 });
      return true;
    });
    void this.drain();
    return state;
  }
  async retry() {
    await this.change(s => { const head = s.items[0]; if (!head || head.status === "conflict") return false; head.status = "pending"; head.nextAttempt = 0; return true; });
    return this.drain();
  }
  /** After a conflict the user keeps the cloud version; the discarded steps are kept for reference, not resent. */
  async discardConflict() {
    const remote = await this.api.today();
    return this.change(s => {
      if (s.items[0]?.status !== "conflict") throw new Error("LOCAL_CONFLICT");
      s.discarded = [{ at: new Date(this.now()).toISOString(), items: s.items }, ...(s.discarded ?? [])].slice(0, 5);
      s.items = []; s.confirmed = remote; return true;
    });
  }
  /** Callers during a run join it, and the run repeats once so their trigger is never lost. */
  drain(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      try { do { this.again = false; await this.sendHead(); } while (this.again); } finally { this.running = null; }
    })();
    return this.running;
  }
  private async sendHead() {
    for (;;) {
      const state = await this.change();
      const head: OutboxItem | undefined = state.items[0];
      if (!head || head.status === "conflict" || head.status === "auth" || head.nextAttempt > this.now()) return;
      let result: Awaited<ReturnType<OutboxApi["send"]>> | null = null;
      try { result = await this.api.send(head.action, head.bodyJson); } catch { /* Unknown outcome: resend the same bytes later. */ }
      if (result?.ok && result.value.userId !== this.owner) result = { ok: false, status: 409, code: "ACCOUNT_CHANGED" };
      const settled = result;
      await this.change(s => {
        if (s.items[0]?.id !== head.id) return false;
        if (settled?.ok && s.confirmed) { s.confirmed = mergeConfirmed(s.confirmed, head.action, settled.value); s.items.shift(); return true; }
        const item = s.items[0];
        item.status = settled && !settled.ok ? retryDisposition(settled.status, settled.code) : "retry";
        item.error = settled && !settled.ok ? settled.code : "NETWORK"; item.attempts++;
        item.nextAttempt = this.now() + Math.min(60000, 5000 * 2 ** Math.min(item.attempts, 4));
        return true;
      });
      if (!settled?.ok) return;
    }
  }
}

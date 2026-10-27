import { z } from "zod";
import type { KeyValueStore } from "./personal-queue";
import type { OwnerRuntime } from "./owner-runtime";

const prefix = "liftcut-deletion-v1:";
const recordSchema = z.object({ owner: z.uuid(), email: z.string().email(), requestId: z.uuid(),
  receipt: z.string().min(40).max(2048).nullable(), stage: z.enum(["preparing", "pending", "deleted"]) }).strict();
export type DeletionRecord = z.infer<typeof recordSchema>;
export type FreshDeletionAuth = { owner: string; token: string; close(): Promise<void> };
export type DeletionApi = {
  begin(owner: string, token: string, requestId: string): Promise<unknown>;
  resume(receipt: string): Promise<unknown>;
};
type Dependencies = { store: KeyValueStore; runtime: OwnerRuntime; api: DeletionApi; uuid(): string;
  currentOwner(): string | undefined; purge(owner: string): Promise<void>; signOut(owner: string): Promise<void> };
/** Persist intent before any destructive request. Failures never mean "not deleted" or "saved". */
export class AccountDeletion {
  readonly records = new Map<string, DeletionRecord>();
  ready = false; busy = false; error = ""; completed = false;
  private revision = 0;
  private listeners = new Set<() => void>();
  constructor(private io: Dependencies) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  private emit() { this.revision++; this.listeners.forEach(l => l()); }
  async load() {
    try {
      for (const key of await this.io.store.getAllKeys()) if (key.startsWith(prefix)) {
        const raw = await this.io.store.getItem(key); if (!raw) continue;
        const value = recordSchema.parse(JSON.parse(raw));
        if (key !== prefix + value.owner) throw Error("LOCAL_STORAGE");
        this.records.set(value.owner, value); this.io.runtime.block(value.owner);
      }
      this.ready = true; this.error = "";
    } catch { this.error = "LOCAL_STORAGE"; }
    this.emit(); // Fail closed: ordinary app never mounts before local deletion state is read.
  }
  private async save(value: DeletionRecord) {
    await this.io.store.setItem(prefix + value.owner, JSON.stringify(recordSchema.parse(value)));
    this.records.set(value.owner, value); this.io.runtime.block(value.owner); this.emit();
  }
  private async serial(work: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true; this.error = ""; this.completed = false; this.emit();
    try { await work(); } catch (error) { this.error = error instanceof Error ? error.message : "OUTCOME_UNKNOWN"; }
    finally { this.busy = false; this.emit(); }
  }
  async begin(owner: string, email: string, confirmed: boolean, reauthenticate: () => Promise<FreshDeletionAuth>) {
    return this.serial(async () => {
      const before = this.io.currentOwner(), old = this.records.get(owner);
      if (!confirmed || (before !== owner && (before || !old))) throw Error("CONFIRM_REQUIRED");
      const auth = await reauthenticate();
      try {
        if (auth.owner !== owner || this.io.currentOwner() !== before) throw Error("ACCOUNT_CHANGED");
        const intent = recordSchema.parse(old ?? { owner, email, requestId: this.io.uuid(), receipt: null, stage: "preparing" });
        await this.save(intent);
        if (this.io.currentOwner() !== before) throw Error("ACCOUNT_CHANGED");
        const result = z.object({ status: z.literal("pending"), requestId: z.uuid(), receipt: z.string().min(40).max(2048) }).strict()
          .parse(await this.io.api.begin(owner, auth.token, intent.requestId));
        // A server may restore a prior request from another device for this authenticated owner.
        await this.save({ ...intent, requestId: result.requestId, receipt: result.receipt, stage: "pending" });
      } finally { await auth.close().catch(() => {}); }
    });
  }
  async resume(owner: string) {
    return this.serial(async () => {
      let record = this.records.get(owner); if (!record) throw Error("NO_DELETION");
      this.io.runtime.block(owner);
      if (record.stage !== "deleted") {
        if (!record.receipt) throw Error("REAUTHENTICATE");
        const result = z.object({ status: z.literal("deleted"), requestId: z.uuid() }).strict().parse(await this.io.api.resume(record.receipt));
        if (result.requestId !== record.requestId) throw Error("OUTCOME_UNKNOWN");
        record = { ...record, stage: "deleted" }; await this.save(record);
      }
      await this.io.runtime.idle(owner); await this.io.purge(owner);
      if (this.io.currentOwner() === owner) await this.io.signOut(owner);
      await this.io.store.removeItem(prefix + owner);
      this.records.delete(owner); this.completed = true;
    });
  }
}

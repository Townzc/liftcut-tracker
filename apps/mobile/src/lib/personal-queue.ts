import { personalCommandSchema, type PersonalCommand } from "@liftcut/core/personal-records";

export type KeyValueStore = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>; getAllKeys(): Promise<readonly string[]> };
export type PersonalStatus = "synced" | "retry" | "auth" | "conflict";
const prefix = (owner: string) => `liftcut-personal-v1:${owner}:`;

/**
 * The web's body/food/preference queue on the phone: each confirmed command is stored
 * unchanged under its own UUID, sent with the same bytes until the server acknowledges
 * it, and only then removed. A double tap or a retry is the same request; a rejected
 * one stops the queue until the user discards it.
 */
export class PersonalQueue {
  private running: Promise<PersonalStatus> | null = null;
  private rejected: string | null = null;
  private disposed = false;
  private controller = new AbortController();
  private writing: Promise<unknown> = Promise.resolve();
  constructor(readonly owner: string, private store: KeyValueStore, private post: (body: string, signal?: AbortSignal) => Promise<number>) {}
  dispose() { this.disposed = true; this.controller.abort(); }
  async whenIdle() { await Promise.allSettled([this.writing, this.running]); }
  private active() { if (this.disposed) throw Error("QUEUE_DISPOSED"); }
  private change(work: () => Promise<void>) {
    const next = this.writing.then(() => { this.active(); return work(); });
    this.writing = next.catch(() => {}); return next;
  }
  async pending(): Promise<string[]> { return (await this.store.getAllKeys()).filter(k => k.startsWith(prefix(this.owner))).sort(); }
  async submit(command: PersonalCommand) {
    return this.change(async () => {
      if (this.rejected) throw new Error("CONFLICT");
      const request = personalCommandSchema.parse(command), body = JSON.stringify(request), key = prefix(this.owner) + request.id;
      const old = await this.store.getItem(key); this.active();
      if (old !== null && old !== body) throw new Error("CONFLICT");
      if (old === null) await this.store.setItem(key, body);
    });
  }
  drain(): Promise<PersonalStatus> { return this.disposed ? Promise.resolve("auth") : this.running ??= this.run().finally(() => { this.running = null; }); }
  async discard() { return this.change(async () => { if (this.rejected) { await this.store.removeItem(this.rejected); this.rejected = null; } }); }
  private async run(): Promise<PersonalStatus> {
    if (this.rejected) return "conflict";
    for (const key of await this.pending()) {
      if (this.disposed) return "auth";
      const body = await this.store.getItem(key);
      if (this.disposed) return "auth";
      if (body === null) continue;
      let status: number;
      try { status = await this.post(body, this.controller.signal); } catch { return "retry"; }
      if (this.disposed) return "auth";
      if (status === 401) return "auth";
      if ([400, 404, 409].includes(status)) { this.rejected = key; return "conflict"; }
      if (status < 200 || status >= 300) return "retry";
      await this.change(async () => {
        const current = await this.store.getItem(key); this.active();
        if (current === body) await this.store.removeItem(key); // Only the exact acknowledged request.
      });
    }
    return "synced";
  }
}

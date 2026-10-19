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
  constructor(readonly owner: string, private store: KeyValueStore, private post: (body: string) => Promise<number>) {}
  async pending(): Promise<string[]> { return (await this.store.getAllKeys()).filter(k => k.startsWith(prefix(this.owner))).sort(); }
  async submit(command: PersonalCommand) {
    if (this.rejected) throw new Error("CONFLICT");
    const request = personalCommandSchema.parse(command), body = JSON.stringify(request), key = prefix(this.owner) + request.id;
    const old = await this.store.getItem(key);
    if (old !== null && old !== body) throw new Error("CONFLICT");
    if (old === null) await this.store.setItem(key, body);
  }
  drain(): Promise<PersonalStatus> { return this.running ??= this.run().finally(() => { this.running = null; }); }
  async discard() { if (this.rejected) { await this.store.removeItem(this.rejected); this.rejected = null; } }
  private async run(): Promise<PersonalStatus> {
    if (this.rejected) return "conflict";
    for (const key of await this.pending()) {
      const body = await this.store.getItem(key);
      if (body === null) continue;
      let status: number;
      try { status = await this.post(body); } catch { return "retry"; }
      if (status === 401) return "auth";
      if ([400, 404, 409].includes(status)) { this.rejected = key; return "conflict"; }
      if (status < 200 || status >= 300) return "retry";
      if (await this.store.getItem(key) === body) await this.store.removeItem(key); // Only the exact request the server acknowledged.
    }
    return "synced";
  }
}

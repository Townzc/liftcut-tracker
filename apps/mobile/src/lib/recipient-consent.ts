import { aiRecipientSchema, hasRecipientConsent, recipientConsentValue, type AiRecipient } from "@liftcut/core/ai-recipient";

export const recipientError = (code: string) => code === "AI_CONSENT_REQUIRED" || code === "AI_RECIPIENT_UNREVIEWED";
export function statusRecipient(value: unknown): AiRecipient | null {
  if (!value || typeof value !== "object" || !("available" in value) || value.available !== true) return null;
  const parsed = aiRecipientSchema.safeParse("recipient" in value ? value.recipient : null);
  return parsed.success ? parsed.data : null;
}
type State = { recipient: AiRecipient | null; consented: boolean; loading: boolean; failed: boolean };
type Ports = { read(): Promise<string | null>; write(value: string | null): Promise<void>; status(): Promise<unknown> };

/** One owner, one serialized consent store. A policy token never authorizes a data write. */
export class RecipientConsent {
  private value: State = { recipient: null, consented: false, loading: true, failed: false };
  private saved: string | null = null;
  private refused: string | null = null;
  private generation = 0;
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  constructor(private ports: Ports) {}
  snapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(value: State) { this.value = value; for (const fn of this.listeners) fn(); }
  async refresh() {
    const generation = ++this.generation;
    this.publish({ ...this.value, loading: true, consented: false });
    try {
      await this.writes;
      const [saved, status] = await Promise.all([this.ports.read(), this.ports.status()]);
      if (generation !== this.generation) return;
      const recipient = statusRecipient(status); this.saved = saved;
      this.publish({ recipient, consented: saved !== this.refused && hasRecipientConsent(saved, recipient), loading: false, failed: !recipient });
    } catch {
      if (generation === this.generation) this.publish({ recipient: null, consented: false, loading: false, failed: true });
    }
  }
  async change(on: boolean) {
    const recipient = this.value.recipient;
    if (on && (!recipient || this.value.loading)) return;
    const generation = ++this.generation, saved = on ? recipientConsentValue(recipient!) : null;
    if (!on) this.refused = this.saved ?? (recipient ? recipientConsentValue(recipient) : null);
    this.saved = null;
    this.publish({ ...this.value, consented: false, loading: true, failed: false });
    const work = this.writes.catch(() => {}).then(() => this.ports.write(saved));
    this.writes = work.catch(() => {});
    try {
      await work;
      if (generation !== this.generation) return;
      this.saved = saved;
      if (on) this.refused = null;
      this.publish({ ...this.value, consented: hasRecipientConsent(saved, recipient), loading: false });
    } catch {
      if (generation === this.generation) this.publish({ ...this.value, consented: false, loading: false, failed: true });
    }
  }
  token() {
    return !this.value.loading && hasRecipientConsent(this.saved, this.value.recipient) && this.value.consented
      ? this.value.recipient!.id : null;
  }
  async invalidate() { await this.change(false); await this.refresh(); }
}

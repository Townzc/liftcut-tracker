import { MOBILE_EMAIL_APP_CALLBACK, MOBILE_EMAIL_CALLBACK_PATH, MOBILE_SIGNUP_TTL_MS, emailSignupStorageKey,
  newEmailSignup, parseMobileEmailParams, prepareEmailSignupExchange, readPendingEmailSignup, requireSignupIdentity,
  type PendingEmailSignup } from "@liftcut/core/mobile-email-auth";
import type { EmailStorage, SignupAuthFactory, SignupAuthPort } from "./email-signup-client";

export const PENDING_EMAIL_SIGNUP = "liftcut-pending-email-signup-v1";
type Options = { storage: EmailStorage; auth: SignupAuthFactory; owner(): Promise<string | null>; uuid(): string;
  now?: () => number; redirectOrigin?: string };

/** Verifies registration, then asks for ordinary password login. Never installs a main session. */
export class EmailSignupController {
  private epoch = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private flows: Promise<unknown> = Promise.resolve();
  private active?: SignupAuthPort;
  private verification?: { url: string; promise: Promise<string> };
  private now: () => number;
  private origin: string;
  constructor(private options: Options) {
    this.now = options.now ?? Date.now;
    this.origin = options.redirectOrigin ?? "https://www.liftcuttracker.com";
    if (!["https://www.liftcuttracker.com", "https://liftcuttracker.com", "http://127.0.0.1:3110"].includes(this.origin)) throw new Error("signup_redirect_rejected");
  }
  private store<T>(fn: () => Promise<T>): Promise<T> { const next = this.writes.then(fn, fn); this.writes = next.catch(() => undefined); return next; }
  private flow<T>(fn: () => Promise<T>): Promise<T> { const next = this.flows.then(fn, fn); this.flows = next.catch(() => undefined); return next; }
  private async guard(epoch: number, pending?: PendingEmailSignup) {
    if (epoch !== this.epoch || await this.options.owner() !== null || epoch !== this.epoch) throw new Error("signup_cancelled_or_account_changed");
    if (pending && (this.now() < pending.createdAt || this.now() - pending.createdAt >= MOBILE_SIGNUP_TTL_MS)) throw new Error("signup_expired");
  }
  private async read() {
    const raw = await this.options.storage.getItem(PENDING_EMAIL_SIGNUP);
    try { return readPendingEmailSignup(raw ? JSON.parse(raw) : null); } catch { return null; }
  }
  private async clear(attempt?: string) {
    const pending = await this.read();
    if (attempt && pending?.attempt !== attempt) return;
    if (pending) await this.options.storage.removeItem(`${emailSignupStorageKey(pending.attempt)}-code-verifier`);
    await this.options.storage.removeItem(PENDING_EMAIL_SIGNUP);
  }
  private save(pending: PendingEmailSignup, epoch: number) {
    return this.store(async () => {
      if (epoch !== this.epoch) throw new Error("signup_cancelled");
      await this.options.storage.setItem(PENDING_EMAIL_SIGNUP, JSON.stringify(pending));
    });
  }
  private port(attempt: string, epoch: number) {
    const key = emailSignupStorageKey(attempt), verifier = `${key}-code-verifier`, memory = new Map<string, string>();
    // Persist the verifier only; temporary confirmation-session tokens stay in memory.
    const port = this.options.auth(key, {
      getItem: async name => name === verifier ? this.store(() => this.options.storage.getItem(name)) : memory.get(name) ?? null,
      setItem: async (name, value) => { if (name === verifier) await this.store(async () => {
        if (epoch !== this.epoch) throw new Error("signup_cancelled"); await this.options.storage.setItem(name, value);
      }); else memory.set(name, value); },
      removeItem: async name => { if (name === verifier) await this.store(() => this.options.storage.removeItem(name)); else memory.delete(name); },
    });
    this.active = port;
    return { port, close: async () => { try { await port.close(); } finally { memory.clear(); if (this.active === port) this.active = undefined; } } };
  }
  async pending(): Promise<PendingEmailSignup | null> {
    if (await this.options.owner() !== null) { await this.cancel(); return null; }
    return this.store(async () => {
      const value = await this.read(), age = value ? this.now() - value.createdAt : -1;
      if (value?.phase === "waiting" && age >= 0 && age < MOBILE_SIGNUP_TTL_MS) return value;
      if (!this.active) await this.clear();
      return null;
    });
  }
  cancel(): Promise<void> {
    this.epoch++; this.active?.cancel();
    // Separate storage queue: cancellation does not wait for a slow network exchange.
    return this.store(() => this.clear());
  }
  start(email: string, password: string, lang: "zh-CN" | "en") {
    const epoch = this.epoch;
    return this.flow(async () => {
      await this.guard(epoch);
      if (await this.pending()) throw new Error("signup_already_pending");
      const pending = newEmailSignup(email, this.options.uuid(), this.now());
      let client: ReturnType<EmailSignupController["port"]> | undefined;
      try {
        await this.save(pending, epoch); await this.guard(epoch, pending);
        client = this.port(pending.attempt, epoch);
        await client.port.send(pending.email, password, `${this.origin}${MOBILE_EMAIL_CALLBACK_PATH}?attempt=${pending.attempt}&lang=${lang}`);
        await this.guard(epoch, pending);
        if (!await this.store(() => this.options.storage.getItem(`${emailSignupStorageKey(pending.attempt)}-code-verifier`))) throw new Error("signup_verifier_missing");
        await client.close(); client = undefined; await this.guard(epoch, pending);
      } catch (error) { await this.store(() => this.clear(pending.attempt)); throw error; }
      finally { await client?.close(); }
      return pending;
    });
  }
  verify(url: string): Promise<string> {
    if (this.verification?.url === url) return this.verification.promise;
    const epoch = this.epoch;
    const promise = this.flow(async () => {
      await this.guard(epoch);
      const parsed = new URL(url);
      if (`${parsed.protocol}//${parsed.host}${parsed.pathname}` !== MOBILE_EMAIL_APP_CALLBACK || parsed.username || parsed.password || parsed.hash) throw new Error("signup_callback_rejected");
      const callback = parseMobileEmailParams([...parsed.searchParams]); if (!callback) throw new Error("signup_callback_rejected");
      const pending = await this.store(() => this.read());
      const exchange = prepareEmailSignupExchange(pending, callback, null, this.now());
      let client: ReturnType<EmailSignupController["port"]> | undefined;
      let verified: PendingEmailSignup;
      try {
        await this.save(exchange.next, epoch); await this.guard(epoch, exchange.next);
        client = this.port(exchange.next.attempt, epoch);
        if (!await this.store(() => this.options.storage.getItem(`${exchange.storageKey}-code-verifier`))) throw new Error("signup_verifier_missing");
        const identity = await client.port.verify(exchange.code); await this.guard(epoch, exchange.next);
        verified = requireSignupIdentity(exchange.next, identity);
      } finally { try { await client?.close(); } finally { await this.store(() => this.clear(exchange.next.attempt)); } }
      await this.guard(epoch, exchange.next);
      return verified.email;
    });
    this.verification = { url, promise };
    void promise.finally(() => { if (this.verification?.promise === promise) this.verification = undefined; }).catch(() => undefined);
    return promise;
  }
}

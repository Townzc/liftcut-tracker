const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("");
type Digest = (value: string) => Promise<string>;

/** Exercise the runtime, not just method names. This cannot certify an RNG's entropy. */
export async function requireSignupCrypto(): Promise<Digest> {
  try {
    const crypto = globalThis.crypto;
    if (typeof crypto?.getRandomValues !== "function" || typeof crypto?.subtle?.digest !== "function" || typeof TextEncoder === "undefined"
      || typeof btoa !== "function" || typeof atob !== "function" || btoa("abc") !== "YWJj" || atob("YWJj") !== "abc") throw new Error();
    const first = new Uint8Array(32), second = new Uint8Array(32), encoder = new TextEncoder();
    if (crypto.getRandomValues(first) !== first || crypto.getRandomValues(second) !== second
      || !first.some(value => value !== 0) || first.every((value, index) => value === second[index])
      || Array.from(encoder.encode("abc")).join(",") !== "97,98,99") throw new Error();
    const digest: Digest = async value => {
      const result = await crypto.subtle.digest("SHA-256", encoder.encode(value));
      if (!(result instanceof ArrayBuffer) || result.byteLength !== 32) throw new Error("signup_secure_crypto_unavailable");
      return hex(result);
    };
    if (await digest("abc") !== SHA256_ABC) throw new Error();
    return digest;
  } catch { throw new Error("signup_secure_crypto_unavailable"); }
}

/** Check the actual SDK request against its persisted verifier before network I/O. */
export async function requireSignupS256(body: unknown, stored: string | null, digest: Digest) {
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : null;
    const verifier: unknown = stored ? JSON.parse(stored) : null;
    if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
      || parsed?.code_challenge_method !== "s256" || !/^[A-Za-z0-9_-]{43}$/.test(parsed?.code_challenge)) throw new Error();
    // Decode only a validated public challenge; no verifier or credential is logged.
    const bytes = Uint8Array.from(atob(parsed.code_challenge.replace(/-/g, "+").replace(/_/g, "/") + "="), value => value.charCodeAt(0));
    if (hex(bytes.buffer) !== await digest(verifier)) throw new Error();
  } catch { throw new Error("signup_pkce_rejected"); }
}

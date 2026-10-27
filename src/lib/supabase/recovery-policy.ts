// Only call this with claims already verified by Supabase Auth, never decoded URL data.
export function isRecentRecovery(claims: Record<string, unknown>, now = Date.now() / 1000): boolean {
  return claims.role === "authenticated" && typeof claims.sub === "string" && !!claims.sub &&
    typeof claims.session_id === "string" && !!claims.session_id &&
    Array.isArray(claims.amr) && claims.amr.some(entry => entry?.method === "recovery" &&
      typeof entry.timestamp === "number" && entry.timestamp <= now + 60 && entry.timestamp >= now - 900);
}

export function safeAuthRedirect(value: string | null): string {
  if (!value) return "/onboarding";
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\s?#\u0000-\u001f]/.test(decoded)) return "/onboarding";
    return new URL(value, "https://liftcut.invalid").pathname;
  } catch { return "/onboarding"; }
}

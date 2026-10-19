/** A Supabase access token from `Authorization: Bearer <jwt>`; null when absent or malformed. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(header ?? "");
  return match ? match[1] : null;
}

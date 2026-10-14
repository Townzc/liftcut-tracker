// This header is a fail-closed account-switch guard, never an authorization
// credential. The caller must first obtain the real user with requireApiUser.
export function workoutOwnerMismatch(request: Request, authenticatedUserId: string) {
  const expected = request.headers.get("X-Workout-Owner");
  return expected !== null && expected !== authenticatedUserId
    ? Response.json({ error:"ACCOUNT_CHANGED" }, { status:409, headers:{"Cache-Control":"no-store"} }) : null;
}

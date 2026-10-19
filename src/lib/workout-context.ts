import type { Session } from "@liftcut/core/today";
import { workoutCanonical, workoutContextInput } from "@liftcut/core/workout-context";

// Web Crypto stays on the web side: React Native has no crypto.subtle.
export async function localContextHash(session: Session) {
  const bytes = new TextEncoder().encode(workoutCanonical(workoutContextInput(session)));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2,"0")).join("");
}

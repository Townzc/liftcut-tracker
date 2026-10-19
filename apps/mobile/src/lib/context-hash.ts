import type { Session } from "@liftcut/core/today";
import { workoutCanonical, workoutContextInput } from "@liftcut/core/workout-context";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";

/** The same SHA-256 of the same canonical form as the web; the server re-checks it before committing a sentence. */
export async function contextHash(session: Session) {
  return (await digestStringAsync(CryptoDigestAlgorithm.SHA256, workoutCanonical(workoutContextInput(session)))).toLowerCase();
}

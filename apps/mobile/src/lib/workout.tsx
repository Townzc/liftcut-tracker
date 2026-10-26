import AsyncStorage from "@react-native-async-storage/async-storage";
import type { OutboxState } from "@liftcut/core/workout-outbox";
import { createContext, use, useMemo, useState, type PropsWithChildren } from "react";
import { accountAuth, apiBase, apiHeaders } from "./api";
import { MobileOutbox } from "./outbox";
import { outboxApi } from "./outbox-api";
import { outboxStore } from "./outbox-store";
import { PersonalQueue } from "./personal-queue";
import { useSession } from "./session";

const Workout = createContext<{ outbox: MobileOutbox | null; state: OutboxState | null; personal: PersonalQueue | null } | null>(null);

/**
 * The account's write queues, shared by every screen: workout operations in SQLite and
 * confirmed body/food entries in app storage. Both survive restarts and never mix accounts.
 */
export function WorkoutProvider({ children }: PropsWithChildren) {
  const { session: auth, getAuth } = useSession();
  const owner = auth?.user.id, [state, setState] = useState<OutboxState | null>(null);
  const credentials = useMemo(() => accountAuth(owner, getAuth), [owner, getAuth]);
  const outbox = useMemo(() => owner ? new MobileOutbox(owner, outboxStore, outboxApi(credentials), setState) : null, [owner, credentials]);
  const personal = useMemo(() => owner ? new PersonalQueue(owner, AsyncStorage, async body => {
    const auth = credentials();
    return auth ? (await fetch(`${apiBase}/api/personal-records`, { method: "POST", headers: apiHeaders(auth, true), body })).status : 401;
  }) : null, [owner, credentials]);
  const value = useMemo(() => ({ outbox, state: state?.owner === owner ? state : null, personal }), [outbox, state, owner, personal]);
  return <Workout.Provider value={value}>{children}</Workout.Provider>;
}
export function useWorkout() {
  const value = use(Workout);
  if (!value) throw new Error("useWorkout must be used inside WorkoutProvider");
  return value;
}

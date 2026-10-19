import AsyncStorage from "@react-native-async-storage/async-storage";
import type { OutboxState } from "@liftcut/core/workout-outbox";
import { createContext, use, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { apiBase, apiHeaders } from "./api";
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
  const { session: auth } = useSession(), authRef = useRef(auth); authRef.current = auth;
  const owner = auth?.user.id, [state, setState] = useState<OutboxState | null>(null);
  const outbox = useMemo(() => owner ? new MobileOutbox(owner, outboxStore, outboxApi(() => authRef.current), setState) : null, [owner]);
  const personal = useMemo(() => owner ? new PersonalQueue(owner, AsyncStorage, async body => {
    const auth = authRef.current;
    return auth ? (await fetch(`${apiBase}/api/personal-records`, { method: "POST", headers: apiHeaders(auth, true), body })).status : 401;
  }) : null, [owner]);
  const value = useMemo(() => ({ outbox, state: state?.owner === owner ? state : null, personal }), [outbox, state, owner, personal]);
  return <Workout.Provider value={value}>{children}</Workout.Provider>;
}
export function useWorkout() {
  const value = use(Workout);
  if (!value) throw new Error("useWorkout must be used inside WorkoutProvider");
  return value;
}

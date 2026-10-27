import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { createContext, use, useEffect, useState, useSyncExternalStore, type PropsWithChildren } from "react";
import { AccountDeletion } from "./account-deletion";
import { deletionApi } from "./deletion-api";
import { ownerRuntime } from "./owner-runtime";
import { removeOwnerData } from "./owner-cleanup";
import { outboxStore } from "./outbox-store";
import { useSession } from "./session";
import { supabase } from "./supabase";

const Context = createContext<AccountDeletion | null>(null);
export function DeletionProvider({ children }: PropsWithChildren) {
  const { getAuth } = useSession();
  const [client] = useState(() => new AccountDeletion({ store: AsyncStorage, runtime: ownerRuntime, uuid: randomUUID,
    api: deletionApi(), currentOwner: () => getAuth()?.user.id,
    purge: owner => removeOwnerData(owner, { outboxStore, storage: AsyncStorage }),
    signOut: async owner => { if (getAuth()?.user.id === owner) {
      const result = await supabase?.auth.signOut({ scope: "local" }); if (result?.error) throw Error("LOCAL_SIGNOUT");
    } },
  }));
  useEffect(() => { void client.load(); }, [client]);
  return <Context.Provider value={client}>{children}</Context.Provider>;
}
export function useDeletion() {
  const value = use(Context); if (!value) throw Error("DeletionProvider required");
  useSyncExternalStore(value.subscribe, value.snapshot, value.snapshot); return value;
}

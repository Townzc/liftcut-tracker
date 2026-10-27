import type { DeletionRecord } from "./account-deletion";

/** The server gate does not certify a native build. Prior intent must come from
 * AccountDeletion's validated storage, never route parameters. Recovery retains
 * the controller's confirmation, fresh-owner authentication and receipt checks. */
export function mobileDeletionAccess(available: boolean, record?: DeletionRecord, currentOwner?: string,
  buildFlag = process.env.EXPO_PUBLIC_MOBILE_ACCOUNT_DELETION) {
  if (record && currentOwner && record.owner !== currentOwner) return { showEntry: false, canBegin: false };
  const recover = !!record && (!currentOwner || record.owner === currentOwner);
  return {
    showEntry: recover || (available && buildFlag === "true"),
    canBegin: available && record?.stage !== "deleted" && (recover || buildFlag === "true"),
  };
}

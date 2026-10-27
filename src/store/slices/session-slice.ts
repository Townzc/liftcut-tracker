"use client";

import type { StateCreator } from "zustand";
import type { TrackerState } from "../use-tracker-store";
import type { AuthMode } from "@liftcut/core/types";
import { GUEST_USER_ID, isGuestMode, resolveUserId } from "../utils";
import {ownerLifecycle} from "@/lib/owner-lifecycle";

export type SessionSlice = Pick<
  TrackerState,
  "userId" | "authMode" | "hydrated" | "loading" | "error" | "setAuthMode" | "ensureUserId" | "markHydrated"
>;

export const createSessionSlice: StateCreator<TrackerState, [], [], SessionSlice> = (set, get) => ({
  userId: null,
  authMode: "none" as AuthMode,
  hydrated: false,
  loading: false,
  error: null,
  setAuthMode: (mode) => set({ authMode: mode }),
  ensureUserId: async () => {
    if (isGuestMode(get())) {
      return GUEST_USER_ID;
    }

    const currentUserId = get().userId;
    if(currentUserId)ownerLifecycle.assertActive(currentUserId);
    const resolvedUserId = await resolveUserId(currentUserId);
    ownerLifecycle.assertActive(resolvedUserId);
    if(get().userId!==currentUserId)throw Error("ACCOUNT_CHANGED");

    if (!currentUserId || currentUserId !== resolvedUserId) {
      set((state) => ({
        userId: resolvedUserId,
        settings: {
          ...state.settings,
          userId: resolvedUserId,
        },
      }));
    }

    return resolvedUserId;
  },
  markHydrated: () => set({ hydrated: true }),
});

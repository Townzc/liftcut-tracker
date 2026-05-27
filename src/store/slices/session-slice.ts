"use client";

import type { StateCreator } from "zustand";
import type { TrackerState } from "../use-tracker-store";
import type { AuthMode } from "@/types";
import { GUEST_USER_ID, isGuestMode, resolveUserId } from "../utils";

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
    const resolvedUserId = await resolveUserId(currentUserId);

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

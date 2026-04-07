"use client";

import type { User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createAuthRequiredError } from "@/lib/error-utils";
import {
  clearGuestSessionArtifacts,
  getGuestAiHistory,
  hasGuestAiHistory,
  isGuestModeEnabled,
  setGuestModeEnabled,
} from "@/lib/guest-mode";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  ensureUserBootstrap,
  ensureUserProfile,
  updateUserPreferredLanguage,
  updateUserProfile,
} from "@/services/data-repository";
import { migrateGuestDataToUser } from "@/services/guest-migration";
import { useTrackerStore } from "@/store/use-tracker-store";
import { useUIStore } from "@/store/use-ui-store";
import type { AppLocale, AuthMode, UserProfile } from "@/types";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authMode: AuthMode;
  pendingGuestMigration: boolean;
  signOut: () => Promise<void>;
  startGuestMode: () => Promise<void>;
  exitGuestMode: () => Promise<void>;
  migrateGuestData: () => Promise<void>;
  dismissGuestMigration: () => void;
  setPreferredLanguage: (locale: AppLocale) => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: { displayName?: string | null; avatarUrl?: string | null }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initializeForUser = useTrackerStore((state) => state.initializeForUser);
  const initializeGuestSession = useTrackerStore((state) => state.initializeGuestSession);
  const clearUserData = useTrackerStore((state) => state.clearUserData);
  const clearGuestData = useTrackerStore((state) => state.clearGuestData);
  const getGuestSnapshot = useTrackerStore((state) => state.getGuestSnapshot);
  const hasGuestData = useTrackerStore((state) => state.hasGuestData);
  const setTrackerAuthMode = useTrackerStore((state) => state.setAuthMode);
  const setLanguage = useUIStore((state) => state.setLanguage);

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("none");
  const [pendingGuestMigration, setPendingGuestMigration] = useState(false);
  const activeUserIdRef = useRef<string | null>(null);
  const bootstrappingUserRef = useRef<string | null>(null);

  const updatePendingGuestMigration = useCallback(() => {
    const shouldMigrate = hasGuestData() || hasGuestAiHistory();
    setPendingGuestMigration(shouldMigrate);
  }, [hasGuestData]);

  const bootstrapUser = useCallback(
    async (nextUser: User) => {
      if (bootstrappingUserRef.current === nextUser.id) {
        return;
      }

      bootstrappingUserRef.current = nextUser.id;
      setLoading(true);
      setAuthMode("authenticated");
      setTrackerAuthMode("authenticated");

      try {
        const email = nextUser.email ?? "";
        const nextProfile = await ensureUserBootstrap(nextUser.id, email);
        setProfile(nextProfile);
        setLanguage(nextProfile.preferredLanguage);
      } catch (error) {
        console.error(error);
        setProfile((current) => {
          if (current) {
            return current;
          }

          return {
            id: nextUser.id,
            email: nextUser.email ?? "",
            displayName: (nextUser.email ?? "").split("@")[0] || "User",
            avatarUrl: undefined,
            preferredLanguage: useUIStore.getState().language,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        });
      } finally {
        try {
          await initializeForUser(nextUser.id);
          activeUserIdRef.current = nextUser.id;
        } catch (initializeError) {
          console.error(initializeError);
          activeUserIdRef.current = nextUser.id;
        } finally {
          bootstrappingUserRef.current = null;
          setLoading(false);
          updatePendingGuestMigration();
        }
      }
    },
    [initializeForUser, setLanguage, setTrackerAuthMode, updatePendingGuestMigration],
  );

  const enterGuestSession = useCallback(async () => {
    setLoading(true);
    setUser(null);
    setProfile(null);
    setAuthMode("guest");
    setTrackerAuthMode("guest");
    setPendingGuestMigration(false);

    try {
      await initializeGuestSession();
    } finally {
      activeUserIdRef.current = null;
      setLoading(false);
    }
  }, [initializeGuestSession, setTrackerAuthMode]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    const run = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const sessionUser = session?.user ?? null;
        setUser(sessionUser);

        if (sessionUser) {
          await bootstrapUser(sessionUser);
          return;
        }

        if (isGuestModeEnabled()) {
          await enterGuestSession();
          return;
        }

        setProfile(null);
        clearUserData();
        setAuthMode("none");
        setTrackerAuthMode("none");
        activeUserIdRef.current = null;
        setPendingGuestMigration(false);
        setLoading(false);
      } catch (error) {
        console.error(error);
        setUser(null);
        setProfile(null);
        clearUserData();
        setAuthMode("none");
        setTrackerAuthMode("none");
        activeUserIdRef.current = null;
        setPendingGuestMigration(false);
        setLoading(false);
      }
    };

    void run();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ?? null;
      setUser(sessionUser);

      if (!sessionUser) {
        if (isGuestModeEnabled()) {
          void enterGuestSession();
          return;
        }

        setProfile(null);
        clearUserData();
        setAuthMode("none");
        setTrackerAuthMode("none");
        activeUserIdRef.current = null;
        setPendingGuestMigration(false);
        setLoading(false);
        return;
      }

      if (activeUserIdRef.current === sessionUser.id) {
        return;
      }

      void bootstrapUser(sessionUser);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [bootstrapUser, clearUserData, enterGuestSession, setTrackerAuthMode]);

  const startGuestMode = useCallback(async () => {
    setGuestModeEnabled(true);
    await enterGuestSession();
  }, [enterGuestSession]);

  const exitGuestMode = useCallback(async () => {
    setGuestModeEnabled(false);
    clearUserData();
    setProfile(null);
    setUser(null);
    setAuthMode("none");
    setTrackerAuthMode("none");
    activeUserIdRef.current = null;
    setPendingGuestMigration(false);
  }, [clearUserData, setTrackerAuthMode]);

  const signOut = useCallback(async () => {
    if (authMode === "guest") {
      await exitGuestMode();
      return;
    }

    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    clearUserData();
    setProfile(null);
    setUser(null);
    setAuthMode("none");
    setTrackerAuthMode("none");
    activeUserIdRef.current = null;
    bootstrappingUserRef.current = null;
    setPendingGuestMigration(false);
  }, [authMode, clearUserData, exitGuestMode, setTrackerAuthMode]);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      throw createAuthRequiredError();
    }

    const nextProfile = await ensureUserProfile(
      user.id,
      user.email ?? "",
      profile?.preferredLanguage ?? useUIStore.getState().language,
    );

    setProfile(nextProfile);
  }, [profile?.preferredLanguage, user]);

  const updateProfilePatch = useCallback(
    async (patch: { displayName?: string | null; avatarUrl?: string | null }) => {
      if (!user) {
        throw createAuthRequiredError();
      }

      await updateUserProfile(user.id, patch);
      await refreshProfile();
    },
    [refreshProfile, user],
  );

  const setPreferredLanguage = useCallback(
    async (locale: AppLocale) => {
      if (authMode === "guest") {
        setLanguage(locale);
        return;
      }

      if (!user) {
        throw createAuthRequiredError();
      }

      await updateUserPreferredLanguage(user.id, locale);
      setLanguage(locale);
      setProfile((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          preferredLanguage: locale,
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [authMode, setLanguage, user],
  );

  const migrateGuestData = useCallback(async () => {
    if (!user) {
      throw createAuthRequiredError();
    }

    const guestSnapshot = getGuestSnapshot();
    if (!guestSnapshot) {
      setPendingGuestMigration(false);
      return;
    }

    setLoading(true);
    try {
      const guestAiHistory = getGuestAiHistory();
      await migrateGuestDataToUser({
        userId: user.id,
        guestSnapshot,
        guestAiHistory,
      });

      clearGuestData();
      clearGuestSessionArtifacts();
      setPendingGuestMigration(false);
      await initializeForUser(user.id);
    } finally {
      setLoading(false);
    }
  }, [clearGuestData, getGuestSnapshot, initializeForUser, user]);

  const dismissGuestMigration = useCallback(() => {
    setPendingGuestMigration(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      authMode,
      pendingGuestMigration,
      signOut,
      startGuestMode,
      exitGuestMode,
      migrateGuestData,
      dismissGuestMigration,
      setPreferredLanguage,
      refreshProfile,
      updateProfile: updateProfilePatch,
    }),
    [
      authMode,
      dismissGuestMigration,
      loading,
      migrateGuestData,
      pendingGuestMigration,
      profile,
      refreshProfile,
      setPreferredLanguage,
      signOut,
      startGuestMode,
      exitGuestMode,
      updateProfilePatch,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}

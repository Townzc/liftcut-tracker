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
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  ensureUserBootstrap,
  ensureUserProfile,
  updateUserProfile,
  updateUserPreferredLanguage,
} from "@/services/data-repository";
import { useTrackerStore } from "@/store/use-tracker-store";
import { useUIStore } from "@/store/use-ui-store";
import type { AppLocale, UserProfile } from "@/types";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  setPreferredLanguage: (locale: AppLocale) => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: { displayName?: string | null; avatarUrl?: string | null }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initializeForUser = useTrackerStore((state) => state.initializeForUser);
  const clearUserData = useTrackerStore((state) => state.clearUserData);
  const setLanguage = useUIStore((state) => state.setLanguage);

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const activeUserIdRef = useRef<string | null>(null);
  const bootstrappingUserRef = useRef<string | null>(null);

  const bootstrapUser = useCallback(
    async (nextUser: User) => {
      if (bootstrappingUserRef.current === nextUser.id) {
        return;
      }

      bootstrappingUserRef.current = nextUser.id;
      setLoading(true);

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
        }
      }
    },
    [initializeForUser, setLanguage],
  );

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
        } else {
          setProfile(null);
          clearUserData();
          activeUserIdRef.current = null;
          setLoading(false);
        }
      } catch (error) {
        console.error(error);
        setUser(null);
        setProfile(null);
        clearUserData();
        activeUserIdRef.current = null;
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
        setProfile(null);
        clearUserData();
        activeUserIdRef.current = null;
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
  }, [bootstrapUser, clearUserData]);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    clearUserData();
    setProfile(null);
    setUser(null);
    activeUserIdRef.current = null;
    bootstrappingUserRef.current = null;
  }, [clearUserData]);

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
    [setLanguage, user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      signOut,
      setPreferredLanguage,
      refreshProfile,
      updateProfile: updateProfilePatch,
    }),
    [loading, profile, refreshProfile, setPreferredLanguage, signOut, updateProfilePatch, user],
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

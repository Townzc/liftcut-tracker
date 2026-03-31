"use client";

import type { User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  ensureUserBootstrap,
  ensureUserProfile,
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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initializeForUser = useTrackerStore((state) => state.initializeForUser);
  const clearUserData = useTrackerStore((state) => state.clearUserData);
  const setLanguage = useUIStore((state) => state.setLanguage);

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const bootstrapUser = useCallback(
    async (nextUser: User) => {
      try {
        const email = nextUser.email ?? "";
        await ensureUserBootstrap(nextUser.id, email);
        const nextProfile = await ensureUserProfile(nextUser.id, email);
        setProfile(nextProfile);
        setLanguage(nextProfile.preferredLanguage);
        await initializeForUser(nextUser.id);
      } catch (error) {
        console.error(error);
        setProfile(null);
        clearUserData();
      }
    },
    [clearUserData, initializeForUser, setLanguage],
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
        }
      } catch (error) {
        console.error(error);
        setUser(null);
        setProfile(null);
        clearUserData();
      } finally {
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
  }, [clearUserData]);

  const setPreferredLanguage = useCallback(
    async (locale: AppLocale) => {
      if (!user) {
        return;
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
    }),
    [loading, profile, setPreferredLanguage, signOut, user],
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
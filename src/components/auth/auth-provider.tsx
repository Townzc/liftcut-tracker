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
import { migrateGuestFactsToUser,hasGuestFacts,remainingGuestSnapshot } from "@/services/guest-fact-migration";
import {GUEST_RECORD_EVENT} from "@/lib/guest-records";
import { useTrackerStore } from "@/store/use-tracker-store";
import { useUIStore } from "@/store/use-ui-store";
import type { AppLocale, AuthMode, UserProfile } from "@liftcut/core/types";
import {ownerLifecycle} from "@/lib/owner-lifecycle";

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
  const getGuestSnapshot = useTrackerStore((state) => state.getGuestSnapshot);
  const setTrackerAuthMode = useTrackerStore((state) => state.setAuthMode);
  const setLanguage = useUIStore((state) => state.setLanguage);

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("none");
  const [pendingGuestMigration, setPendingGuestMigration] = useState(false);
  const activeUserIdRef = useRef<string | null>(null);
  const bootstrappingUserRef = useRef<string | null>(null);
  const identity=useRef<string|null>(null);
  useEffect(()=>user?ownerLifecycle.register(user.id,()=>{
    if(useTrackerStore.getState().userId===user.id)clearUserData();
    if(identity.current===user.id){setProfile(null);setLoading(false);}
  }):undefined,[user,clearUserData]);

  const updatePendingGuestMigration = useCallback(() => {
    try{setPendingGuestMigration(hasGuestFacts(getGuestSnapshot()));}
    catch{setPendingGuestMigration(true);} // An unreadable local ledger must not block account login.
  }, [getGuestSnapshot]);
  useEffect(()=>{
    if(!user)return;
    window.addEventListener(GUEST_RECORD_EVENT,updatePendingGuestMigration);window.addEventListener("storage",updatePendingGuestMigration);
    return()=>{window.removeEventListener(GUEST_RECORD_EVENT,updatePendingGuestMigration);window.removeEventListener("storage",updatePendingGuestMigration);};
  },[user,updatePendingGuestMigration]);

  const bootstrapUser = useCallback(
    async (nextUser: User) => {
      // These forms finish sign-in with a full navigation. Let the destination
      // bootstrap once instead of starting reads that this document will abort.
      // Public help and privacy need no profile bootstrap or account writes.
      if (["/login", "/register", "/support", "/privacy", "/forgot-password", "/reset-password", "/delete-account"].includes(window.location.pathname) || !ownerLifecycle.active(nextUser.id)) {
        setLoading(false);
        return;
      }
      if (bootstrappingUserRef.current === nextUser.id) {
        return;
      }

      bootstrappingUserRef.current = nextUser.id;
      setLoading(true);
      setAuthMode("authenticated");
      setTrackerAuthMode("authenticated");

      try {
        const email = nextUser.email ?? "";
        const nextProfile = await ownerLifecycle.run(nextUser.id,()=>ensureUserBootstrap(nextUser.id, email));
        if(identity.current!==nextUser.id||!ownerLifecycle.active(nextUser.id))return;
        setProfile(nextProfile);
        setLanguage(nextProfile.preferredLanguage);
      } catch (error) {
        console.error(error);
        setProfile((current) => {
          if(identity.current!==nextUser.id||!ownerLifecycle.active(nextUser.id))return current;
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
          if(identity.current===nextUser.id&&ownerLifecycle.active(nextUser.id)){
            await initializeForUser(nextUser.id);
            if(identity.current===nextUser.id&&ownerLifecycle.active(nextUser.id))activeUserIdRef.current = nextUser.id;
          }
        } catch (initializeError) {
          console.error(initializeError);
          if(identity.current===nextUser.id&&ownerLifecycle.active(nextUser.id))activeUserIdRef.current = nextUser.id;
        } finally {
          bootstrappingUserRef.current = null;
          if(identity.current===nextUser.id)setLoading(false);
          updatePendingGuestMigration();
        }
      }
    },
    [initializeForUser, setLanguage, setTrackerAuthMode, updatePendingGuestMigration],
  );

  const enterGuestSession = useCallback(async () => {
    identity.current=null;
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
        identity.current=sessionUser?.id??null;
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
      identity.current=sessionUser?.id??null;
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
    identity.current=null;
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
    identity.current=null;
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

    const nextProfile = await ownerLifecycle.run(user.id,()=>ensureUserProfile(
      user.id,
      user.email ?? "",
      profile?.preferredLanguage ?? useUIStore.getState().language,
    ));

    if(identity.current===user.id&&ownerLifecycle.active(user.id))setProfile(nextProfile);
  }, [profile?.preferredLanguage, user]);

  const updateProfilePatch = useCallback(
    async (patch: { displayName?: string | null; avatarUrl?: string | null }) => {
      if (!user) {
        throw createAuthRequiredError();
      }

      await ownerLifecycle.run(user.id,()=>updateUserProfile(user.id, patch));
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

      await ownerLifecycle.run(user.id,()=>updateUserPreferredLanguage(user.id, locale));
      if(identity.current!==user.id||!ownerLifecycle.active(user.id))return;
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
    setLoading(true);
    try {
      await ownerLifecycle.run(user.id,()=>migrateGuestFactsToUser({
        userId: user.id,
        guestSnapshot,
      }));
      if(identity.current!==user.id||!ownerLifecycle.active(user.id))return;
      useTrackerStore.setState(state=>({guestSnapshot:remainingGuestSnapshot(state.guestSnapshot)}));
      updatePendingGuestMigration();
      await initializeForUser(user.id);
    } finally {
      setLoading(false);
    }
  }, [getGuestSnapshot, initializeForUser, user,updatePendingGuestMigration]);

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

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import posthog from "posthog-js";
import { supabase } from "@/lib/supabase";
import { clearApiCaches, setAuthFailureHandler } from "@/app/lib/api";

interface AuthCtx {
  session: Session | null;
  user: User | null;
  /** True until the first getSession() resolves. */
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(Ctx);
}

function identifyUser(user: User) {
  const name =
    typeof user.user_metadata.full_name === "string"
      ? user.user_metadata.full_name
      : undefined;

  posthog.identify(user.id, {
    ...(user.email ? { email: user.email } : {}),
    ...(name ? { name } : {}),
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const lastUserId = useRef<string | null>(null);

  const syncAnalyticsIdentity = useCallback((nextUser: User | null) => {
    const nextId = nextUser?.id ?? null;
    if (nextId === lastUserId.current) return;

    // Reset before a direct account switch so identities cannot be merged.
    if (lastUserId.current) posthog.reset();
    if (nextUser) identifyUser(nextUser);
    clearApiCaches();
    lastUserId.current = nextId;
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const nextUser = data.session?.user ?? null;
      setSession(data.session);
      syncAnalyticsIdentity(nextUser);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      syncAnalyticsIdentity(next?.user ?? null);
      // Recovery links can land anywhere (old bundles / dashboard-triggered
      // resets default to the Site URL) — always steer them to the
      // set-new-password form.
      if (
        event === "PASSWORD_RECOVERY" &&
        window.location.pathname !== "/reset-password"
      ) {
        window.location.replace("/reset-password");
      }
    });
    return () => subscription.unsubscribe();
  }, [syncAnalyticsIdentity]);

  // Backend said the session is invalid (401 + WWW-Authenticate: Bearer):
  // hard reset to /login so no per-user state survives.
  useEffect(() => {
    setAuthFailureHandler(() => {
      supabase.auth.signOut().finally(() => {
        clearApiCaches();
        window.location.assign("/login");
      });
    });
    return () => setAuthFailureHandler(null);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    clearApiCaches();
    window.location.assign("/login");
  }, []);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, loading, signOut }),
    [session, loading, signOut]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

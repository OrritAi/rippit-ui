import { createClient } from "@supabase/supabase-js";

/*
 * Browser Supabase client — auth only. All protected data flows through the
 * Orrit API with a Bearer token; the UI never reads app tables directly, so
 * the SPA pattern (no @supabase/ssr, no middleware) is the right fit.
 */
/* Fallbacks keep module evaluation safe during build/prerender (no env) and
   point local dev at the local Supabase stack. The placeholder anon key only
   exists so createClient doesn't throw at import time — real requests need
   NEXT_PUBLIC_SUPABASE_ANON_KEY set. */

/** True when this deployment forgot its Supabase env vars: a non-localhost
    page would silently talk to the developer's own machine otherwise. */
export function supabaseMisconfigured(): boolean {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return false;
  if (typeof window === "undefined") return false;
  return !["localhost", "127.0.0.1"].includes(window.location.hostname);
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54421",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "unset-anon-key",
  {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

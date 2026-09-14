"use client";

import { useEffect, useState } from "react";
import { fetchCurrentWorkspace } from "@/app/lib/api";

/*
 * Whether the signed-in address is on the platform's admin allowlist.
 *
 * The server is the only authority here: `PLATFORM_ADMIN_EMAILS` is read
 * per-request against the Supabase JWT's email (`rippit-api/app/auth.py`
 * `is_platform_admin_email`), so removing an address is an immediate
 * revocation and nothing cached client-side may outlive it. This answers one
 * question only — *may I show the link* — and grants nothing: `/admin` and
 * every `/admin/*` route re-check server-side and 404 for anyone else.
 *
 * Undefined while unknown, so a caller renders nothing rather than flashing a
 * link and withdrawing it. Cached for the tab because it cannot change within
 * a session — a change to the allowlist is a redeploy, which ends the process
 * anyway — and because Settings would otherwise re-ask on every mount.
 */

let cached: boolean | undefined;
let inflight: Promise<boolean> | null = null;

function read(): Promise<boolean> {
  if (cached !== undefined) return Promise.resolve(cached);
  inflight ??= fetchCurrentWorkspace()
    .then((w) => {
      cached = w.isPlatformAdmin;
      return cached;
    })
    // A failed probe is not an admin: the link stays hidden rather than
    // appearing on an error and 404ing when it is followed.
    .catch(() => false)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function usePlatformAdmin(): boolean | undefined {
  const [is, setIs] = useState<boolean | undefined>(cached);

  useEffect(() => {
    if (cached !== undefined) return;
    let live = true;
    read().then((v) => live && setIs(v));
    return () => {
      live = false;
    };
  }, []);

  return is;
}

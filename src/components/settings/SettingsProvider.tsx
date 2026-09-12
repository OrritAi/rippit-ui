"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  CurrentWorkspace,
  fetchCurrentWorkspace,
  fetchMembers,
  WorkspaceInvite,
  WorkspaceMember,
} from "@/app/lib/api";
import { useWorkspace } from "@/components/app/WorkspaceProvider";

/*
 * What every settings section reads: the organization (name, status,
 * created), its members and pending invites. Loaded once when settings
 * opens; every mutation awaits the API, toasts, then `reload()`s.
 */
interface SettingsCtx {
  org: CurrentWorkspace | null;
  members: WorkspaceMember[] | null;
  invites: WorkspaceInvite[];
  error: string;
  reload: () => void;
}

const Ctx = createContext<SettingsCtx>({ org: null, members: null, invites: [], error: "", reload: () => {} });

export function useSettings() {
  return useContext(Ctx);
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { current } = useWorkspace();
  const [org, setOrg] = useState<CurrentWorkspace | null>(null);
  const [data, setData] = useState<{ members: WorkspaceMember[]; invites: WorkspaceInvite[] } | null>(null);
  const [error, setError] = useState("");
  const [gen, setGen] = useState(0);
  const id = current?.id ?? null;

  useEffect(() => {
    if (!id) return;
    let live = true;
    fetchCurrentWorkspace()
      .then((o) => live && setOrg(o))
      .catch(() => {});
    fetchMembers(id)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError("");
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id, gen]);

  const reload = useCallback(() => setGen((g) => g + 1), []);

  const value = useMemo<SettingsCtx>(
    () => ({ org, members: data?.members ?? null, invites: data?.invites ?? [], error, reload }),
    [org, data, error, reload]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

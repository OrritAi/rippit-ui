"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  acceptMyInvite,
  clearApiCaches,
  exitSupport,
  fetchCurrentWorkspace,
  fetchMyInvites,
  fetchWorkspaces,
  getActiveWorkspaceId,
  getSupport,
  setActiveWorkspaceId,
  Role,
  Workspace,
} from "@/app/lib/api";

/*
 * The active organization — the collaboration scope every API call is made
 * in (X-Orrit-Workspace). Loaded once per signed-in user; switching
 * persists the choice, clears caches and remounts the data providers
 * (layout keys on `current.id`).
 *
 * Support mode (platform staff "View as org"): the organization comes from
 * /workspaces/current under the support header, there is no switcher, and
 * the viewer is treated as a member — view-only.
 *
 * Pending invites addressed to the signed-in email are accepted once per
 * page load: that is what makes "joins on first sign-in" true.
 */

interface WorkspaceCtx {
  current: Workspace | null;
  workspaces: Workspace[];
  loading: boolean;
  error: string;
  /** Set while platform staff view an organization read-only. */
  support: { workspaceId: string; name: string } | null;
  switchTo: (id: string) => void;
  refresh: () => void;
}

const Ctx = createContext<WorkspaceCtx>({
  current: null,
  workspaces: [],
  loading: true,
  error: "",
  support: null,
  switchTo: () => {},
  refresh: () => {},
});

export function useWorkspace() {
  return useContext(Ctx);
}

/** The viewer's role in the active organization. Support views count as member. */
export function useRole(): Role {
  const { current, support } = useWorkspace();
  if (support) return "member";
  const role = current?.role;
  return role === "owner" || role === "admin" ? role : "member";
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  // Result keyed by load generation → "loading" is derived, never set
  // synchronously inside the effect.
  const [result, setResult] = useState<{ gen: number; current?: string; workspaces?: Workspace[]; error?: string } | null>(null);
  const [gen, setGen] = useState(0);
  const [support] = useState(() => getSupport());
  const invitesChecked = useRef(false);

  useEffect(() => {
    let live = true;
    if (support) {
      fetchCurrentWorkspace()
        .then((org) => {
          if (!live) return;
          const ws: Workspace = { id: org.id, name: org.name || support.name, slug: org.slug, role: "member", status: org.status, created_at: org.createdAt };
          setResult({ gen, current: ws.id, workspaces: [ws] });
        })
        .catch(() => {
          // The organization is gone or the viewer is not staff: leave support mode.
          if (live) exitSupport();
        });
      return () => {
        live = false;
      };
    }
    fetchWorkspaces()
      .then(({ current, workspaces: list }) => {
        if (!live) return;
        // The API resolved the active workspace (header if valid, else
        // default). Keep the stored id in step so a stale one heals.
        setActiveWorkspaceId(current);
        setResult({ gen, current, workspaces: list });
      })
      .catch((e: Error) => {
        if (!live) return;
        // A stale workspace id (left a workspace) → drop it and retry once.
        if (getActiveWorkspaceId()) {
          setActiveWorkspaceId(null);
          setGen((g) => g + 1);
          return;
        }
        setResult({ gen, error: e.message });
      });
    return () => {
      live = false;
    };
  }, [gen, support]);

  const switchTo = useCallback((id: string) => {
    setActiveWorkspaceId(id);
    clearApiCaches();
    setGen((g) => g + 1);
  }, []);

  const refresh = useCallback(() => setGen((g) => g + 1), []);

  // Invites waiting for this email: accept them, say so, offer to open the
  // organization. Once per page load, never in a support view.
  const loaded = !!result && result.gen === gen && !result.error;
  useEffect(() => {
    if (support || !loaded || invitesChecked.current) return;
    invitesChecked.current = true;
    let live = true;
    (async () => {
      const { invites } = await fetchMyInvites();
      let joined = 0;
      for (const inv of invites) {
        try {
          const res = await acceptMyInvite(inv.id);
          joined++;
          const name = res.organizationName || inv.organizationName || "the organization";
          toast.success(`You joined ${name}`, {
            action: res.workspaceId ? { label: "Open", onClick: () => switchTo(res.workspaceId) } : undefined,
          });
        } catch {
          /* expired or already handled — the next sign-in tries again */
        }
      }
      if (live && joined > 0) refresh();
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [support, loaded, switchTo, refresh]);

  const value = useMemo<WorkspaceCtx>(() => {
    const fresh = result && result.gen === gen ? result : null;
    const workspaces = fresh?.workspaces ?? result?.workspaces ?? [];
    const currentId = fresh?.current ?? result?.current ?? null;
    return {
      current: workspaces.find((w) => w.id === currentId) ?? null,
      workspaces,
      loading: !fresh,
      error: fresh?.error ?? "",
      support,
      switchTo,
      refresh,
    };
  }, [result, gen, support, switchTo, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

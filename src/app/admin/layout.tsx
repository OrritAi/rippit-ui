"use client";

/*
 * The internal admin portal. Outside the (app) group: no rail, no
 * organization providers. Signed out → /login (and back). Signed in but not
 * platform staff → 404, the same answer the API gives.
 */

import { useEffect, useState } from "react";
import { notFound, useRouter } from "next/navigation";
import { fetchCurrentWorkspace } from "@/app/lib/api";
import { useAuth } from "@/components/app/AuthProvider";
import { PortalHeader } from "@/components/shared/PortalHeader";
import { StatusPill } from "@/components/shared/StatusPill";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, user, loading } = useAuth();
  const [gate, setGate] = useState<"checking" | "ok" | "denied">("checking");

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace(`/login?next=${encodeURIComponent("/admin")}`);
      return;
    }
    let live = true;
    fetchCurrentWorkspace()
      .then((w) => live && setGate(w.isPlatformAdmin ? "ok" : "denied"))
      .catch(() => live && setGate("denied"));
    return () => {
      live = false;
    };
  }, [loading, session, router]);

  useEffect(() => {
    document.title = "Admin portal — Orrit";
  }, []);

  if (gate === "denied") notFound();
  if (gate !== "ok" || !user) return null;

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-bg text-t1">
      <PortalHeader
        crumb="admin portal"
        badge={<StatusPill pill={{ label: "Internal", tone: "warn" }} dot={false} />}
        meta={`signed in as ${user.email}`}
      />
      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Clock3, PanelLeftOpen } from "lucide-react";
import { useShell } from "@/components/shell/shell-context";
import { useConnections, useWorkflowIndex } from "@/components/app/ConnectionsProvider";
import { workflowHref } from "@/lib/portals";
import { AppPuck } from "@/components/shared/AppPuck";
import { Kbd } from "@/components/shell/Kbd";
import { useRecentWorkflows } from "@/lib/stored";

/*
 * /w — the canvas view with nothing selected: open the browser, offer the
 * recents and the first few workflows so there is always one click to a
 * canvas.
 */
export default function WorkflowPickerPage() {
  const { railOpen, setRailOpen } = useShell();
  const { connections, loading } = useConnections();
  const index = useWorkflowIndex();
  const recent = useRecentWorkflows().slice(0, 6);

  useEffect(() => {
    document.title = "Workflows — Orrit";
  }, []);

  const suggestions = recent.length > 0 ? [] : index.slice(0, 8);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[46px] flex-none items-center gap-2 border-b border-line px-3">
        <span className="text-[13.5px] font-semibold">Workflows</span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-vpbg p-6" style={{ backgroundImage: "radial-gradient(var(--dot) 1.2px, transparent 1.6px)", backgroundSize: "24px 24px" }}>
        <div className="w-full max-w-[440px] rounded-card border border-line bg-panel p-5 shadow-[var(--shadow-card)] backdrop-blur-[14px] anim-fade-up">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em]">Pick a workflow</h1>
          <p className="mt-1 text-[13px] text-t2">
            Browse by platform and folder{railOpen ? "" : " in the side browser"}, or jump straight back in.
          </p>
          {!railOpen && (
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              className="mt-3 inline-flex h-8 cursor-pointer items-center gap-2 rounded-control border border-line-strong px-3 text-[13px] font-semibold text-t1 transition-colors hover:bg-hover"
            >
              <PanelLeftOpen aria-hidden="true" className="size-3.5" />
              Open the browser <Kbd>[</Kbd>
            </button>
          )}
          {recent.length > 0 && (
            <section className="mt-4" aria-label="Recently opened">
              <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3">Recent</p>
              <div className="flex flex-col">
                {recent.map((r) => (
                  <Link key={`${r.provider}:${r.id}`} href={`/w/${r.provider}/${r.id}`} className="flex min-h-8 items-center gap-2 rounded-row px-2 py-1 text-[13px] text-t2 transition-colors hover:bg-hover hover:text-t1">
                    <Clock3 aria-hidden="true" className="size-3 flex-none text-t3" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{r.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {suggestions.length > 0 && (
            <section className="mt-4" aria-label="Workflows">
              <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3">Workflows</p>
              <div className="flex flex-col">
                {suggestions.map((w) => (
                  <Link key={`${w.provider}:${w.refId}`} href={workflowHref({ source: w.provider, refId: w.refId })} className="flex min-h-8 items-center gap-2 rounded-row px-2 py-1 text-[13px] text-t2 transition-colors hover:bg-hover hover:text-t1">
                    <AppPuck app={w.provider} size={16} />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{w.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {!loading && connections.length === 0 && (
            <p className="mt-4 text-[13px] text-t2">
              Nothing is connected yet.{" "}
              <Link href="/settings/connections" className="font-semibold text-t1 underline-offset-4 hover:underline">
                Connect Make or HighLevel →
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

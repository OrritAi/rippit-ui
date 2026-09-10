"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Funnel, Plus, Radar } from "lucide-react";
import { createFunnel, detectFunnels, fetchFunnels, type FunnelSummary } from "@/app/lib/api";
import { useConnections } from "@/components/app/ConnectionsProvider";
import { CoverageChips } from "@/components/martech/CoverageChips";
import { StatusPill } from "@/components/shared/StatusPill";
import { RowCard, ViewBar, ViewBody } from "@/components/views/ViewFrame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ago } from "@/lib/time";

/*
 * Martech — every funnel Rippit has detected or an operator has mapped, one
 * card each. Detection reads the funnel directory and the workflows already
 * captured; "Map a funnel" creates metadata only. Neither touches
 * GoHighLevel or Make.
 */
export default function MartechPage() {
  const { connections, loading: connectionsLoading } = useConnections();
  const [funnels, setFunnels] = useState<FunnelSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    document.title = "Martech — Rippit";
  }, []);

  const load = useCallback(
    () =>
      fetchFunnels()
        .then((d) => setFunnels(d.funnels))
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load funnels")),
    []
  );

  useEffect(() => {
    void load();
  }, [load]);

  const ghl = connections.filter((c) => c.provider === "ghl");

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError("");
    try {
      await createFunnel(name, ghl[0]?.id);
      setNewName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the funnel");
    } finally {
      setCreating(false);
    }
  }

  async function detect() {
    if (ghl.length === 0) return;
    setDetecting(true);
    setError("");
    try {
      for (const c of ghl) await detectFunnels(c.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detection failed");
    } finally {
      setDetecting(false);
    }
  }

  const loading = funnels === null || (connectionsLoading && connections.length === 0);
  const noGhl = !connectionsLoading && ghl.length === 0;

  return (
    <>
      <ViewBar title="Martech">
        {ghl.length > 0 && funnels && funnels.length > 0 && (
          <Button onClick={detect} disabled={detecting} variant="outline" className="h-7 cursor-pointer rounded-control text-[12px] font-semibold disabled:opacity-50">
            <Radar aria-hidden="true" className="size-3.5" />
            {detecting ? "Detecting…" : "Detect funnels"}
          </Button>
        )}
      </ViewBar>
      <ViewBody>
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <p className="max-w-2xl text-[13px] text-t2">
            A funnel is how a lead moves through your system — opt-in, application, qualification, booking — with the pages, automations and
            tracking attached to each step. Everything here is read from configuration; nothing shows whether a step ran.
          </p>

          {error && <p role="alert" className="text-[12.5px] text-err-text">{error}</p>}

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} aria-hidden="true" className="h-[132px] animate-pulse rounded-card bg-hover motion-reduce:animate-none" />
              ))}
            </div>
          ) : funnels.length === 0 ? (
            noGhl ? (
              <RowCard className="p-6 text-center">
                <h2 className="mb-1.5 text-[15px] font-semibold">Connect GoHighLevel to map your funnels</h2>
                <p className="mx-auto max-w-md text-[13px] text-t2">
                  Rippit detects funnels from a location&apos;s funnel directory and the workflows it has captured. Connect a location to start.
                </p>
                <Link href="/settings/connections" className="mt-3 inline-block text-[13px] font-semibold underline-offset-4 hover:underline">
                  Open Settings → Connections
                </Link>
              </RowCard>
            ) : (
              <RowCard className="p-6 text-center">
                <h2 className="mb-1.5 text-[15px] font-semibold">No funnels detected yet</h2>
                <p className="mx-auto max-w-md text-[13px] text-t2">
                  Detection reads the funnel directory and the captured workflows of each connected location. It never touches GoHighLevel.
                </p>
                <div className="mt-4 flex justify-center">
                  <Button onClick={detect} disabled={detecting} className="h-8 cursor-pointer rounded-control text-[12.5px] font-semibold disabled:opacity-50">
                    <Radar aria-hidden="true" className="size-3.5" />
                    {detecting ? "Detecting…" : "Detect funnels"}
                  </Button>
                </div>
                <ManualMap value={newName} onChange={setNewName} onSubmit={create} busy={creating} className="mx-auto mt-5 max-w-md border-t border-line2 pt-4" />
              </RowCard>
            )
          ) : (
            <>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {funnels.map((f, i) => (
                  <li key={f.id} className="min-w-0">
                    <FunnelCard funnel={f} delay={Math.min(i, 8) * 0.03} />
                  </li>
                ))}
              </ul>
              {ghl.length > 0 && <ManualMap value={newName} onChange={setNewName} onSubmit={create} busy={creating} className="max-w-2xl" />}
            </>
          )}
        </div>
      </ViewBody>
    </>
  );
}

function FunnelCard({ funnel: f, delay }: { funnel: FunnelSummary; delay: number }) {
  const meta = [
    `${f.pageCount} page${f.pageCount === 1 ? "" : "s"}`,
    `${f.workflowCount} workflow${f.workflowCount === 1 ? "" : "s"}`,
    f.lastCapturedAt ? `captured ${ago(f.lastCapturedAt)}` : "not captured yet",
  ].join(" · ");
  return (
    <RowCard delay={delay} className="h-full">
      <Link href={`/martech/${f.id}`} className="flex h-full flex-col gap-2.5 p-3.5 transition-colors hover:bg-hover">
        <div className="flex items-start gap-2.5">
          <span className="flex size-8 flex-none items-center justify-center rounded-control border border-line bg-hover text-t2">
            <Funnel aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block [overflow-wrap:anywhere] text-[13.5px] font-semibold leading-tight">
              {f.name}
            </span>
            <span className="block [overflow-wrap:anywhere] text-[11.5px] text-t3">{f.accountLabel ?? "No account"}</span>
          </span>
          <StatusPill pill={REVIEW_PILL[f.reviewState] ?? REVIEW_PILL.draft} dot={false} />
        </div>
        <div className="flex items-center gap-2">
          {f.origin === "detected" && (
            <span className="rounded-full border border-line bg-hover px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-[.05em] text-t3">Detected</span>
          )}
          <span className="tabular min-w-0 [overflow-wrap:anywhere] font-mono text-[10.5px] text-t3">{meta}</span>
        </div>
        <CoverageChips coverage={f.coverage} compact />
      </Link>
    </RowCard>
  );
}

function ManualMap({ value, onChange, onSubmit, busy, className = "" }: { value: string; onChange: (v: string) => void; onSubmit: () => void; busy: boolean; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <p className="text-left text-[11.5px] text-t3">Or document a journey by hand — metadata only, nothing is created in the platform.</p>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder="Name a funnel to map — e.g. Creator Protocol"
          className="h-9 flex-1 rounded-control border-line-strong bg-hover text-[13.5px]"
          aria-label="New funnel name"
        />
        <Button onClick={onSubmit} disabled={busy || !value.trim()} variant="outline" className="h-9 cursor-pointer rounded-control text-[13px] font-semibold disabled:opacity-50">
          <Plus aria-hidden="true" className="size-3.5" />
          Map a funnel
        </Button>
      </div>
    </div>
  );
}

const REVIEW_PILL: Record<string, { label: string; tone: "ok" | "warn" | "muted" }> = {
  draft: { label: "draft", tone: "muted" },
  needs_review: { label: "needs review", tone: "warn" },
  reviewed: { label: "reviewed", tone: "ok" },
};

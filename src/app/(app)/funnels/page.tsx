"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, GitBranch, Plus } from "lucide-react";
import { createFunnel, fetchFunnels, type FunnelSummary } from "@/app/lib/api";
import { useConnections } from "@/components/app/ConnectionsProvider";
import { EmptyRow, RowCard, ViewBar, ViewBody } from "@/components/views/ViewFrame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
 * Funnels — the lead-journey documentation layer over synced workflows. A row
 * per funnel; click to open its journey. "Map a funnel" creates the metadata
 * (an operator-defined collection of stages), never a change to GHL/Make.
 */
export default function FunnelsPage() {
  const { connections } = useConnections();
  const [funnels, setFunnels] = useState<FunnelSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    document.title = "Funnels — Rippit";
  }, []);

  const load = () =>
    fetchFunnels()
      .then((d) => setFunnels(d.funnels))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load funnels"));

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const ghl = connections.find((c) => c.provider === "ghl");
      await createFunnel(name, ghl?.id);
      setNewName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the funnel");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <ViewBar title="Funnels" />
      <ViewBody>
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <p className="text-[13px] text-t2">
            A funnel is how a lead moves through your system — opt-in, application,
            qualification, booking — with the automations and tracking attached to
            each step. Mapping one is documentation; it never changes GoHighLevel or
            Make.
          </p>

          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="Name a funnel to map — e.g. Creator Protocol"
              className="h-9 flex-1 rounded-control border-line-strong bg-hover text-[13.5px]"
              aria-label="New funnel name"
            />
            <Button
              onClick={create}
              disabled={creating || !newName.trim()}
              className="h-9 cursor-pointer rounded-control text-[13px] font-semibold disabled:opacity-50"
            >
              <Plus aria-hidden="true" className="size-3.5" />
              Map a funnel
            </Button>
          </div>

          {error && <p role="alert" className="text-[12.5px] text-err-text">{error}</p>}

          <RowCard>
            {funnels === null ? (
              <div className="flex flex-col gap-1 p-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} aria-hidden="true" className="h-[42px] animate-pulse rounded-row bg-hover motion-reduce:animate-none" />
                ))}
              </div>
            ) : funnels.length === 0 ? (
              <EmptyRow>No funnels mapped yet — name one above to start.</EmptyRow>
            ) : (
              funnels.map((f) => (
                <Link
                  key={f.id}
                  href={`/funnels/${f.id}`}
                  className="flex items-center gap-3 border-b border-line2 px-3.5 py-2.5 last:border-b-0 hover:bg-hover"
                >
                  <span className="flex size-8 flex-none items-center justify-center rounded-control border border-line bg-hover text-t2">
                    <GitBranch aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{f.name}</span>
                    <span className="block truncate text-[11.5px] text-t3">
                      {f.accountLabel ? `${f.accountLabel} · ` : ""}
                      {REVIEW_LABEL[f.reviewState]}
                    </span>
                  </span>
                  <ArrowUpRight aria-hidden="true" className="size-4 flex-none text-t3" />
                </Link>
              ))
            )}
          </RowCard>
        </div>
      </ViewBody>
    </>
  );
}

const REVIEW_LABEL: Record<string, string> = {
  draft: "Draft — not reviewed",
  needs_review: "Needs review",
  reviewed: "Reviewed",
};

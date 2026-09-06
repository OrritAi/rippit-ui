"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CircleCheck, CircleDashed, CircleSlash } from "lucide-react";
import {
  fetchFunnelGraph,
  type CoverageState,
  type FunnelGraph,
  type FunnelStage,
} from "@/app/lib/api";
import { ViewBar, ViewBody } from "@/components/views/ViewFrame";
import { workflowHref } from "@/lib/portals";

/*
 * Funnel detail — the journey read left to right: stages as a spine, the
 * automations and conversions attached to each, and an honest coverage
 * strip. The default view explains the journey before any click; gaps show
 * in place ("not captured"), never as false completeness.
 */
export default function FunnelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [graph, setGraph] = useState<FunnelGraph | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchFunnelGraph(id)
      .then((g) => {
        setGraph(g);
        document.title = `${g.funnel.name} — Rippit`;
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this funnel"));
  }, [id]);

  const stages = useMemo(
    () => (graph ? [...graph.stages].sort((a, b) => a.displayOrder - b.displayOrder) : []),
    [graph]
  );

  if (error) {
    return (
      <>
        <ViewBar title="Funnel" />
        <ViewBody>
          <div className="mx-auto max-w-2xl">
            <Link href="/funnels" className="inline-flex items-center gap-1 text-[13px] text-t2 hover:text-t1">
              <ArrowLeft aria-hidden="true" className="size-3.5" /> Funnels
            </Link>
            <p role="alert" className="mt-4 text-[13px] text-err-text">{error}</p>
          </div>
        </ViewBody>
      </>
    );
  }

  return (
    <>
      <ViewBar title={graph?.funnel.name ?? "Funnel"} />
      <ViewBody>
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          <Link href="/funnels" className="inline-flex w-fit items-center gap-1 text-[12.5px] text-t2 hover:text-t1">
            <ArrowLeft aria-hidden="true" className="size-3.5" /> All funnels
          </Link>

          {graph && <CoverageStrip coverage={graph.coverage} />}

          {!graph ? (
            <div className="flex gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} aria-hidden="true" className="h-40 w-52 animate-pulse rounded-card bg-hover motion-reduce:animate-none" />
              ))}
            </div>
          ) : stages.length === 0 ? (
            <div className="rounded-card border border-line bg-panel p-6 text-center text-[13px] text-t2">
              This funnel has no stages yet. Add the journey steps — opt-in,
              application, booking — and attach the workflows that run at each.
            </div>
          ) : (
            <div className="flex items-stretch gap-2 overflow-x-auto pb-3">
              {stages.map((stage, i) => (
                <div key={stage.id} className="flex items-stretch gap-2">
                  <StageCard stage={stage} graph={graph} />
                  {i < stages.length - 1 && (
                    <div className="flex items-center text-t3" aria-hidden="true">
                      <ArrowRight className="size-4" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </ViewBody>
    </>
  );
}

function StageCard({ stage, graph }: { stage: FunnelStage; graph: FunnelGraph }) {
  const attachments = graph.attachments.filter((a) => a.stageId === stage.id);
  const workflows = attachments.filter((a) => a.targetKind === "workflow" || a.targetKind === "step");
  const summaryOf = (connId?: string | null, ext?: string | null) =>
    graph.workflowSummaries.find((w) => w.connectionId === connId && w.workflowExternalId === ext);

  return (
    <div className="flex w-56 flex-none flex-col gap-2 rounded-card border border-line bg-panel p-3">
      <div>
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.05em] text-t3">
          {STAGE_KIND_LABEL[stage.kind] ?? stage.kind}
        </p>
        <h3 className="text-[13.5px] font-semibold leading-tight">{stage.displayName}</h3>
      </div>
      {stage.purpose && <p className="text-[11.5px] leading-relaxed text-t2">{stage.purpose}</p>}

      {workflows.length > 0 && (
        <div className="mt-1 flex flex-col gap-1 border-t border-line2 pt-2">
          {workflows.map((a) => {
            const s = summaryOf(a.connectionId, a.workflowExternalId);
            const href =
              a.connectionId && a.workflowExternalId && s
                ? workflowHref({ source: "ghl", refId: a.workflowExternalId })
                : null;
            const body = (
              <>
                <span className="min-w-0 flex-1 truncate">{s?.name ?? a.label ?? a.workflowExternalId}</span>
                {s?.status && (
                  <span className="flex-none text-[9px] uppercase text-t3">
                    {s.status === "published" ? "live" : "draft"}
                  </span>
                )}
              </>
            );
            return href ? (
              <Link key={a.id} href={href} className="flex items-center gap-1.5 rounded-row px-1 py-0.5 text-[11px] text-t2 hover:bg-hover">
                {body}
              </Link>
            ) : (
              <span key={a.id} className="flex items-center gap-1.5 px-1 py-0.5 text-[11px] text-t3">{body}</span>
            );
          })}
        </div>
      )}

      {stage.origin === "manual" && (
        <p className="mt-auto text-[10px] italic text-t3">Documented manually — not captured from source.</p>
      )}
    </div>
  );
}

function CoverageStrip({ coverage }: { coverage: Record<string, CoverageState> }) {
  return (
    <div className="flex flex-wrap gap-2 rounded-card border border-line bg-panel p-3">
      {Object.entries(coverage).map(([facet, state]) => (
        <span
          key={facet}
          title={state.reason ?? undefined}
          className="inline-flex items-center gap-1.5 rounded-full border border-line2 px-2.5 py-1 text-[11px] text-t2"
        >
          <CoverageIcon state={state.state} />
          {COVERAGE_LABEL[facet] ?? facet}
        </span>
      ))}
    </div>
  );
}

function CoverageIcon({ state }: { state: CoverageState["state"] }) {
  if (state === "captured") return <CircleCheck aria-hidden="true" className="size-3.5 text-ok-text" />;
  if (state === "partial") return <CircleDashed aria-hidden="true" className="size-3.5 text-warn-text" />;
  return <CircleSlash aria-hidden="true" className="size-3.5 text-t3" />;
}

const STAGE_KIND_LABEL: Record<string, string> = {
  entry: "Entry", page: "Page", decision: "Decision", outcome: "Outcome", milestone: "Milestone",
};
const COVERAGE_LABEL: Record<string, string> = {
  workflowStructure: "Workflows",
  pageNavigation: "Pages",
  surveyLogic: "Survey logic",
  browserTracking: "Browser tracking",
  serverConversions: "Server conversions",
  runtimeDelivery: "Runtime delivery",
};

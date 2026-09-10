"use client";

import { useRouter } from "next/navigation";
import type { ExecutionsResponse, WorkflowCard } from "@/app/lib/api";
import { getConnector } from "@/lib/connectors";
import type { ProviderId } from "@/lib/connectors/types";
import { appName } from "@/lib/apps";
import { keyOf, parseKey } from "@/lib/workflowMap/model";
import type { MapNode, WorkflowRef } from "@/lib/workflowMap/types";
import { AppPuck } from "@/components/shared/AppPuck";
import { JsonBlock, KvRow, Section } from "@/components/shared/DetailPanelKit";
import { IssuesSection } from "@/components/shared/IssuesSection";
import { TriggerConditions } from "@/components/shared/TriggerConditions";
import { AssetsSection, assetHref } from "@/components/shared/AssetsSection";
import { SurveyStructureView } from "@/components/shared/SurveyStructure";
import { relativeTime } from "@/components/shared/RunsPanel";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MapTip } from "./MapTip";
import { nodeLink } from "./nodeLink";

/*
 * MapSidebar — the 322px panel for the selected node. Only what informs:
 * header (puck · name · "App · #ordinal" · ×, plus a health line only when
 * something is wrong) → actions → exception notes only (a "Go to" step's
 * target with Show, a Make step's filter/wait, a pill whose steps Rippit
 * cannot show, the changed/comments note) → Issues (when any) → Runs (Make
 * only, when there is run data) → the step's own sections once its detail
 * arrives (trigger conditions, assets, survey structure) → Advanced details,
 * folded. No "What it does" prose: the card already carries the step
 * summary, and a pill's name and status are on the pill.
 */

export interface DetailState {
  status: "idle" | "loading" | "ok" | "error";
  data?: unknown;
}

export function MapSidebar({
  node,
  viewed,
  runs,
  card,
  detail,
  onClose,
  note,
  onShowStep,
}: {
  node: MapNode;
  viewed: WorkflowRef;
  /** Executions of the viewed workflow (Make only). */
  runs: ExecutionsResponse | null;
  /** Link-map card for a pill's workflow. */
  card?: WorkflowCard;
  detail: DetailState;
  onClose: () => void;
  /** Extra mono line under the actions ("changed since you last looked · 2 open comments"). */
  note?: string | null;
  /** Select + centre a step of the same workflow (the jump target). */
  onShowStep?: (key: string, stepId: string) => void;
}) {
  const router = useRouter();
  const viewedKey = keyOf(viewed);
  const source: ProviderId = node.ref?.source ?? (node.stepRef ? parseKey(node.stepRef.key)?.source : undefined) ?? viewed.source;
  const connector = getConnector(source);
  const isPill = !!node.pill;
  const isStep = node.kind === "step" && !!node.module;
  const belongsToViewed = node.ref ? keyOf(node.ref) === viewedKey : node.stepRef?.key === viewedKey;
  const detailLoaded = isStep && detail.status === "ok" && detail.data != null;
  const desc = detailLoaded ? connector.describeNode(detail.data) : null;
  const mod = node.module;
  const app = desc?.app ?? node.app;
  const issues = mod?.issues ?? [];
  const latest = runs?.executions?.[0] ?? null;
  const failedHere =
    isStep && belongsToViewed && !!latest && latest.status === "error" && latest.causeModuleId != null && String(latest.causeModuleId) === node.stepRef?.stepId;
  const failures = runs?.executions?.filter((e) => e.status === "error" || e.status === "incomplete").length ?? 0;

  let health: string | null = null;
  if (isStep) {
    if (detailLoaded) health = failedHere ? "last run failed here" : issues.some((i) => i.severity === "error") ? "issue detected" : "no issues detected";
  } else if (isPill && card?.issueCounts) {
    health = card.issueCounts.error > 0 ? "issues detected" : "no issues detected";
  }
  const title = desc?.title ?? node.name;
  const ordinal = desc?.ordinal ?? mod?.ordinal ?? null;
  const subline = [appName(app), ordinal ? `#${ordinal}` : node.kind === "step" ? null : node.kind].filter(Boolean).join(" · ");
  const warn = health && health !== "no issues detected" ? health : null;
  const link = nodeLink(node);
  const Sections = connector.DetailSections;

  /* ---- Exception notes: only what the canvas cannot show ---- */
  const notes: string[] = [];
  if (isStep && mod) {
    const filter = desc?.filterName || mod.filterName;
    const wait = desc?.waitText || mod.waitFor?.text;
    if (filter) notes.push(`Only continues when ${filter}`);
    else if (mod.hasFilter) notes.push("Has a filter");
    if (wait) notes.push(`Waits ${wait}`);
  } else if (isPill) {
    const p = node.pill;
    if (p?.unavailable) notes.push("This connection exposes names and status only, not steps");
    else if (p?.error === "not-captured") notes.push(`Rippit has not captured this ${connector.nouns.workflow}'s steps yet`);
    else if (p?.error === "not-synced") notes.push(`This ${connector.nouns.workflow} is not synced into Rippit`);
    else if (p?.error === "fetch-failed") notes.push("Its steps could not be fetched just now");
    if (p?.link?.status === "dead") notes.push("The link into this workflow is dead");
  }
  if (note) notes.push(note);

  return (
    <div className="thin-scroll wm-slidein box-border h-full w-[322px] overflow-auto px-4 pb-6 pt-4">
      {/* Nothing in here truncates: names, sublines and values wrap. */}
      <div className="mb-2 flex items-start gap-2.5">
        <AppPuck app={app} size={34} />
        <div className="min-w-0 flex-1 pt-px">
          <div className="text-[13.5px] font-semibold leading-[1.3] [overflow-wrap:anywhere]">{title}</div>
          <div className="mt-0.5 font-mono text-[10.5px] leading-[1.4] text-t3 [overflow-wrap:anywhere]">{subline}</div>
          {warn && <div className="mt-1 text-[11px] font-semibold text-err-text">{warn}</div>}
        </div>
        <MapTip label="Close · Esc" side="left">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-[6px] border-0 bg-transparent px-1.5 py-[3px] font-sans text-[15px] leading-none text-t3 transition-colors duration-200 hover:bg-hover hover:text-t1"
          >
            ×
          </button>
        </MapTip>
      </div>
      <div className="mb-5 mt-3 flex flex-wrap items-center gap-2">
        {node.pill && node.rippitHref && (
          <Button size="sm" variant="ghost" asChild>
            <Link href={node.rippitHref}>Open in Rippit</Link>
          </Button>
        )}
        {link.href ? (
          <Button size="sm" asChild>
            <a href={link.href} target="_blank" rel="noopener noreferrer" title={link.title}>
              {link.label} ↗
            </a>
          </Button>
        ) : (
          <Button size="sm" disabled title={link.title}>
            {link.label} ↗
          </Button>
        )}
      </div>

      {(node.jumpTo || notes.length > 0) && (
        <div className="mb-5 flex flex-col gap-1.5">
          {node.jumpTo && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-[1.55] text-t1">
              <span className="[overflow-wrap:anywhere]">Continues at {node.jumpTo.targetName}</span>
              {node.stepRef && onShowStep && (
                <MapTip label="Select and centre the target step">
                  <Button variant="ghost" size="xs" onClick={() => onShowStep(node.stepRef!.key, node.jumpTo!.stepId)}>
                    Show
                  </Button>
                </MapTip>
              )}
            </div>
          )}
          {notes.map((n) => (
            <p key={n} className="font-mono text-[10.5px] leading-[1.5] text-t3 [overflow-wrap:anywhere]">
              {n}
            </p>
          ))}
        </div>
      )}

      <IssuesSection issues={issues} onFindUses={(ref) => router.push(assetHref(ref.kind, ref.value))} />

      {/* Runs: Make only, and only when there is something to show. */}
      {source === "make" && !belongsToViewed && card?.lastRun && (
        <Section title="Runs">
          <KvRow k="Last run" v={`${card.lastRun.status} · ${relativeTime(card.lastRun.at)}`} wrap />
          <p className="mt-1.5 text-[10.5px] text-t3">Open this scenario for run history.</p>
        </Section>
      )}
      {source === "make" && belongsToViewed && runs?.supported && runs.executions.length > 0 && (
        <Section title="Runs">
          <div className="flex flex-col">
            {failedHere && (
              <div
                className="mb-2 flex items-start gap-2 rounded-row border px-2.5 py-2"
                style={{ borderColor: "color-mix(in srgb, var(--err) 40%, transparent)", background: "color-mix(in srgb, var(--err) 8%, transparent)" }}
              >
                <p className="m-0 text-[12px] leading-[1.5] text-err-text">
                  Last run failed <strong>here</strong>
                  {latest?.errorMessage ? `: ${latest.errorMessage}` : ""}
                </p>
              </div>
            )}
            <KvRow k="Last run" v={`${latest?.status ?? "—"} · ${relativeTime(latest?.startedAt ?? null)}`} wrap />
            {latest?.durationMs != null && <KvRow k="Duration" v={`${latest.durationMs} ms`} />}
            <KvRow k={`Failures · last ${runs.executions.length}`} v={String(failures)} />
          </div>
        </Section>
      )}

      {isStep && detail.status === "loading" && (
        <p role="status" className="text-[12px] text-t3">
          Loading details
        </p>
      )}
      {isStep && detail.status === "error" && (
        <p role="alert" className="text-[12px] text-t2">
          The details for this {connector.nouns.step} couldn’t be fetched. Close and try again.
        </p>
      )}
      {detailLoaded && (
        <>
          <TriggerConditions data={detail.data} assets={desc?.assets} />
          <AssetsSection assets={desc?.assets} />
          {desc?.assets?.map((a) => (a.structure ? <SurveyStructureView key={`survey-${a.value}`} structure={a.structure} /> : null))}
          <details className="mt-3 rounded-control border border-line p-2.5">
            <summary className="cursor-pointer text-[12px] font-semibold text-t2">Advanced details</summary>
            <p className="my-2 text-[11px] text-t3">Technical identifiers and source configuration.</p>
            {detail.data ? <Sections data={detail.data} /> : <JsonBlock data={null} />}
          </details>
        </>
      )}
    </div>
  );
}

"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ExternalLink, type LucideIcon } from "lucide-react";
import type { FunnelAutomation, FunnelConversion, FunnelGraph, FunnelPageAsset } from "@/app/lib/api";
import { DockHost } from "@/components/canvas/DockHost";
import { JsonBlock, KvRow, Section } from "@/components/shared/DetailPanelKit";
import { assetHref } from "@/components/shared/AssetsSection";
import { CaptureBadge } from "@/components/shared/CaptureBadge";
import { SoftwareLogo } from "@/components/shared/SoftwareLogo";
import { StatusPill } from "@/components/shared/StatusPill";
import { SurveyStructureView } from "@/components/shared/SurveyStructure";
import { appColor } from "@/lib/apps";
import {
  ACTION_KIND_LABEL,
  ASSET_KIND_LABEL,
  EVIDENCE_LABEL,
  NODE_KIND_ICON,
  actionIcon,
  actionSoftware,
  adPlatformSoftware,
  assetIcon,
  roleLabel,
  triggerIcon,
  workflowStatusPill,
} from "@/lib/martech/labels";
import type { MartechEdge, MartechModel, MartechNode } from "@/lib/martech/types";
import { workflowHref } from "@/lib/portals";
import { ago } from "@/lib/time";

/*
 * Martech inspector — the one right dock of the Martech canvas, keyed by the
 * selected node. Info only, in the same vocabulary as the canvas: a node is
 * "Configured" (read from the platform) or "Not captured" (Orrit has
 * nothing for it). Never a health state, never "fires" — Orrit reads
 * configuration, it does not observe runs.
 *
 * Sections render only when they have something to say: what happens here,
 * what happens next (outgoing edges), attached assets, automations,
 * tracking, and the underlying object under Advanced details.
 */
export function MartechInspector({
  model,
  node,
  graph,
  onClose,
  onSelect,
}: {
  model: MartechModel;
  node: MartechNode;
  graph: FunnelGraph;
  onClose: () => void;
  /** Jump to another node (a target of an outgoing edge). */
  onSelect: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes]);
  const stageName = (stageId: string | null | undefined) =>
    stageId ? (graph.stages.find((s) => s.id === stageId)?.displayName ?? stageId) : null;

  const outgoing = useMemo(
    () => model.edges.filter((e) => e.from === node.id && byId.has(e.to)),
    [model.edges, node.id, byId]
  );

  /* ---- what this node stands for, in the graph ---- */
  const stageId = node.stageId;
  const stageAutomations: FunnelAutomation[] = useMemo(() => {
    if (node.kind === "trigger" || node.kind === "action") return [node.automation];
    if (node.kind === "asset") {
      return graph.automations.filter((a) => a.stageId === stageId && a.trigger.asset?.assetValue === node.asset.externalId);
    }
    if (node.kind === "ad" || node.kind === "pixel") return [];
    if (stageId === "unplaced") return model.unplaced;
    return graph.automations.filter((a) => a.stageId === stageId);
  }, [node, graph.automations, stageId, model.unplaced]);

  const assets: FunnelPageAsset[] = useMemo(() => {
    if (node.kind === "asset") return [node.asset];
    if (node.kind === "trigger" || node.kind === "action") {
      const t = node.automation.trigger.asset;
      const placed = t && stageId ? model.nodes.find((n) => n.kind === "asset" && n.stageId === stageId && n.asset.externalId === t.assetValue) : null;
      return placed && placed.kind === "asset" ? [placed.asset] : [];
    }
    if (node.kind === "page" || node.kind === "stage" || node.kind === "decision") {
      const own = model.nodes.filter((n): n is Extract<MartechNode, { kind: "asset" }> => n.kind === "asset" && n.stageId === stageId);
      if (node.kind === "decision") {
        const survey = own.find((n) => n.asset.externalId === node.decision.assetExternalId);
        return survey ? [survey.asset] : [];
      }
      return own.map((n) => n.asset);
    }
    return [];
  }, [node, model.nodes, stageId]);

  const conversions: FunnelConversion[] = useMemo(() => {
    if (node.kind === "action") return graph.conversions.filter((c) => c.automationId === node.automation.id && c.actionId === node.action?.id);
    if (node.kind === "trigger") return graph.conversions.filter((c) => c.automationId === node.automation.id);
    if (node.kind === "ad") return graph.conversions;
    if (node.kind === "page" || node.kind === "stage" || node.kind === "pixel") return graph.conversions.filter((c) => c.stageId === stageId);
    return [];
  }, [node, graph.conversions, stageId]);

  const pixel = node.kind === "page" || node.kind === "stage" || node.kind === "pixel" ? (graph.tracking.find((t) => t.stageId === stageId)?.pixel ?? null) : null;
  const showTracking = node.kind === "pixel" || pixel || conversions.length > 0;

  const raw = rawObject(node, graph);
  const head = headerFor(node);

  return (
    <DockHost label={`${node.label} — Martech inspector`} width={340} dockKey={node.id} onClose={onClose} header={<Header node={node} head={head} />}>
      <div className="anim-fade-in min-h-0 flex-1 overflow-y-auto px-3.5 py-3" style={{ animationDuration: ".18s" }}>
        <Section title="What happens here">
          <WhatHappensHere node={node} graph={graph} stageName={stageName} />
        </Section>

        {outgoing.length > 0 && (
          <Section title="What happens next">
            <ul className="flex flex-col gap-1">
              {outgoing.map((e) => {
                const target = byId.get(e.to)!;
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(e.to)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-row px-1.5 py-1 text-left text-[12px] hover:bg-hover"
                    >
                      <span className="flex-none text-t3">{edgeVerb(e)}</span>
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere] font-medium text-t1">{target.label}</span>
                      {e.label && <span className={`min-w-0 max-w-[45%] flex-none text-right [overflow-wrap:anywhere] text-[10.5px] ${e.tone === "err" ? "text-err-text" : e.tone === "warn" ? "text-warn-text" : "text-t3"}`}>{e.label}</span>}
                      {(e.evidence === "not-captured" || e.validity !== "current") && (
                        <span className="flex-none text-[10px] text-t3">{e.validity !== "current" ? e.validity.replace(/_/g, " ") : "not captured"}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {assets.length > 0 && (
          <Section title="Attached assets">
            <ul className="flex flex-col gap-1.5">
              {assets.map((a) => {
                const Icon = assetIcon(a.kind);
                const name = a.name || `${ASSET_KIND_LABEL[a.kind]} ${a.externalId}`;
                return (
                  <li key={`${a.assetKind}:${a.externalId}`} className="flex items-center gap-2 rounded-row border border-line2 px-2 py-1.5">
                    <span className="flex size-6 flex-none items-center justify-center rounded-[6px] border border-line bg-hover text-t2">
                      <Icon aria-hidden="true" className="size-3" />
                    </span>
                    <span className="min-w-0 flex-1">
                      {a.nativeUrl ? (
                        <a href={a.nativeUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[12px] font-medium text-t1 underline-offset-4 hover:underline">
                          <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
                          <ExternalLink aria-hidden="true" className="size-3 flex-none text-t3" />
                          <span className="sr-only">(opens in GoHighLevel, new tab)</span>
                        </a>
                      ) : (
                        <span className="block [overflow-wrap:anywhere] text-[12px] font-medium text-t1">{name}</span>
                      )}
                      <span className="block text-[10.5px] text-t3">{ASSET_KIND_LABEL[a.kind]}</span>
                    </span>
                    <Link href={assetHref(a.assetKind, a.externalId)} className="flex-none text-[11px] font-semibold text-t2 underline-offset-4 hover:text-t1 hover:underline">
                      Dependencies
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
        {assets.map((a) => (a.kind === "survey" && a.surveyStructure ? <SurveyStructureView key={`survey:${a.externalId}`} structure={a.surveyStructure} /> : null))}

        {stageAutomations.length > 0 && (
          <Section title={stageAutomations.length === 1 ? "Automation" : "Automations"}>
            <ul className="flex flex-col gap-1.5">
              {stageAutomations.map((a) => (
                <AutomationRow key={a.id} automation={a} />
              ))}
            </ul>
          </Section>
        )}

        {showTracking && (
          <Section title="Tracking">
            <div className="flex flex-col">
              {(pixel || node.kind === "pixel") && (
                <KvRow
                  k="Browser pixel"
                  v={
                    <span className="text-t3" title={pixel?.reason ?? (node.kind === "pixel" ? node.reason : undefined)}>
                      Not captured
                    </span>
                  }
                />
              )}
              {conversions.map((c) => (
                <KvRow key={c.id} k={`${platformLabel(c.platform)} · ${c.eventName}`} v={<span className="text-t2">{EVIDENCE_LABEL[c.evidence]}</span>} />
              ))}
            </div>
            <p className="mt-1.5 text-[10.5px] text-t3">
              {pixel?.reason ?? (node.kind === "pixel" ? node.reason : null) ?? "Server conversions are configured workflow actions, not delivery records."}
            </p>
          </Section>
        )}

        <details className="mt-3 rounded-control border border-line p-2.5">
          <summary className="cursor-pointer text-[12px] font-semibold text-t2">Advanced details</summary>
          <p className="my-2 text-[11px] text-t3">Identifiers and the captured object behind this card.</p>
          <JsonBlock data={raw} />
        </details>
      </div>
    </DockHost>
  );
}

/* ---------- header ---------- */

function headerFor(node: MartechNode): { Icon: LucideIcon | null; software: string | null; subtitle: string } {
  switch (node.kind) {
    case "ad":
      return { Icon: NODE_KIND_ICON.ad, software: node.inferred ? adPlatformSoftware(node.destination) : null, subtitle: node.inferred ? "Traffic source · inferred" : "Traffic source" };
    case "page":
      return { Icon: NODE_KIND_ICON.page, software: null, subtitle: node.lane === "branch" ? "Disqualified page" : [roleLabel(node.role), "Page"].filter(Boolean).join(" · ") };
    case "stage":
      return { Icon: NODE_KIND_ICON.stage, software: null, subtitle: node.position > 0 ? `Step ${node.position} of ${node.total}` : "Unplaced automations" };
    case "decision":
      return { Icon: NODE_KIND_ICON.decision, software: null, subtitle: "Qualification decision" };
    case "asset":
      return { Icon: assetIcon(node.asset.kind), software: null, subtitle: ASSET_KIND_LABEL[node.asset.kind] };
    case "pixel":
      return { Icon: NODE_KIND_ICON.pixel, software: null, subtitle: "Browser tracking" };
    case "trigger":
      return { Icon: triggerIcon(node.automation.trigger), software: null, subtitle: `Trigger · ${node.automation.name}` };
    default: {
      const a = node.action;
      return {
        Icon: actionIcon(a?.kind ?? "other"),
        software: a?.kind === "conversion" ? actionSoftware(a) : null,
        subtitle: a ? `${ACTION_KIND_LABEL[a.kind]} · ${node.automation.name}` : `More actions · ${node.automation.name}`,
      };
    }
  }
}

function Header({ node, head }: { node: MartechNode; head: ReturnType<typeof headerFor> }) {
  const { Icon, software, subtitle } = head;
  return (
    <>
      {software ? (
        <span aria-hidden="true" className="flex size-8 flex-none items-center justify-center rounded-[8px] border border-white/40 text-white" style={{ background: `color-mix(in oklab, ${appColor(software)} 52%, #000)` }}>
          <SoftwareLogo app={software} size={18} />
        </span>
      ) : (
        <span className={`flex size-8 flex-none items-center justify-center rounded-[8px] border ${node.evidence === "configured" ? "border-line bg-hover text-t2" : "border-dashed border-line-strong text-t3"}`}>
          {Icon && <Icon aria-hidden="true" className="size-4" />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block [overflow-wrap:anywhere] text-[13.5px] font-semibold leading-tight">
          {node.label}
        </span>
        <span className="block [overflow-wrap:anywhere] text-[10.5px] text-t3">{subtitle}</span>
      </span>
      <EvidencePill evidence={node.evidence} />
    </>
  );
}

/** "Configured" in the neutral chrome; "Not captured" muted and dashed. Never a status colour. */
function EvidencePill({ evidence }: { evidence: MartechNode["evidence"] }) {
  return (
    <span
      className={`inline-flex flex-none items-center rounded-full border px-2 py-[2px] text-[10px] font-semibold ${
        evidence === "configured" ? "border-line bg-hover text-t2" : "border-dashed border-line-strong text-t3"
      }`}
    >
      {EVIDENCE_LABEL[evidence]}
    </span>
  );
}

/* ---------- what happens here ---------- */

const P = ({ children }: { children: React.ReactNode }) => <p className="m-0 text-[12.5px] leading-[1.6] text-t1">{children}</p>;
const Hint = ({ children }: { children: React.ReactNode }) => <p className="mt-1.5 text-[11px] leading-[1.5] text-t3">{children}</p>;

function WhatHappensHere({ node, graph, stageName }: { node: MartechNode; graph: FunnelGraph; stageName: (id: string | null | undefined) => string | null }) {
  switch (node.kind) {
    case "ad":
      return node.inferred ? (
        <>
          <P>Traffic is assumed to come from {node.label}.</P>
          <Hint>{graph.adPlatform?.reason ?? "Inferred from conversion targets and attribution fields in the workflows."} Orrit reads nothing from the ad account itself.</Hint>
        </>
      ) : (
        <>
          <P>Where traffic comes from is not captured.</P>
          <Hint>No conversion target or attribution field in the captured workflows names an ad platform.</Hint>
        </>
      );
    case "page": {
      const p = node.page;
      if (!p) {
        return (
          <>
            <P>{node.stageId === "unplaced" ? "Automations whose trigger is not on any captured page." : "No page was captured for this step."}</P>
            {node.stageId !== "unplaced" && <Hint>The step exists in the funnel order but its page content was not read.</Hint>}
          </>
        );
      }
      const shot = p.screenshot;
      const shotText =
        shot?.status === "captured" ? `Screenshot captured ${ago(shot.capturedAt)}.` : shot?.status === "pending" ? "Screenshot is being captured." : `Screenshot not captured${shot?.reason ? ` — ${shot.reason}` : ""}.`;
      const others = p.variants.filter((v) => !v.isDefault);
      return (
        <>
          <P>
            {roleLabel(node.role) ? `${roleLabel(node.role)} page` : "Page"} of the {stageName(p.stageId) ?? "step"} step.
            {others.length > 0 ? ` ${others.length} A/B variant${others.length === 1 ? "" : "s"} configured.` : ""}
          </P>
          <div className="mt-2 flex flex-col">
            {p.url && <KvRow k="Public URL" v={<a href={p.url} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">{p.url.replace(/^https?:\/\//, "")}</a>} />}
            {p.nativeUrl && (
              <KvRow
                k="Builder"
                v={
                  <a href={p.nativeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                    Open in GHL <ExternalLink aria-hidden="true" className="size-3" />
                  </a>
                }
              />
            )}
            {others.map((v) => (
              <KvRow key={v.pageExternalId} k={`Variant · ${v.name}`} v={v.path ?? v.url ?? "—"} />
            ))}
          </div>
          <Hint>{shotText}</Hint>
        </>
      );
    }
    case "stage": {
      const s = node.stage;
      if (!s) return <P>Automations Orrit could not place on a page. They are listed here so nothing is hidden, and never guessed onto a step.</P>;
      return (
        <>
          <P>
            Step {node.position} of {node.total}{roleLabel(node.role) ? ` — ${roleLabel(node.role)}` : ""}.{s.purpose ? ` ${s.purpose}` : ""}
          </P>
          {s.origin === "manual" && <Hint>Documented manually — not captured from the platform.</Hint>}
          {s.origin === "suggested" && <Hint>Order read from the funnel directory in GoHighLevel.</Hint>}
        </>
      );
    }
    case "decision": {
      const d = node.decision;
      return (
        <>
          <P>The survey outcome decides where the lead goes next.</P>
          <ul className="mt-2 flex flex-col gap-1">
            {d.branches.map((b) => (
              <li key={b.outcome} className="flex items-center gap-2 text-[12px]">
                <span className={`flex-none rounded-full border px-1.5 py-[1px] text-[10px] font-semibold ${b.outcome === "disqualified" ? "border-[color-mix(in_srgb,var(--err)_40%,transparent)] text-err-text" : "border-line text-t2"}`}>
                  {b.outcome}
                </span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-t1">{stageName(b.toStageId) ?? "Destination not captured"}</span>
                <span className="flex-none text-[10.5px] text-t3">{b.conditionText ?? EVIDENCE_LABEL[b.evidence]}</span>
              </li>
            ))}
          </ul>
          <Hint>Read from the survey&apos;s disqualify logic and the funnel&apos;s branch relationship.</Hint>
        </>
      );
    }
    case "asset":
      return (
        <>
          <P>
            {ASSET_KIND_LABEL[node.asset.kind]} {node.source === "embed" ? "embedded on this page" : "referenced by a workflow trigger placed on this step"}.
          </P>
          {node.sharedWith.length > 0 && <Hint>Also on: {node.sharedWith.map((id) => stageName(id) ?? id).join(", ")}.</Hint>}
        </>
      );
    case "pixel":
      return (
        <>
          <P>Browser-side tracking for this page is not captured.</P>
          <Hint>{node.reason}</Hint>
        </>
      );
    case "trigger": {
      const t = node.automation.trigger;
      return (
        <>
          <P>
            {node.automation.name} starts when: {t.label}
            {t.asset?.label ? ` on ${t.asset.label}` : ""}.
          </P>
          <div className="mt-2 flex flex-col">
            <KvRow k="Trigger type" v={t.type} />
            {t.conditionText && <KvRow k="Condition" v={t.conditionText} />}
            {t.qualification && <KvRow k="Survey outcome" v={t.qualification} />}
          </div>
        </>
      );
    }
    default: {
      const a = node.action;
      if (!a) {
        return (
          <>
            <P>
              {node.overflow > 0 ? `${node.overflow} more action${node.overflow === 1 ? "" : "s"} in ${node.automation.name} are not drawn here.` : `${node.automation.name} has more actions than the API returned.`}
            </P>
            <Hint>Open the workflow to read the full sequence.</Hint>
          </>
        );
      }
      return (
        <>
          <P>
            Action {node.index + 1} of {node.automation.name}: {a.label}.
          </P>
          <div className="mt-2 flex flex-col">
            <KvRow k="Kind" v={ACTION_KIND_LABEL[a.kind]} />
            <KvRow k="Type" v={a.type} />
            {a.destinationSoftware && <KvRow k="Writes to" v={a.destinationSoftware} />}
            {a.conversion && <KvRow k="Conversion event" v={`${platformLabel(a.conversion.platform)} · ${a.conversion.eventName}`} />}
          </div>
          {a.conversion && <Hint>A configured Conversions API action — Orrit does not see whether the event was delivered.</Hint>}
        </>
      );
    }
  }
}

/* ---------- automations ---------- */

function AutomationRow({ automation }: { automation: FunnelAutomation }) {
  const href = workflowHref({ source: "ghl", refId: automation.workflowExternalId });
  return (
    <li className="flex flex-col gap-1 rounded-row border border-line2 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <Link href={href} className="min-w-0 flex-1 [overflow-wrap:anywhere] text-[12px] font-medium text-t1 underline-offset-4 hover:underline">
          {automation.name}
        </Link>
        <StatusPill pill={workflowStatusPill(automation.status)} dot={false} />
        {automation.captureState && <CaptureBadge capture={automation.captureState} compact />}
      </div>
      <div className="flex items-center gap-2 text-[10.5px] text-t3">
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {automation.trigger.label}
          {automation.trigger.conditionText ? ` · ${automation.trigger.conditionText}` : ""}
          {` · ${automation.actions.length}${automation.actionsTruncated ? "+" : ""} action${automation.actions.length === 1 && !automation.actionsTruncated ? "" : "s"}`}
        </span>
        {automation.nativeUrl && (
          <a href={automation.nativeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex flex-none items-center gap-1 font-semibold text-t2 underline-offset-4 hover:text-t1 hover:underline">
            Open in GHL <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        )}
      </div>
    </li>
  );
}

/* ---------- helpers ---------- */

function rawObject(node: MartechNode, graph: FunnelGraph): unknown {
  switch (node.kind) {
    case "ad":
      return graph.adPlatform;
    case "page":
      return node.page ?? { stageId: node.stageId, page: null };
    case "stage":
      return node.stage ?? { unplaced: graph.unplaced };
    case "decision":
      return node.decision;
    case "asset":
      return node.asset;
    case "pixel":
      return graph.tracking.find((t) => t.stageId === node.stageId) ?? { stageId: node.stageId, pixel: { state: "not-captured", reason: node.reason } };
    case "trigger":
      return node.automation;
    default:
      return node.action ?? { automationId: node.automation.id, actionsTruncated: node.automation.actionsTruncated, hidden: node.overflow };
  }
}

function platformLabel(platform: string): string {
  switch (platform) {
    case "meta":
      return "Meta";
    case "google":
      return "Google";
    case "tiktok":
      return "TikTok";
    default:
      return platform;
  }
}

function edgeVerb(e: MartechEdge): string {
  switch (e.kind) {
    case "spine":
    case "automation":
      return "then";
    case "branch":
      return "branches to";
    case "fires-on":
      return "triggers";
    case "conversion-report":
      return "reports to";
    case "shared-asset":
      return "same asset as";
    case "inferred":
      return "sends traffic to";
    default:
      return "leads to";
  }
}

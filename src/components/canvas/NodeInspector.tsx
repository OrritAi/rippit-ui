"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Bell, BellRing, Check, Copy, History, Link2, type LucideIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getConnector } from "@/lib/connectors";
import type { ProviderId } from "@/lib/connectors/types";
import type { ExecutionsResponse, Issue, ModuleInfo } from "@/app/lib/api";
import { appColor, appGlyph, appName } from "@/lib/apps";
import { DockHost } from "./DockHost";
import { JsonBlock, KvRow, Section } from "@/components/shared/DetailPanelKit";
import { IssuesSection } from "@/components/shared/IssuesSection";
import { TriggerConditions } from "@/components/shared/TriggerConditions";
import { AssetsSection, assetHref } from "@/components/shared/AssetsSection";
import { CommentsThread } from "@/components/shared/CommentsSection";
import { relativeTime } from "@/components/shared/RunsPanel";

/*
 * Node inspector — 300px dock for the selected step. Info (what it does ·
 * issues · runs · assets · raw config) / Actions / Comments. Runtime data
 * is workflow-level (Make only): the last run's status and timing, plus
 * "failed here" when the failing module is this one. Nothing is invented.
 */
export function NodeInspector({
  provider,
  workflowId,
  module,
  detail,
  loading,
  error,
  executions,
  nativeUrl,
  watching,
  onToggleWatch,
  onClose,
  onOpenRuns,
  commentCount,
  onCommentsChanged,
}: {
  provider: ProviderId;
  workflowId: string;
  module: ModuleInfo;
  detail: unknown | null;
  loading: boolean;
  error: boolean;
  executions: ExecutionsResponse | null;
  nativeUrl: string | null;
  watching: boolean;
  onToggleWatch: () => void;
  onClose: () => void;
  onOpenRuns?: () => void;
  commentCount: number;
  onCommentsChanged?: (open: number) => void;
}) {
  const connector = getConnector(provider);
  const router = useRouter();
  const nodeKey = String(module.id);
  // Tab resets to Info whenever a different step is selected (derived, not effect-set).
  const [tabState, setTabState] = useState<{ key: string; tab: string }>({ key: nodeKey, tab: "info" });
  const tab = tabState.key === nodeKey ? tabState.tab : "info";
  const setTab = (t: string) => setTabState({ key: nodeKey, tab: t });
  const [copied, setCopied] = useState(false);

  const desc = detail && !error ? connector.describeNode(detail) : null;
  const app = desc?.app ?? module.app ?? module.module;
  // Provider vocabulary: Make says "module", GHL says "step".
  const stepNoun = connector.nouns.step.charAt(0).toUpperCase() + connector.nouns.step.slice(1);
  const title = desc?.title ?? module.label ?? module.module;
  const color = appColor(app);
  const issues: Issue[] = module.issues ?? [];
  const Sections = connector.DetailSections;

  const latest = executions?.executions?.[0] ?? null;
  const failedHere = latest && latest.status === "error" && latest.causeModuleId != null && String(latest.causeModuleId) === nodeKey;
  const failures = executions?.executions?.filter((e) => e.status === "error" || e.status === "incomplete").length ?? 0;
  const health = failedHere ? "last run failed here" : issues.some((i) => i.severity === "error") ? "issue detected" : "no issues detected";

  const stepLink = typeof window !== "undefined" ? `${window.location.origin}/w/${provider}/${workflowId}?step=${encodeURIComponent(nodeKey)}` : "";

  const actions: { icon: LucideIcon; label: string; sub: string; onClick?: () => void; href?: string; hidden?: boolean }[] = [
    {
      icon: ArrowUpRight,
      label: `Open workflow in ${connector.shortLabel}`,
      sub: `Then find ${connector.nouns.step} ${desc?.ordinal ?? module.ordinal ?? "shown here"} — ${connector.shortLabel} has no per-step link`,
      href: nativeUrl ?? undefined,
      hidden: !nativeUrl,
    },
    {
      icon: copied ? Check : Copy,
      label: copied ? "Copied" : "Copy step link",
      sub: "Deep link for teammates — opens this step selected",
      onClick: () => {
        navigator.clipboard?.writeText(stepLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
    },
    {
      icon: watching ? BellRing : Bell,
      label: watching ? "Watching this workflow" : "Watch this workflow",
      sub: "Notified when it changes, fails or is commented on",
      onClick: onToggleWatch,
    },
    {
      icon: Link2,
      label: "Find asset uses",
      sub: "Every workflow touching this step's assets",
      hidden: !desc?.assets || desc.assets.length === 0,
      onClick: () => {
        const a = desc?.assets?.find((x) => !x.dynamic);
        if (a) router.push(assetHref(a.kind, a.value));
      },
    },
    {
      icon: History,
      label: "Run history",
      sub: `Recent runs of this ${connector.nouns.workflow} (${connector.shortLabel})`,
      hidden: provider !== "make" || !onOpenRuns,
      onClick: onOpenRuns,
    },
  ];

  return (
    <DockHost
      label={`${title} — ${connector.nouns.step} inspector`}
      width={300}
      dockKey={nodeKey}
      onClose={onClose}
      header={
        <>
          <span
            aria-hidden="true"
            className="inline-flex size-8 flex-none items-center justify-center rounded-[8px] border border-white/40 font-mono text-[11px] font-extrabold text-white"
            style={{ background: `color-mix(in oklab, ${color} 52%, #000)` }}
          >
            {loading ? "…" : appGlyph(app)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold leading-tight">{loading ? "Loading…" : error ? "Couldn’t load details" : title}</span>
            <span className="tabular block truncate font-mono text-[9.5px] text-t3">
              {desc?.ordinal ?? module.ordinal ? `${stepNoun} ${desc?.ordinal ?? module.ordinal} · ` : ""}{appName(app)}
              {/* Only assert a health state once details are actually loaded —
                  "no issues detected" while loading or failed is an unearned claim. */}
              {!loading && !error ? ` · ${health}` : ""}
            </span>
          </span>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex-none px-3.5 pt-2.5">
          <TabsList aria-label="Inspector sections" className="grid h-7 w-full grid-cols-3 rounded-control border border-line bg-hover p-[2px]">
            {[
              ["info", "Info"],
              ["actions", "Actions"],
              ["comments", `Comments${commentCount ? ` (${commentCount})` : ""}`],
            ].map(([v, l]) => (
              <TabsTrigger
                key={v}
                value={v}
                className="h-full rounded-[4px] text-[11.5px] font-semibold text-t3 transition-colors duration-[var(--dur-fast)] data-[state=active]:bg-pill data-[state=active]:text-t1 data-[state=active]:shadow-[var(--shadow-card)]"
              >
                {l}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="info" key={`info-${nodeKey}`} className="anim-fade-in min-h-0 flex-1 overflow-y-auto px-3.5 py-3" style={{ animationDuration: ".18s" }}>
          {loading && (
            <div role="status" className="flex items-center justify-center py-10">
              <span aria-hidden="true" className="spin size-5 rounded-full border-2 border-t1 border-t-transparent" />
              <span className="sr-only">Loading details</span>
            </div>
          )}
          {error && (
            <p role="alert" className="py-6 text-center text-[13px] text-t2">
              The details for this {connector.nouns.step} couldn’t be fetched. Close and try again.
            </p>
          )}
          {!loading && !error && (
            <>
              <Section title="What it does">
                <p className="m-0 text-[12.5px] leading-[1.6] text-t1">
                  {(() => {
                    const s = desc?.summary || module.summary || `${appName(app)} ${connector.nouns.step}`;
                    return /[.!?]$/.test(s) ? s : `${s}.`;
                  })()}
                  {desc?.filterName || module.filterName ? ` Only continues when ${desc?.filterName || module.filterName}.` : module.hasFilter ? " Has a filter." : ""}
                  {desc?.waitText || module.waitFor?.text ? ` Waits ${desc?.waitText || module.waitFor?.text}.` : ""}
                </p>
                {(desc?.ordinal || module.ordinal) && (
                  <p className="mt-1 font-mono text-[10.5px] text-t3">fires at position {desc?.ordinal || module.ordinal}</p>
                )}
              </Section>
              <IssuesSection issues={issues} onFindUses={(ref) => router.push(assetHref(ref.kind, ref.value))} />
              {/* Runtime exists for Make only — no empty placeholder section elsewhere. */}
              {provider === "make" && (
              <Section title="Runs">
                {!executions ? (
                  <p className="text-[12px] text-t3">Loading runs…</p>
                ) : !executions.supported ? (
                  <p className="text-[12px] text-t3">{executions.reason ?? "Runtime status not available."}</p>
                ) : executions.executions.length === 0 ? (
                  <p className="text-[12px] text-t3">No runs in the platform’s retained history.</p>
                ) : (
                  <div className="flex flex-col">
                    {failedHere && (
                      <div className="mb-2 flex items-start gap-2 rounded-row border px-2.5 py-2" style={{ borderColor: "color-mix(in srgb, var(--err) 40%, transparent)", background: "color-mix(in srgb, var(--err) 8%, transparent)" }}>
                        <p className="m-0 text-[12px] leading-[1.5] text-err-text">
                          Last run failed <strong>here</strong>
                          {latest?.errorMessage ? `: ${latest.errorMessage}` : ""}
                        </p>
                      </div>
                    )}
                    <KvRow k="Last run" v={`${latest?.status ?? "—"} · ${relativeTime(latest?.startedAt ?? null)}`} />
                    {latest?.durationMs != null && <KvRow k="Duration" v={`${latest.durationMs} ms`} />}
                    <KvRow k={`Failures · last ${executions.executions.length}`} v={String(failures)} />
                    <p className="mt-1.5 text-[10.5px] text-t3">Workflow-level — {connector.shortLabel} does not expose per-{connector.nouns.step} timings.</p>
                  </div>
                )}
              </Section>
              )}
              <TriggerConditions data={detail} assets={desc?.assets} />
              <AssetsSection assets={desc?.assets} />
              <details className="mt-3 rounded-control border border-line p-2.5">
                <summary className="cursor-pointer text-[12px] font-semibold text-t2">Advanced Details</summary>
                <p className="my-2 text-[11px] text-t3">Technical identifiers and source configuration.</p>
                {detail ? <Sections data={detail} /> : <JsonBlock data={null} />}
              </details>
            </>
          )}
        </TabsContent>
        <TabsContent value="actions" key={`actions-${nodeKey}`} className="anim-fade-in min-h-0 flex-1 overflow-y-auto px-3.5 py-3" style={{ animationDuration: ".18s" }}>
          <div className="flex flex-col gap-1.5">
            {actions
              .filter((a) => !a.hidden)
              .map((a) => {
                const Icon = a.icon;
                const inner = (
                  <>
                    <span className="inline-flex size-[26px] flex-none items-center justify-center rounded-control border border-line bg-hover text-t2">
                      <Icon aria-hidden="true" className="size-3" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-semibold text-t1">{a.label}</span>
                      <span className="block text-[10.5px] leading-[1.4] text-t3">{a.sub}</span>
                    </span>
                  </>
                );
                const cls =
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-row border border-line bg-transparent px-[11px] py-[9px] text-left transition-[background,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-line-strong hover:bg-hover";
                return a.href ? (
                  <a key={a.label} href={a.href} target="_blank" rel="noopener noreferrer" className={cls}>
                    {inner}
                  </a>
                ) : (
                  <button key={a.label} type="button" onClick={a.onClick} className={cls}>
                    {inner}
                  </button>
                );
              })}
          </div>
        </TabsContent>
        <TabsContent value="comments" key={`comments-${nodeKey}`} className="anim-fade-in min-h-0 flex-1 overflow-y-auto px-3.5 py-3" style={{ animationDuration: ".18s" }}>
          <CommentsThread targetType="node" targetKey={`node:${provider}:${workflowId}:${nodeKey}`} compact onCountChange={(open) => onCommentsChanged?.(open)} />
        </TabsContent>
      </Tabs>
    </DockHost>
  );
}

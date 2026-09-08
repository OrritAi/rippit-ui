"use client";

import { useRouter } from "next/navigation";
import { getConnector } from "@/lib/connectors";
import type { ProviderId } from "@/lib/connectors/types";
import type { ExecutionsResponse, Issue, ModuleInfo } from "@/app/lib/api";
import { appColor, appGlyph, appName } from "@/lib/apps";
import { DockHost } from "./DockHost";
import { JsonBlock, KvRow, Section } from "@/components/shared/DetailPanelKit";
import { IssuesSection } from "@/components/shared/IssuesSection";
import { TriggerConditions } from "@/components/shared/TriggerConditions";
import { AssetsSection, assetHref } from "@/components/shared/AssetsSection";
import { SurveyStructureView } from "@/components/shared/SurveyStructure";
import { SoftwareLogo } from "@/components/shared/SoftwareLogo";
import { relativeTime } from "@/components/shared/RunsPanel";

/*
 * Node inspector — 300px dock for the selected step. Info only: what it does,
 * issues, runs, trigger conditions, assets, and raw config under Advanced
 * Details. Runtime data is workflow-level (Make only): the last run's status
 * and timing, plus "failed here" when the failing module is this one. Nothing
 * is invented. (Some props are still accepted for call-site compatibility but
 * are unused now that the inspector is a pure info view.)
 */
export function NodeInspector({
  provider,
  module,
  detail,
  loading,
  error,
  executions,
  onClose,
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
            {loading ? "…" : <SoftwareLogo app={app} fallback={appGlyph(app)} size={18} />}
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
      <div className="anim-fade-in min-h-0 flex-1 overflow-y-auto px-3.5 py-3" style={{ animationDuration: ".18s" }}>
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
            {/* Survey internals (slides · questions · disqualify logic) when a
                trigger asset is a captured GHL survey. */}
            {desc?.assets?.map((a) =>
              a.structure ? <SurveyStructureView key={`survey-${a.value}`} structure={a.structure} /> : null
            )}
            <details className="mt-3 rounded-control border border-line p-2.5">
              <summary className="cursor-pointer text-[12px] font-semibold text-t2">Advanced Details</summary>
              <p className="my-2 text-[11px] text-t3">Technical identifiers and source configuration.</p>
              {detail ? <Sections data={detail} /> : <JsonBlock data={null} />}
            </details>
          </>
        )}
      </div>
    </DockHost>
  );
}

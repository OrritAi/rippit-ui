"use client";

import { useEffect, useState } from "react";
import { parsePortalId } from "@/lib/portals";
import Link from "next/link";
import { getConnector } from "@/lib/connectors";
import type { WorkflowData } from "@/lib/connectors/types";
import type { NodeId } from "@/app/lib/api";
import type { WorkflowRef } from "@/lib/portals";
import { workflowHref } from "@/lib/portals";
import { DockHost, DockTitle } from "./DockHost";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { TriggerConditions } from "@/components/shared/TriggerConditions";
import { AssetsSection } from "@/components/shared/AssetsSection";
import { AppPuck } from "@/components/shared/AppPuck";

/** Expand a linked scenario without navigating away from the originating workflow. */
export function LinkedWorkflowPanel({ target, onClose }: { target: WorkflowRef; onClose: () => void }) {
  const connector = getConnector(target.source);
  const [data, setData] = useState<WorkflowData | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [detailState, setDetailState] = useState<{ id: string; data?: unknown; error?: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    connector.loadWorkflow(target.refId).then(d => { if (live) { setData(d); setError(false); } }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [connector, target.refId, retry]);
  useEffect(() => {
    if (selected == null) return;
    let live = true;
    connector.fetchNodeDetail(target.refId, selected).then(data => { if (live) setDetailState({ id: String(selected), data }); }).catch(() => { if (live) setDetailState({ id: String(selected), error: true }); });
    return () => { live = false; };
  }, [connector, target.refId, selected]);
  const current = detailState?.id === String(selected) ? detailState : null;
  const desc = current?.data ? connector.describeNode(current.data) : null;
  const Sections = connector.DetailSections;
  return <DockHost label="Linked workflow steps" width={560} dockKey={`linked:${target.source}:${target.refId}`} onClose={onClose} header={<DockTitle icon={<AppPuck app={target.source} />} title={data?.summary.name || `Linked ${connector.nouns.workflow}`} subtitle="Expanded here · your original workflow stays open" />}>
    {error ? <div role="alert" className="p-4 text-[13px]">Could not load the linked workflow. <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Retry</button></div> : !data ? <p role="status" className="p-4 text-[13px]">Loading steps…</p> : <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex gap-4 border-b border-line p-3 text-[12px]"><Link href={workflowHref(target)} className="underline">Open full canvas</Link>{data.summary.nativeUrl && <a href={data.summary.nativeUrl} target="_blank" rel="noopener noreferrer" className="underline">Open in {connector.shortLabel} ↗</a>}</div>
      {data.summary.stepsUnavailable ? <p className="p-4 text-[13px]">This connection does not provide workflow steps.</p> : <div className="relative min-h-[320px] flex-1"><WorkflowCanvas provider={target.source} workflowId={target.refId} revision={retry} modules={data.summary.modules} connections={data.summary.connections} selectedId={selected} onNodeClick={(id) => { if (!parsePortalId(id)) setSelected(id); }} entrance={false} /></div>}
      {selected != null && <div className="max-h-72 flex-none overflow-y-auto border-t border-line p-4 text-[13px]">
        {!current ? <p role="status">Loading step…</p> : current.error ? <p role="alert">Could not load this step. Select another step and try again.</p> : <><h3 className="font-semibold">{desc?.title}</h3><p className="mt-1 text-t2">{desc?.summary || "An explanation is not available for this step yet."}</p><TriggerConditions data={current.data} assets={desc?.assets} /><AssetsSection assets={desc?.assets} /><details className="mt-3"><summary className="cursor-pointer font-semibold">Advanced Details</summary><Sections data={current.data} /></details></>}
      </div>}
    </div>}
  </DockHost>;
}

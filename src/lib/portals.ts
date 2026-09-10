/*
 * Workflow references: the "{source}:{refId}" identity that the link map,
 * the workflow map and the /w/{provider}/{id} routes agree on.
 */

import type { LinkMap, NodeId, WorkflowLink } from "@/app/lib/api";
import { isProviderId } from "@/lib/connectors";
import type { ProviderId } from "@/lib/connectors/types";

export interface WorkflowRef {
  source: ProviderId;
  refId: string;
}

export function keyOf(ref: WorkflowRef): string {
  return `${ref.source}:${ref.refId}`;
}

/** Parse a "{source}:{refId}" workflow-card id (unified map nodes). */
export function parseWorkflowId(id: NodeId): WorkflowRef | null {
  const s = String(id);
  const sep = s.indexOf(":");
  if (sep < 0) return null;
  const source = s.slice(0, sep);
  if (!isProviderId(source)) return null;
  return { source, refId: s.slice(sep + 1) };
}

export function workflowHref(ref: WorkflowRef): string {
  return `/w/${ref.source}/${ref.refId}`;
}

const same = (a: WorkflowRef, b: { source: string; refId: string }) =>
  a.source === b.source && a.refId === b.refId;

/** The links (in either direction) that touch one workflow. */
export function linksFor(linkMap: LinkMap, self: WorkflowRef): WorkflowLink[] {
  return linkMap.links.filter(
    (l) => same(self, l.from) || same(self, l.to)
  );
}

import { getConnector } from "@/lib/connectors";
import type { ProviderId } from "@/lib/connectors/types";
import { parseKey } from "@/lib/workflowMap/model";
import type { MapNode } from "@/lib/workflowMap/types";

/*
 * Where a node lives on its platform. Pills link to their own workflow;
 * steps, routes and markers link to the workflow that owns them (neither
 * Make nor GoHighLevel has per-step deep links — the title says so). The
 * model supplies the summary's nativeUrl; before that summary is loaded the
 * connector's URL builder fills in when it can. `href` is null when nothing
 * is derivable, and the control renders disabled rather than vanishing.
 */
export interface NodeLink {
  href: string | null;
  /** "Make" | "GHL" */
  platform: string;
  label: string;
  title: string;
}

export function nodeLink(node: MapNode): NodeLink {
  const source: ProviderId | null = node.ref?.source ?? (node.stepRef ? (parseKey(node.stepRef.key)?.source ?? null) : null);
  const refId = node.ref?.refId ?? (node.stepRef ? (parseKey(node.stepRef.key)?.refId ?? null) : null);
  const connector = source ? getConnector(source) : null;
  const platform = connector?.shortLabel ?? "platform";
  const href = node.nativeUrl ?? (connector && refId ? (connector.nativeUrl?.(refId) ?? null) : null);
  const label = `Open in ${platform}`;
  const title = !href
    ? "No editor link for this platform yet"
    : node.pill
      ? label
      : `${label} · opens the ${connector?.nouns.workflow ?? "workflow"}`;
  return { href, platform, label, title };
}

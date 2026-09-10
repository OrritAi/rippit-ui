import { fetchConnectionWorkflows, fetchNodeDetail, fetchWorkflowSummary } from "@/app/lib/api";
import CfStepDetailSections, { describeCfNode } from "@/components/connectors/clickfunnels/StepDetailPanel";
import type { ConnectorDescriptor, StatusPillInfo } from "./types";
import { byName } from "./index";

/** ClickFunnels 2.0 workflow status → pill. `live` is the only running state. */
export function cfStatusPill(status: string | null | undefined): StatusPillInfo {
  switch (status) {
    case "live":
      return { label: "Live", tone: "ok" };
    case "disabled":
      return { label: "Paused", tone: "warn" };
    case "archived":
      return { label: "Archived", tone: "muted" };
    default:
      return { label: "Draft", tone: "muted" };
  }
}

export const clickfunnelsConnector: ConnectorDescriptor = {
  id: "clickfunnels",
  label: "ClickFunnels 2.0",
  shortLabel: "CF 2.0",
  description: "Workflows, triggers, funnels and pages from a ClickFunnels 2.0 workspace, over the official API.",
  brandColor: "#e8552f",
  glyph: "CF",
  nouns: {
    workflow: "workflow",
    workflowPlural: "workflows",
    step: "step",
    stepPlural: "steps",
    container: "workspace",
  },
  connect: {
    type: "form",
    fields: [
      {
        name: "apiToken",
        label: "API access token",
        placeholder: "Team Settings → Developer Portal → platform application",
        secret: true,
      },
      {
        name: "workspaceSubdomain",
        label: "Workspace subdomain",
        placeholder: "acme  (from acme.myclickfunnels.com)",
      },
    ],
    helpText:
      "In ClickFunnels open Team Settings → Developer Portal, add a platform application and copy an API access token. " +
      "The token reaches every workspace on the team; the subdomain says which one to document. " +
      "API access needs the Scale, Optimize, Dominate or Agency plan. Rippit only reads.",
  },

  async fetchTree(conn) {
    const workspace = conn.displayName || conn.label || conn.externalId;
    const rows = await fetchConnectionWorkflows(conn.id);
    return [
      {
        id: `workspace:${conn.externalId}`,
        label: `CF 2.0 · ${workspace}`,
        items: byName(
          rows.map((w) => ({
            refId: w.external_id,
            name: w.name,
            live: w.is_active ?? w.status === "live",
            status: w.status,
            app: "clickfunnels",
            groupPath: [workspace],
          }))
        ),
      },
    ];
  },

  async loadWorkflow(id, fresh = false) {
    const summary = await fetchWorkflowSummary("clickfunnels", id, fresh);
    return { summary, meta: { statusPill: cfStatusPill(summary.status) } };
  },

  fetchNodeDetail(workflowId, nodeId) {
    return fetchNodeDetail("clickfunnels", workflowId, String(nodeId));
  },

  DetailSections: CfStepDetailSections,
  describeNode: describeCfNode,

  headerStats({ summary }) {
    const triggers = summary.modules.filter((m) => m.kind === "trigger").length;
    return [
      { label: "Steps", value: String(summary.totalModules - triggers) },
      { label: "Triggers", value: String(triggers) },
      { label: "Connections", value: String(summary.connections.length) },
    ];
  },

  incomingAnchor(modules) {
    const trigger = modules.find((m) => m.kind === "trigger");
    return trigger?.id ?? modules[0]?.id ?? null;
  },
};

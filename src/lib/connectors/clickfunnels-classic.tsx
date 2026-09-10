import { fetchNodeDetail, fetchWorkflowSummary } from "@/app/lib/api";
import CfStepDetailSections, { describeCfNode } from "@/components/connectors/clickfunnels/StepDetailPanel";
import type { ConnectorDescriptor } from "./types";

/*
 * ClickFunnels Classic (1.0). Its API exposes funnels, pages, contacts and
 * purchases but no automation content, so a Classic connection documents
 * funnels (on the funnels page) and lists no workflows in the browser. The
 * workflow-shaped methods exist for the contract and render an honest empty
 * canvas if a route is ever reached directly.
 */
export const clickfunnelsClassicConnector: ConnectorDescriptor = {
  id: "clickfunnels_classic",
  label: "ClickFunnels Classic",
  shortLabel: "CF Classic",
  description: "Funnels, steps and pages from a ClickFunnels Classic account. Classic's API carries no automations.",
  brandColor: "#b45309",
  glyph: "C1",
  nouns: {
    workflow: "funnel",
    workflowPlural: "funnels",
    step: "page",
    stepPlural: "pages",
    container: "account",
  },
  connect: {
    type: "form",
    fields: [
      {
        name: "apiToken",
        label: "API key or access token",
        placeholder: "Account Settings → Integrations → API",
        secret: true,
      },
    ],
    helpText:
      "Classic's API (v1) is deprecated by ClickFunnels but still served. It returns funnels, their steps and pages — " +
      "not Follow-Up Funnel automations, which are not on the API at all. Captured funnels appear on the funnels page.",
  },

  async fetchTree(conn) {
    const account = conn.displayName || conn.label || conn.externalId;
    // No workflow API on Classic — the tree section exists so the connection
    // is visible where every other one is; its funnels live on /martech.
    return [{ id: `account:${conn.externalId}`, label: `CF Classic · ${account}`, items: [] }];
  },

  async loadWorkflow(id, fresh = false) {
    const summary = await fetchWorkflowSummary("clickfunnels_classic", id, fresh);
    return { summary, meta: { statusPill: { label: "Funnel", tone: "muted" as const } } };
  },

  fetchNodeDetail(workflowId, nodeId) {
    return fetchNodeDetail("clickfunnels_classic", workflowId, String(nodeId));
  },

  DetailSections: CfStepDetailSections,
  describeNode: describeCfNode,

  headerStats({ summary }) {
    return [{ label: "Steps", value: String(summary.totalModules) }];
  },

  incomingAnchor(modules) {
    return modules[0]?.id ?? null;
  },
};

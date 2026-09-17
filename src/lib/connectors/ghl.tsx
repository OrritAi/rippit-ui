import {
  fetchConnectionWorkflows,
  fetchGhlStepDetail,
  fetchGhlWorkflowSummary,
} from "@/app/lib/api";
import StepDetailSections, { describeGhlStep } from "@/components/connectors/ghl/StepDetailPanel";
import type { ConnectorDescriptor } from "./types";
import { byName } from "./index";

export const ghlConnector: ConnectorDescriptor = {
  id: "ghl",
  label: "HighLevel",
  shortLabel: "GHL",
  description:
    "Workflows, triggers, and webhook steps from your GoHighLevel location.",
  brandColor: "#0ea5e9",
  glyph: "GH",
  nouns: {
    workflow: "workflow",
    workflowPlural: "workflows",
    step: "step",
    stepPlural: "steps",
    container: "location",
  },
  connect: {
    type: "bookmarklet",
    instructions: [
      "Drag the button below to your bookmarks bar.",
      "Open GoHighLevel in another tab and sign in.",
      "Click the Orrit bookmark — you’ll land back here.",
      "Choose which sub-accounts to connect.",
    ],
  },

  async fetchTree(conn) {
    const location = conn.displayName || conn.label || conn.externalId;
    const rows = await fetchConnectionWorkflows(conn.id);
    const item = (w: (typeof rows)[number]) => ({
      refId: w.external_id,
      name: w.name,
      live: w.is_active ?? w.status === "published",
      status: w.status,
      app: "ghl",
      groupPath: w.folder ? [location, w.folder] : [location],
    });
    // Group by GHL directory (folder); unfoldered workflows stay at the root.
    const byFolder = new Map<string, { label: string; rows: typeof rows }>();
    const loose: typeof rows = [];
    for (const w of rows) {
      if (w.folder) {
        const key = w.folder_id || w.folder;
        const bucket = byFolder.get(key) ?? { label: w.folder, rows: [] };
        bucket.rows.push(w);
        byFolder.set(key, bucket);
      } else {
        loose.push(w);
      }
    }
    return [
      {
        id: `location:${conn.externalId}`,
        label: `GHL · ${location}`,
        items: byName(loose.map(item)),
        folders: [...byFolder.entries()]
          .sort((a, b) => a[1].label.localeCompare(b[1].label))
          .map(([id, bucket]) => ({
            id: `dir:${id}`,
            label: bucket.label,
            items: byName(bucket.rows.map(item)),
          })),
      },
    ];
  },

  async loadWorkflow(id, fresh = false) {
    const summary = await fetchGhlWorkflowSummary(id, fresh);
    return {
      summary,
      meta: {
        statusPill:
          summary.status === "published"
            ? { label: "Published", tone: "ok" as const }
            : { label: summary.status || "Draft", tone: "muted" as const },
      },
    };
  },

  fetchNodeDetail(workflowId, nodeId) {
    return fetchGhlStepDetail(workflowId, String(nodeId));
  },

  DetailSections: StepDetailSections,
  describeNode: describeGhlStep,

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

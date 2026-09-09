import { createElement } from "react";
import { Calendar, FileSpreadsheet, FileText, FolderOpen, GitBranch, Link2, MessageSquare, Table, Tag, Webhook, Workflow, type LucideIcon } from "lucide-react";

/* Icon + "open in …" copy per asset kind (matches the API's ref kinds). */
export function kindIcon(kind: string): LucideIcon {
  if (kind.startsWith("google_sheet")) return Table;
  if (kind.startsWith("google_doc")) return FileText;
  if (kind.startsWith("google_drive")) return FolderOpen;
  if (kind === "webhook_url" || kind === "endpoint") return Webhook;
  if (kind.startsWith("ghl_pipeline")) return GitBranch;
  if (kind === "ghl_calendar") return Calendar;
  if (kind === "ghl_tag") return Tag;
  if (kind === "ghl_workflow") return Workflow;
  if (kind === "ghl_template" || kind === "ghl_campaign") return MessageSquare;
  if (kind.startsWith("cf_pipeline")) return GitBranch;
  if (kind === "cf_tag") return Tag;
  if (kind === "cf_workflow") return Workflow;
  if (kind === "cf_email_template" || kind === "cf_sender") return MessageSquare;
  if (kind === "cf_page" || kind === "cf_funnel") return FileText;
  if (kind.startsWith("airtable") || kind.startsWith("notion")) return FileSpreadsheet;
  return Link2;
}

export function openLabel(kind: string): string {
  if (kind.startsWith("google_sheet")) return "Open in Google Sheets";
  if (kind.startsWith("google_doc")) return "Open in Google Docs";
  if (kind.startsWith("google_drive")) return "Open in Google Drive";
  if (kind.startsWith("ghl_")) return "Open in GHL";
  if (kind.startsWith("cf_")) return "Open in ClickFunnels";
  if (kind.startsWith("airtable")) return "Open in Airtable";
  if (kind.startsWith("notion")) return "Open in Notion";
  if (kind.startsWith("slack")) return "Open in Slack";
  return "Open asset";
}

/** Render the kind's icon (avoids creating component identifiers in render). */
export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  return createElement(kindIcon(kind), { "aria-hidden": true, className });
}

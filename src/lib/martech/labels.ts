import {
  Calendar,
  ClipboardList,
  Database,
  FileText,
  Hourglass,
  Kanban,
  Megaphone,
  MessageSquare,
  MousePointerClick,
  Radar,
  Send,
  Split,
  Tag,
  Target,
  UserPlus,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type {
  Evidence,
  FunnelActionKind,
  FunnelAutomationAction,
  FunnelAutomationTrigger,
  FunnelPageAsset,
  FunnelStageRole,
} from "@/app/lib/api";

/*
 * Copy and glyphs for the Martech view. The vocabulary is deliberately
 * small: a node is "Configured" or "Not captured". Nothing here says fires,
 * healthy or working — Rippit reads configuration, it does not observe runs.
 */

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  configured: "Configured",
  "not-captured": "Not captured",
};

export const ROLE_LABEL: Record<FunnelStageRole, string> = {
  optin: "Opt-in",
  application: "Application",
  booking: "Booking",
  confirmation: "Confirmation",
  disqualified: "Disqualified",
  other: "Page",
};

export function roleLabel(role: FunnelStageRole | null | undefined): string | null {
  return role ? ROLE_LABEL[role] : null;
}

/** Browser tracking is not captured in this slice; the facet says so. */
export const PIXEL_REASON = "Tracking code is not captured yet";

/** Actions shown per automation before the "+k more" card. */
export const ACTIONS_MAX = 6;

/** Above this many nodes the canvas drops thumbnails, stagger and pills. */
export const LITE_AT = 120;

export const ASSET_KIND_LABEL: Record<FunnelPageAsset["kind"], string> = {
  form: "Form",
  survey: "Survey",
  calendar: "Calendar",
};

export function assetIcon(kind: FunnelPageAsset["kind"]): LucideIcon {
  if (kind === "survey") return ClipboardList;
  if (kind === "calendar") return Calendar;
  return FileText;
}

export function actionIcon(kind: FunnelActionKind): LucideIcon {
  switch (kind) {
    case "crm":
      return Database;
    case "pipeline":
      return Kanban;
    case "message":
      return Send;
    case "conversion":
      return Target;
    case "enroll":
      return Workflow;
    case "wait":
      return Hourglass;
    default:
      return Zap;
  }
}

export const ACTION_KIND_LABEL: Record<FunnelActionKind, string> = {
  crm: "CRM update",
  pipeline: "Pipeline change",
  message: "Message",
  conversion: "Server conversion",
  enroll: "Workflow enrolment",
  wait: "Wait",
  other: "Action",
};

/** Software key the action writes to — the logo on the card. */
export function actionSoftware(action: FunnelAutomationAction): string {
  if (action.destinationSoftware) return action.destinationSoftware;
  if (action.conversion) return action.conversion.platform;
  return "ghl";
}

export function triggerIcon(trigger: FunnelAutomationTrigger): LucideIcon {
  const t = trigger.type.toLowerCase();
  if (t.includes("survey")) return ClipboardList;
  if (t.includes("form")) return FileText;
  if (t.includes("appointment") || t.includes("calendar")) return Calendar;
  if (t.includes("tag")) return Tag;
  if (t.includes("contact")) return UserPlus;
  if (t.includes("pipeline") || t.includes("opportunity")) return Kanban;
  if (t.includes("reply") || t.includes("message")) return MessageSquare;
  return MousePointerClick;
}

export const NODE_KIND_ICON: Record<"ad" | "decision" | "pixel" | "trigger" | "stage" | "page", LucideIcon> = {
  ad: Megaphone,
  decision: Split,
  pixel: Radar,
  trigger: MousePointerClick,
  stage: Workflow,
  page: FileText,
};

export function adPlatformLabel(destination: string | null | undefined): string {
  switch (destination) {
    case "meta":
      return "Meta Ads";
    case "google":
      return "Google Ads";
    case "tiktok":
      return "TikTok Ads";
    default:
      return "Ad platform";
  }
}

/** Software key for the ad platform's logo. */
export function adPlatformSoftware(destination: string | null | undefined): string | null {
  if (destination === "meta" || destination === "google") return destination;
  return null;
}

export function workflowStatusPill(status: string | null | undefined): { label: string; tone: "ok" | "muted" } {
  return status === "published" || status === "active" ? { label: "live", tone: "ok" } : { label: "draft", tone: "muted" };
}

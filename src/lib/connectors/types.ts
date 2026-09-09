/*
 * Connector registry types — the single home of the provider union and the
 * descriptor shape every platform (Make, GHL, future: Zapier/n8n/Close…)
 * implements. UI code never branches on a provider id directly; it looks the
 * behavior up on the descriptor.
 */

import type { ComponentType } from "react";
import type { ModuleInfo, NodeId, ScenarioSummary } from "@/app/lib/api";

export type ProviderId = "make" | "ghl" | "clickfunnels" | "clickfunnels_classic";

/** Platform vocabulary, so copy reads natively per connector. */
export interface ConnectorNouns {
  workflow: string;
  workflowPlural: string;
  step: string;
  stepPlural: string;
  container: string; // "organization" | "location" | …
}

export interface ConnectField {
  name: string;
  label: string;
  placeholder: string;
  secret?: boolean;
}

export type ConnectMethod =
  | { type: "form"; fields: ConnectField[]; helpText?: string }
  | { type: "extension"; instructions: string[] }
  /** Drag a button to the bookmarks bar, click it on a logged-in provider tab.
   *  No install, no store review, and it works in any browser. */
  | { type: "bookmarklet"; instructions: string[] }
  | { type: "oauth" };

export interface StatusPillInfo {
  label: string;
  tone: "ok" | "warn" | "muted";
}

export interface WorkflowMeta {
  /** Small mono chip next to the title, e.g. Make's "#912". */
  idChip?: string;
  statusPill: StatusPillInfo;
  lastEdit?: string | null;
}

export interface WorkflowData {
  summary: ScenarioSummary;
  meta: WorkflowMeta;
}

/** What the inspector shows above the tabs, extracted from a node detail payload. */
export interface NodeDescription {
  title: string;
  app: string;
  kindLabel: string; // "module" | "trigger" | "step" …
  summary?: string | null;
  ordinal?: string | null;
  waitText?: string | null;
  assets?: import("@/app/lib/api").AssetRef[];
  filterName?: string | null;
}

/**
 * Body of the node inspector's Info tab — provider-specific sections only
 * (identity, filter, mapper, attributes…). The shared parts (what it does,
 * issues, assets, comments, runs) are rendered by NodeInspector itself.
 */
export interface DetailSectionsProps {
  data: unknown;
}

/** Minimal connection info descriptors need (avoids importing the store). */
export interface ConnectionRef {
  id: string; // backend uuid, or "legacy:{provider}:{externalId}"
  externalId: string;
  label: string | null;
  /** Account name to show (never a bare id when the API resolved one). */
  displayName?: string;
}

export interface NavItem {
  refId: string;
  name: string;
  live?: boolean;
  status?: string | null;
  /** App identity for the row dot (Make: first used package). */
  app?: string;
  groupPath: string[];
}

export interface NavFolder {
  id: string;
  label: string;
  items: NavItem[];
}

export interface NavGroup {
  id: string;
  label: string;
  /** Items not inside any folder. */
  items: NavItem[];
  folders?: NavFolder[];
}

export interface ConnectorDescriptor {
  id: ProviderId;
  label: string; // "Make"
  shortLabel: string; // "Make" | "GHL"
  description: string; // one-liner for connector cards
  brandColor: string;
  glyph: string;
  nouns: ConnectorNouns;
  connect: ConnectMethod;

  /** Sidebar/palette tree for one connection of this provider. */
  fetchTree(conn: ConnectionRef): Promise<NavGroup[]>;

  /** Load everything the workflow page needs (canvas summary + header meta). */
  loadWorkflow(id: string, fresh?: boolean): Promise<WorkflowData>;
  fetchNodeDetail(workflowId: string, nodeId: NodeId): Promise<unknown>;
  /** Provider-specific "raw config" sections for a node detail payload. */
  DetailSections: ComponentType<DetailSectionsProps>;
  /** Normalise a node detail payload to the fields the inspector header needs. */
  describeNode(data: unknown): NodeDescription;
  headerStats(data: WorkflowData): { label: string; value: string }[];

  /**
   * Where an incoming cross-workflow link should anchor on this platform's
   * canvas (Make: the webhook trigger module; GHL: the first trigger node).
   */
  incomingAnchor(modules: ModuleInfo[], hookId?: number): NodeId | null;

  /** Deep link to the platform's own editor, when derivable. */
  nativeUrl?(refId: string): string | null;
}

/* Unified-graph grouped-layout contract (canvas `groups` prop). */
export interface UnifiedGroup {
  id: string; // "make:912" | "ghl:<wfId>" — prefixes its member node ids
  source: ProviderId;
  name: string;
  refId: string;
}

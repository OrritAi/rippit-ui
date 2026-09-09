import { makeConnector } from "./make";
import { ghlConnector } from "./ghl";
import { clickfunnelsConnector } from "./clickfunnels";
import { clickfunnelsClassicConnector } from "./clickfunnels-classic";
import type { ConnectorDescriptor, ProviderId } from "./types";

export * from "./types";

/** Registered connectors, in display order. Adding a platform = one entry. */
export const CONNECTORS: Record<ProviderId, ConnectorDescriptor> = {
  make: makeConnector,
  ghl: ghlConnector,
  clickfunnels: clickfunnelsConnector,
  clickfunnels_classic: clickfunnelsClassicConnector,
};

export function allConnectors(): ConnectorDescriptor[] {
  return Object.values(CONNECTORS);
}

export function getConnector(id: ProviderId): ConnectorDescriptor {
  return CONNECTORS[id];
}

export function isProviderId(s: string): s is ProviderId {
  return s in CONNECTORS;
}

export function providerColor(id: ProviderId): string {
  return CONNECTORS[id].brandColor;
}

export function providerLabel(id: ProviderId): string {
  return CONNECTORS[id].label;
}

/** "Make · Acme Org" — platform + account, never a bare id when one is known. */
export function connectionTitle(conn: { provider: ProviderId; displayName?: string; label?: string | null; externalId: string }): string {
  return `${CONNECTORS[conn.provider].shortLabel} · ${conn.displayName || conn.label || conn.externalId}`;
}

/**
 * Tooltip copy for canvas node badges. Badges reference the platform a node
 * talks to, so the copy is resolved centrally rather than per-descriptor.
 * Supports the generic "talksTo:<provider>" form alongside legacy names.
 */
export function badgeTooltip(badge: string): string | null {
  if (badge === "deadLink") return "Link target is missing or disabled";
  if (badge === "unmatchedLink")
    return `Webhook target not found in ${CONNECTORS.make.label}`;
  if (badge === "talksToGhl") return `Calls ${CONNECTORS.ghl.shortLabel}`;
  if (badge.startsWith("talksTo:")) {
    const id = badge.slice("talksTo:".length);
    return isProviderId(id) ? `Calls ${CONNECTORS[id].shortLabel}` : null;
  }
  return null;
}


/**
 * Stable ordering for anything shown in the browser tree.
 *
 * Provider listings come back in whatever order the provider felt like, and
 * that order changes between syncs — so without an explicit sort the sidebar
 * visibly reshuffles every time an estate is captured. Name first (what the
 * reader is scanning for), id as the tiebreak so two identically-named
 * workflows never swap places.
 */
export function byName<T extends { name: string; refId: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) ||
      a.refId.localeCompare(b.refId)
  );
}

"use client";

import Link from "next/link";
import { ArrowUpRight, Link2, Network } from "lucide-react";
import type { AssetRef } from "@/app/lib/api";
import { Section } from "@/components/shared/DetailPanelKit";

/** Route of the asset page: every use across workflows + open in native app. */
export function assetHref(kind: string, value: string): string {
  return `/assets/${encodeURIComponent(kind)}/${encodeURIComponent(value)}`;
}

/*
 * "Assets" block shared by every node inspector: name (→ asset page with every
 * use across workflows) · kind · Open ↗ (Tier-1 deep link when the API
 * derived one; never for hashed webhooks/endpoints).
 * Values for sensitive kinds arrive hashed + masked from the API; we show
 * the label and never the raw value.
 */

const KIND_LABELS: Record<string, string> = {
  google_sheet: "Google Sheet",
  google_doc: "Google Doc",
  google_drive: "Google Drive",
  webhook_url: "Webhook",
  endpoint: "HTTP endpoint",
  ghl_pipeline: "GHL pipeline",
  ghl_pipeline_stage: "GHL stage",
  ghl_calendar: "GHL calendar",
  ghl_form: "GHL form",
  ghl_custom_field: "GHL custom field",
  ghl_workflow: "GHL workflow",
  ghl_tag: "GHL tag",
  ghl_campaign: "GHL campaign",
  ghl_template: "GHL template",
  airtable_base: "Airtable",
  notion_database: "Notion database",
  notion_page: "Notion page",
  slack_channel: "Slack channel",
  cf_tag: "ClickFunnels tag",
  cf_email_template: "ClickFunnels email template",
  cf_course: "ClickFunnels course",
  cf_community_space: "ClickFunnels community space",
  cf_pipeline: "ClickFunnels pipeline",
  cf_pipeline_stage: "ClickFunnels stage",
  cf_workflow: "ClickFunnels workflow",
  cf_sender: "ClickFunnels sender",
  cf_page: "ClickFunnels page",
  cf_funnel: "ClickFunnels funnel",
  cf_product: "ClickFunnels product",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

export function AssetsSection({
  assets,
  onFindUses,
}: {
  assets: AssetRef[] | undefined;
  /** Legacy hook — when given, the name calls this instead of navigating. */
  onFindUses?: (ref: { kind: string; value: string; label?: string | null }) => void;
}) {
  if (!assets || assets.length === 0) return null;
  return (
    <Section title={`Assets (${assets.length})`}>
      <ul className="flex flex-col">
        {assets.map((a) => {
          const name = a.label || kindLabel(a.kind);
          // Primary action = open the asset itself on its platform, new tab.
          // No native URL (hashed webhooks/endpoints) → fall through to the
          // asset page so the name is never a dead end.
          const nameEl = a.dynamic ? (
            <span className="truncate text-[12.5px] text-t1">{name}</span>
          ) : a.url ? (
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the asset on its platform in a new tab"
              className="inline-flex min-w-0 items-center gap-1 text-[12.5px] text-t1 hover:underline"
            >
              <span className="truncate">{name}</span>
              <ArrowUpRight aria-hidden="true" className="size-[10px] flex-none text-t3" />
            </a>
          ) : (
            <Link href={assetHref(a.kind, a.value)} className="truncate text-[12.5px] text-t1 hover:underline" title="No native link for this kind — opens the asset page">
              {name}
            </Link>
          );
          const usesEl = onFindUses ? (
            <button
              type="button"
              onClick={() => onFindUses({ kind: a.kind, value: a.value, label: a.label })}
              title="Dependencies — every workflow and step using this asset"
              className="inline-flex flex-none cursor-pointer items-center gap-[3px] text-[11px] text-t2 transition-colors hover:text-t1"
            >
              <Network aria-hidden="true" className="size-[10px]" /> Dependencies
            </button>
          ) : (
            <Link
              href={assetHref(a.kind, a.value)}
              title="Dependencies — every workflow and step using this asset"
              className="inline-flex flex-none items-center gap-[3px] text-[11px] text-t2 transition-colors hover:text-t1"
            >
              <Network aria-hidden="true" className="size-[10px]" /> Dependencies
            </Link>
          );
          return (
            <li key={`${a.kind}:${a.value}`} className="flex items-center gap-2 border-b border-line2 px-0.5 py-[7px]">
              <Link2 aria-hidden="true" className="size-[11px] flex-none text-t3" />
              <div className="flex min-w-0 flex-1 flex-col">
                {nameEl}
                <span className="truncate text-[10.5px] text-t3">
                  {kindLabel(a.kind)}
                  {a.dynamic ? " · mapped at runtime" : ""}
                </span>
              </div>
              {!a.dynamic && usesEl}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

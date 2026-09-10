"use client";

import Link from "next/link";
import { AtSign, Cable, Pencil, Tag, TriangleAlert, UserRound, type LucideIcon } from "lucide-react";
import type { ActivityItem } from "@/app/lib/api";
import { isProviderId } from "@/lib/connectors";
import { workflowHref } from "@/lib/portals";
import { relativeTime } from "@/components/shared/RunsPanel";
import { EmptyRow, RowCard } from "@/components/views/ViewFrame";

/*
 * Feed rows shared by Notifications (/activity) and Mentions (/mentions):
 * icon box (unread dot) · who — what · workflow · when. Rows deep-link to
 * the workflow (and step) they are about.
 */

export interface FeedRow {
  key: string;
  icon: LucideIcon;
  who: string | null;
  text: string;
  sub: string;
  when: string | null;
  href: string | null;
  unread?: boolean;
  tone?: "err" | "warn" | null;
}

const KIND_ICON: Record<string, LucideIcon> = {
  "workflow.changed": Pencil,
  "comment.created": AtSign,
  "tag.applied": Tag,
  "owner.set": UserRound,
  "notes.updated": Pencil,
  "connection.added": Cable,
  "connection.needs_reauth": TriangleAlert,
  "run.failed": TriangleAlert,
};

export function hrefForTarget(targetKey: string | null): string | null {
  if (!targetKey) return null;
  const parts = targetKey.split(":");
  const [kind] = parts;
  let provider: string | undefined, id: string | undefined, node: string | undefined;
  if (kind === "wf") [, provider, id] = parts;
  else if (kind === "node") [, provider, id, node] = parts;
  else if (kind === "issue") [, , provider, id, node] = parts;
  if (!provider || !id || !isProviderId(provider)) return null;
  const base = workflowHref({ source: provider, refId: id });
  return node && node !== "-" ? `${base}?step=${encodeURIComponent(node)}` : base;
}

export function describeActivity(a: ActivityItem): string {
  const p = a.payload as Record<string, string | number | string[] | undefined>;
  const name = (p.workflowName as string) || a.targetKey || "";
  switch (a.kind) {
    case "workflow.changed":
      return `${name}: ${p.count} change${p.count === 1 ? "" : "s"} detected (sync #${p.version})`;
    case "comment.created":
      return `commented on ${name}: “${(p.excerpt as string) ?? ""}”`;
    case "tag.applied":
      return `tagged ${name}: ${Array.isArray(p.tags) ? (p.tags as string[]).join(", ") : ""}`;
    case "owner.set":
      return `${p.ownerUserId ? "set the owner of" : "cleared the owner of"} ${name}`;
    case "notes.updated":
      return `updated the notes on ${name}`;
    case "connection.added":
      return `connected ${p.provider} ${p.label ?? p.externalId ?? ""}`;
    case "connection.needs_reauth":
      return `${p.provider} ${p.label ?? p.externalId ?? ""} needs re-authentication`;
    case "run.failed":
      return `${a.targetKey}: last run failed${p.error ? ` — ${p.error}` : ""}`;
    default:
      return a.kind;
  }
}

export function activityRow(a: ActivityItem, unread = false): FeedRow {
  const p = a.payload as Record<string, unknown>;
  return {
    key: `a${a.id}`,
    icon: KIND_ICON[a.kind] ?? Pencil,
    who: a.actorName ?? "Rippit",
    text: describeActivity(a),
    sub: (p.workflowName as string) || a.targetKey || a.kind,
    when: a.createdAt,
    href: hrefForTarget(a.targetKey),
    unread,
    tone: a.kind === "run.failed" || a.kind === "connection.needs_reauth" ? "err" : a.kind === "workflow.changed" ? "warn" : null,
  };
}

export function FeedList({ rows, empty }: { rows: FeedRow[]; empty: React.ReactNode }) {
  return (
    <RowCard>
      {rows.length === 0 && <EmptyRow>{empty}</EmptyRow>}
      {rows.map((r) => {
        const Icon = r.icon;
        const inner = (
          <>
            <span className="relative inline-flex size-[26px] flex-none items-center justify-center rounded-control border border-line bg-hover text-t2" style={{ color: r.tone === "err" ? "var(--err-text)" : r.tone === "warn" ? "var(--warn-text)" : undefined }}>
              <Icon aria-hidden="true" className="size-3" />
              {r.unread && <span aria-hidden="true" className="absolute -right-[3px] -top-[3px] size-[7px] rounded-full bg-warn" style={{ boxShadow: "0 0 6px var(--warn)" }} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] leading-[1.5] text-t1">
                {r.who ? <span className="font-semibold">{r.who} — </span> : null}
                {r.text}
              </span>
              <span className="tabular mt-[2px] block [overflow-wrap:anywhere] font-mono text-[9.5px] text-t3">
                {r.sub}
                {r.when ? ` · ${relativeTime(r.when)}` : ""}
              </span>
            </span>
            {r.unread && <span className="sr-only">unread</span>}
          </>
        );
        const cls = `flex w-full items-start gap-2.5 border-b border-line2 px-3.5 py-[11px] text-left transition-[background] duration-[var(--dur-fast)] ease-[var(--ease-out)] last:border-b-0 hover:bg-hover ${r.unread ? "bg-[color-mix(in_srgb,var(--warn)_5%,transparent)]" : ""}`;
        return r.href ? (
          <Link key={r.key} href={r.href} className={cls}>
            {inner}
          </Link>
        ) : (
          <div key={r.key} className={cls}>
            {inner}
          </div>
        );
      })}
    </RowCard>
  );
}

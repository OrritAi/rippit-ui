"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bell,
  BellRing,
  Activity,
  HeartPulse,
  History,
  Info,
  MessageSquare,
  Network,
  NotebookPen,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IconBtn, CornerBadge } from "@/components/shell/IconBtn";
import { StatusPill } from "@/components/shared/StatusPill";
import { AppPuck } from "@/components/shared/AppPuck";
import { ExpandableText } from "@/components/shared/ExpandableText";
import { useShell } from "@/components/shell/shell-context";
import type { StatusPillInfo } from "@/lib/connectors/types";

/*
 * Everything you can do to this workflow, one 46px row: browser toggle ·
 * identity (puck, name, status, changes pill, owner, watch, meta) · tools
 * (Info · Changes · Comments · Runs · Notes) · system map · Open in. Under
 * 880px the owner chip and meta hide and Open-in becomes an icon.
 */
export type DockTool = "health" | "info" | "changes" | "comments" | "runs" | "notes";

export interface ToolSpec {
  id: DockTool;
  label: string;
  badge?: number | string | null;
  dot?: boolean;
  tone?: "t1" | "warn" | "err" | "ok" | "info";
  hidden?: boolean;
}

const TOOL_ICON: Record<DockTool, LucideIcon> = {
  health: HeartPulse,
  info: Info,
  changes: History,
  comments: MessageSquare,
  runs: Activity,
  notes: NotebookPen,
};

export function ActionBar({
  app,
  name,
  statusPill,
  live,
  changes,
  ownerName,
  ownerIsYou,
  onOwner,
  watching,
  onToggleWatch,
  onRefresh,
  refreshing = false,
  meta,
  tools,
  activeTool,
  onTool,
  mapHref,
  nativeUrl,
  providerLabel,
  accountTitle,
}: {
  app: string;
  name: string;
  statusPill: StatusPillInfo;
  live: boolean;
  changes: number;
  /** Owner chip — rendered only when given (null = "no owner"). */
  ownerName?: string | null;
  ownerIsYou?: boolean;
  onOwner?: () => void;
  /** Watch bell — rendered only when `onToggleWatch` is given. */
  watching?: boolean;
  onToggleWatch?: () => void;
  /** Manual sync: live-fetch this workflow from its platform right now. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** e.g. "synced 4 min ago · last run 18 s ago · ok" */
  meta: string | null;
  tools: ToolSpec[];
  activeTool: DockTool | null;
  onTool: (t: DockTool) => void;
  /** System-map link — rendered only when given. */
  mapHref?: string | null;
  nativeUrl: string | null;
  providerLabel: string;
  /** "Make · Acme" — which account this workflow belongs to. */
  accountTitle: string;
}) {
  const { railOpen, toggleRail } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 880));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const initials = ownerName
    ? ownerName
        .replace(/@.*$/, "")
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("")
    : "—";

  return (
    <div ref={ref} className="z-[5] flex min-h-[52px] flex-none items-center gap-3 border-b border-line bg-panel px-4 py-2 backdrop-blur-[14px]">
      {railOpen ? (
        <IconBtn icon={PanelLeftClose} label="Hide the workflow browser ( [ )" size={26} onClick={toggleRail} />
      ) : (
        <button
          type="button"
          onClick={toggleRail}
          aria-label="Show the workflow browser ( [ )"
          title="Show the workflow browser ( [ )"
          className="inline-flex h-[26px] flex-none cursor-pointer items-center gap-1.5 rounded-control border border-line bg-pill pl-1.5 pr-2.5 text-[11.5px] font-semibold text-t2 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1"
        >
          <PanelLeftOpen aria-hidden="true" className="size-[13px]" />
          Workflows
        </button>
      )}
      <AppPuck app={app} size={26} title={accountTitle} />
      <h1 className="min-w-[120px] flex-[0_1_auto] text-[13.5px] font-bold tracking-[-0.014em]">
        <ExpandableText text={name} lines={1} title={`${name} — ${accountTitle}`} />
      </h1>
      <StatusPill pill={statusPill} pulse={live} />
      {changes > 0 && (
        <button type="button" onClick={() => onTool("changes")} className="cursor-pointer" aria-label={`${changes} changes since you last looked — open Changes`}>
          <StatusPill pill={{ label: `${changes} change${changes > 1 ? "s" : ""}`, tone: "info" }} dot={false} />
        </button>
      )}
      <div className="flex-1" />
      {/* Tools cluster: everything that is not the design's core header row
          sits in the spacer, before the meta line and the native CTA. */}
      <div className="flex flex-none items-center gap-1">
        {!narrow && ownerName !== undefined && (
          <button
            type="button"
            onClick={onOwner}
            title={ownerName ? `Owner: ${ownerName}` : "No owner — open Info to set one"}
            className="mr-1 inline-flex h-6 flex-none cursor-pointer items-center gap-1.5 rounded-full border border-line bg-hover py-0 pl-[3px] pr-[9px] text-[11.5px] font-semibold text-t2 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1"
          >
            <span className="inline-flex size-[18px] items-center justify-center rounded-full border border-line bg-pill text-[8.5px] font-bold text-t1">{initials}</span>
            {ownerName ? (ownerIsYou ? "you" : ownerName.split(" ")[0]) : "no owner"}
          </button>
        )}
        {onToggleWatch && (
          <IconBtn
            icon={watching ? BellRing : Bell}
            label={watching ? "Watching — click to unwatch" : "Watch this workflow"}
            size={26}
            active={!!watching}
            onClick={onToggleWatch}
          />
        )}
        {onRefresh && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                aria-label={refreshing ? "Syncing" : `Sync now from ${providerLabel}`}
                className="inline-flex size-[26px] flex-none cursor-pointer items-center justify-center rounded-control border border-line text-t3 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1 disabled:cursor-default"
              >
                <RefreshCw aria-hidden="true" className={`size-[13px] ${refreshing ? "spin motion-reduce:animate-none" : ""}`} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {refreshing ? "Syncing" : `Sync now · pull the latest from ${providerLabel}`}
            </TooltipContent>
          </Tooltip>
        )}
        {mapHref && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href={mapHref} aria-label="View in system map" className="inline-flex size-[26px] items-center justify-center rounded-control border border-line text-t3 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1">
                <Network aria-hidden="true" className="size-[13px]" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>View in system map</TooltipContent>
          </Tooltip>
        )}
        {tools
          .filter((t) => !t.hidden)
          .map((t) => (
            <span key={t.id} className="relative inline-flex">
              <IconBtn icon={TOOL_ICON[t.id]} label={t.label} size={26} active={activeTool === t.id} onClick={() => onTool(t.id)} />
              <CornerBadge value={t.badge} dot={t.dot} tone={t.tone ?? "t1"} />
            </span>
          ))}
      </div>
      {!narrow && meta && (
        <span className="tabular whitespace-nowrap font-mono text-[11px] text-t3" title={accountTitle}>
          {meta}
        </span>
      )}
      {nativeUrl &&
        (narrow ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <a href={nativeUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open in ${providerLabel}`} className="inline-flex size-[26px] flex-none items-center justify-center rounded-control border border-line text-t3 transition-colors hover:border-line-strong hover:text-t1">
                <ArrowUpRight aria-hidden="true" className="size-[13px]" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>Open in {providerLabel}</TooltipContent>
          </Tooltip>
        ) : (
          <Button size="sm" asChild>
            <a href={nativeUrl} target="_blank" rel="noopener noreferrer">
              Open in {providerLabel} ↗
            </a>
          </Button>
        ))}
    </div>
  );
}


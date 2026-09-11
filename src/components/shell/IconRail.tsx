"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { startTransition, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Funnel,
  HeartPulse,
  Link2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  Search,
  Sun,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { CornerBadge, IconBtn } from "./IconBtn";
import { AvatarMenu } from "./AvatarMenu";
import { useShell } from "./shell-context";
import { panelFor, usePanelAvailable } from "./SidePanel";
import { useConnections } from "@/components/app/ConnectionsProvider";
import { usePalette } from "@/components/palette/palette-context";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useHydrated } from "@/lib/stored";
import { recentFailures } from "@/lib/triage";

/** Right-side tooltip for rail buttons (the label is also the aria-label). */
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

interface RailItem {
  id: string;
  href: string;
  icon: LucideIcon;
  label: string;
  /** Tooltip text when it should say more than the label. */
  tip?: string;
  match: (path: string) => boolean;
  /** Active state wears the triage accent (the operator layer's home). */
  accent?: boolean;
}

/** Triage item: the active state in the triage accent, not the plain fill. */
const TRIAGE_ACTIVE = {
  color: "var(--triage)",
  borderColor: "color-mix(in srgb, var(--triage) 45%, transparent)",
  background: "color-mix(in srgb, var(--triage) 10%, transparent)",
} as const;

/*
 * 52px icon rail — the app's primary navigation, kept deliberately small:
 * Workflows (the browse home), Martech (funnel maps), Health, Assets, and
 * Triage (the operator layer: the run explorer and replay — its badge counts
 * Make scenarios whose last run failed, from the link map already in memory;
 * Health keeps its own, structural counts). The home diamond returns to the
 * dashboard landing.
 */
export function IconRail() {
  const pathname = usePathname();
  const router = useRouter();
  const { railOpen, toggleRail, setRailOpen } = useShell();
  const palette = usePalette();
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();
  const available = usePanelAvailable();
  const { linkMap } = useConnections();
  const failing = useMemo(() => recentFailures(linkMap).length, [linkMap]);

  const items: RailItem[] = [
    { id: "canvas", href: "/w", icon: Workflow, label: "Workflows", match: (p) => p === "/w" || p.startsWith("/w/") },
    { id: "martech", href: "/martech", icon: Funnel, label: "Martech", match: (p) => p.startsWith("/martech") },
    { id: "health", href: "/health", icon: HeartPulse, label: "Health", match: (p) => p.startsWith("/health") },
    { id: "assets", href: "/assets", icon: Link2, label: "Assets", match: (p) => p.startsWith("/assets") },
    { id: "triage", href: "/triage", icon: Radar, label: "Triage", match: (p) => p.startsWith("/triage"), accent: true },
  ];

  // Workflows opens its browser panel as you arrive; health / assets leave the
  // side panel as it is.
  const go = (href: string) => {
    if (panelFor(href).autoOpen) setRailOpen(true);
    startTransition(() => router.push(href));
  };

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={400}>
    <nav
      aria-label="Rippit"
      className="flex h-full w-[52px] flex-none flex-col items-center gap-1 border-r border-line2 bg-sidebar px-0 py-[10px]"
    >
      <Link
        href="/dashboard"
        aria-label="Rippit home"
        className="mb-[10px] mt-[2px] flex size-5 rotate-45 items-center justify-center rounded-[6px] bg-t1 transition-transform duration-[var(--dur)] ease-[var(--ease-out)] hover:rotate-[135deg]"
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-bg" />
      </Link>
      {items.map((it) => {
        const active = it.match(pathname);
        return (
          <span key={it.id} className="relative">
            {active && (
              <motion.span
                layoutId="rail-active"
                aria-hidden="true"
                transition={{ type: "spring", stiffness: 520, damping: 40, mass: 0.6 }}
                className={`pointer-events-none absolute -left-[9px] top-1/2 h-[18px] w-[2px] -translate-y-1/2 rounded-full ${it.accent ? "bg-triage" : "bg-t1"}`}
              />
            )}
            <Tip label={it.tip ?? it.label}>
              <IconBtn
                icon={it.icon}
                label={it.tip ?? it.label}
                title={null}
                size={34}
                active={active}
                style={active && it.accent ? TRIAGE_ACTIVE : undefined}
                aria-current={active ? "page" : undefined}
                onMouseEnter={() => router.prefetch(it.href)}
                onFocus={() => router.prefetch(it.href)}
                onClick={() => go(it.href)}
              />
            </Tip>
            {it.id === "triage" && <CornerBadge value={failing} tone="triage" />}
          </span>
        );
      })}
      <div className="flex-1" />
      <Tip label="Action hub · ⌘K">
        <IconBtn icon={Search} label="Action hub (⌘K)" title={null} size={34} onClick={palette.open} />
      </Tip>
      <Tip label={mounted && resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
        <IconBtn
          icon={mounted && resolvedTheme === "dark" ? Sun : Moon}
          label={mounted && resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={null}
          size={34}
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        />
      </Tip>
      <Tip label={!available ? "No side panel on this view" : railOpen ? "Hide side panel · [" : "Show side panel · ["}>
        <IconBtn
          icon={railOpen && available ? PanelLeftClose : PanelLeftOpen}
          label={!available ? "No side panel on this view" : railOpen ? "Collapse side panel ( [ )" : "Expand side panel ( [ )"}
          title={null}
          size={34}
          active={railOpen && available}
          aria-disabled={!available}
          onClick={() => available && toggleRail()}
          className={available ? "" : "cursor-not-allowed opacity-35 hover:border-line hover:text-t3"}
        />
      </Tip>
      <AvatarMenu />
    </nav>
    </TooltipProvider>
  );
}

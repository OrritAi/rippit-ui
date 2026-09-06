"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { startTransition } from "react";
import { motion } from "framer-motion";
import {
  AtSign,
  Bell,
  HeartPulse,
  Inbox,
  LayoutDashboard,
  Link2,
  Moon,
  GitBranch,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { IconBtn, CornerBadge } from "./IconBtn";
import { AvatarMenu } from "./AvatarMenu";
import { useShell } from "./shell-context";
import { useBadges } from "./useBadges";
import { panelFor, usePanelAvailable } from "./SidePanel";
import { usePalette } from "@/components/palette/palette-context";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useHydrated } from "@/lib/stored";

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
  match: (path: string) => boolean;
  badge?: number;
}

/*
 * 52px icon rail — the app's primary navigation. Dashboard sits first (home),
 * then the handoff order. Badges: Needs you (broken + changed), Notifications (unread),
 * Mentions (open threads that mention you).
 */
export function IconRail() {
  const pathname = usePathname();
  const router = useRouter();
  const { railOpen, toggleRail, setRailOpen } = useShell();
  const palette = usePalette();
  const { resolvedTheme, setTheme } = useTheme();
  const badges = useBadges();
  const mounted = useHydrated();
  const available = usePanelAvailable();

  const items: RailItem[] = [
    { id: "dashboard", href: "/dashboard", icon: LayoutDashboard, label: "Dashboard", match: (p) => p.startsWith("/dashboard") },
    { id: "canvas", href: "/w", icon: Workflow, label: "Workflows", match: (p) => p === "/w" || p.startsWith("/w/") },
    { id: "funnels", href: "/funnels", icon: GitBranch, label: "Funnels", match: (p) => p.startsWith("/funnels") },
    { id: "map", href: "/map", icon: Network, label: "System map", match: (p) => p.startsWith("/map") },
    { id: "health", href: "/health", icon: HeartPulse, label: "Health", match: (p) => p.startsWith("/health") },
    { id: "assets", href: "/assets", icon: Link2, label: "Assets", match: (p) => p.startsWith("/assets") },
    { id: "inbox", href: "/inbox", icon: Inbox, label: "Needs you", match: (p) => p.startsWith("/inbox"), badge: badges.needsYou },
    { id: "activity", href: "/activity", icon: Bell, label: "Notifications", match: (p) => p.startsWith("/activity"), badge: badges.unread },
    { id: "mentions", href: "/mentions", icon: AtSign, label: "Mentions & comments", match: (p) => p.startsWith("/mentions"), badge: badges.mentions },
  ];

  // Views whose side panel is the way in (workflows, needs-you, notifications,
  // mentions) open it as you arrive; dashboard / map / assets leave it as is.
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
                className="pointer-events-none absolute -left-[9px] top-1/2 h-[18px] w-[2px] -translate-y-1/2 rounded-full bg-t1"
              />
            )}
            <Tip label={it.badge ? `${it.label} · ${it.badge}` : it.label}>
              <IconBtn
                icon={it.icon}
                label={it.label}
                title={null}
                size={34}
                active={active}
                aria-current={active ? "page" : undefined}
                onMouseEnter={() => router.prefetch(it.href)}
                onFocus={() => router.prefetch(it.href)}
                onClick={() => go(it.href)}
              />
            </Tip>
            <CornerBadge value={it.badge && it.badge > 99 ? "99+" : it.badge} />
            {it.badge ? <span className="sr-only">{it.badge} items</span> : null}
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

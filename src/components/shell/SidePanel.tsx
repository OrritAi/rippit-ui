"use client";

import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { WorkflowBrowser, useWorkflowCount } from "./BrowserColumn";
import { InboxPanel, useInboxCount } from "./panels/InboxPanel";
import { NotificationsPanel, useNotificationsCount } from "./panels/NotificationsPanel";
import { MentionsPanel, useMentionsCount } from "./panels/MentionsPanel";
import { AssetsPanel } from "./panels/AssetsPanel";

/*
 * The side column (206px by default, resizable) is contextual: each view registers the panel that
 * belongs next to it (workflow browser, needs-you items, notifications,
 * mention threads, asset structure). Selecting an item in the panel shows
 * it in the main area. Add a view = add a registry entry.
 */
export interface SidePanelDef {
  id: string;
  title: string;
  match: (pathname: string) => boolean;
  /** Absent = this view has no side panel (it can't be opened there). */
  Component?: ComponentType;
  /** Optional live count shown next to the title. */
  useCount?: () => string;
  /** Opens automatically when its rail item is clicked. */
  autoOpen?: boolean;
}

export const SIDE_PANELS: SidePanelDef[] = [
  // Dashboard, the system map, Martech and Settings are full-bleed: no side panel at all.
  { id: "none", title: "", match: (p) => p.startsWith("/dashboard") || p.startsWith("/map") || p.startsWith("/martech") || p.startsWith("/settings") },
  { id: "inbox", title: "Needs you", match: (p) => p.startsWith("/inbox"), Component: InboxPanel, useCount: useInboxCount, autoOpen: true },
  { id: "activity", title: "Notifications", match: (p) => p.startsWith("/activity"), Component: NotificationsPanel, useCount: useNotificationsCount, autoOpen: true },
  { id: "mentions", title: "Mentions", match: (p) => p.startsWith("/mentions"), Component: MentionsPanel, useCount: useMentionsCount, autoOpen: true },
  { id: "assets", title: "Assets", match: (p) => p.startsWith("/assets"), Component: AssetsPanel },
  // Everything else (workflows, health, workflow pages) browses workflows.
  { id: "workflows", title: "Workflows", match: () => true, Component: WorkflowBrowser, useCount: useWorkflowCount, autoOpen: true },
];

export function panelFor(pathname: string): SidePanelDef {
  return SIDE_PANELS.find((p) => p.match(pathname)) ?? SIDE_PANELS[SIDE_PANELS.length - 1];
}

/** Whether the current view has a side panel at all. */
export function usePanelAvailable(): boolean {
  const pathname = usePathname();
  return !!panelFor(pathname).Component;
}

function Count({ use }: { use: () => string }) {
  const v = use();
  return <span className="tabular ml-auto font-mono text-[10px] text-t3">{v}</span>;
}

export function SidePanel() {
  const pathname = usePathname();
  const def = panelFor(pathname);
  const Body = def.Component;
  if (!Body) return null;
  return (
    <aside
      key={def.id}
      aria-label={`${def.title} panel`}
      className="flex h-full w-full flex-none flex-col border-r border-line2 bg-sidebar"
    >
      <div className="flex h-[46px] flex-none items-center border-b border-line2 px-[13px] anim-fade-in">
        <span className="text-[13.5px] font-bold tracking-[-0.02em]">{def.title}</span>
        {def.useCount && <Count use={def.useCount} />}
      </div>
      <div key={def.id} className="flex min-h-0 flex-1 flex-col stagger-in">
        <Body />
      </div>
    </aside>
  );
}

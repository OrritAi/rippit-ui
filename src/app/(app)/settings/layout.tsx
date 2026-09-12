"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRole, useWorkspace } from "@/components/app/WorkspaceProvider";
import { useConnections } from "@/components/app/ConnectionsProvider";
import { usePalette } from "@/components/palette/palette-context";
import { PortalHeader } from "@/components/shared/PortalHeader";
import { SettingsProvider, useSettings } from "@/components/settings/SettingsProvider";
import { useFullBleed } from "@/components/shell/shell-context";
import { useHydrated } from "@/lib/stored";

/*
 * Settings: a 52px portal header, a 200px section rail and a 760px content
 * column. Sections are routes so a link can land on one directly. The portal
 * header stands in for the shell's search bar — `useFullBleed("header")` is
 * what asks for that.
 */
const SECTIONS = [
  { href: "/settings/organization", label: "Organization" },
  { href: "/settings/members", label: "Members" },
  { href: "/settings/connections", label: "Connections" },
  { href: "/settings/account", label: "Account" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <SettingsFrame>{children}</SettingsFrame>
    </SettingsProvider>
  );
}

function SettingsFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const role = useRole();
  const { current } = useWorkspace();
  const { members } = useSettings();
  const { connections } = useConnections();
  const palette = usePalette();
  useFullBleed("header");
  // Show the shortcut that actually works on this platform (after hydration).
  const hydrated = useHydrated();
  const shortcut = hydrated && !/Mac|iPhone|iPad/.test(navigator.platform) ? "Ctrl K" : "⌘K";

  useEffect(() => {
    document.title = "Settings — Rippit";
  }, []);

  const name = current?.name ?? "";
  const meta = [
    name.toLowerCase(),
    members ? `${members.length} member${members.length === 1 ? "" : "s"}` : null,
    `${connections.length} connection${connections.length === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PortalHeader crumb="settings" meta={meta}>
        <button
          type="button"
          onClick={palette.open}
          aria-label="Open action hub"
          aria-haspopup="dialog"
          className="cursor-pointer rounded-control border border-line-strong px-[7px] py-[3px] font-mono text-[10.5px] text-t3 transition-colors duration-[var(--dur-fast)] hover:text-t1"
        >
          {shortcut}
        </button>
      </PortalHeader>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings sections" className="flex w-[200px] flex-none flex-col gap-0.5 border-r border-line px-2.5 py-4">
          {SECTIONS.map((s) => {
            const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-control px-2.5 py-[7px] text-[13px] font-medium transition-colors duration-[var(--dur-fast)] ${
                  active ? "bg-hover text-t1" : "text-t2 hover:bg-hover hover:text-t1"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
          <div className="flex-1" />
          <p className="px-2.5 font-mono text-[10.5px] text-t3">you are {role}</p>
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-7 pb-16 pt-7">{children}</div>
        </main>
      </div>
    </div>
  );
}

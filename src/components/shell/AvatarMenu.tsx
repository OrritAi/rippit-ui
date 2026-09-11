"use client";

import Link from "next/link";
import { Building2, Check, LogOut, Settings, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/components/app/AuthProvider";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { useConnections } from "@/components/app/ConnectionsProvider";
import { UserAvatar } from "@/components/app/UserAvatar";

/*
 * Rail-bottom avatar → account menu: organization switcher (✓ current),
 * Organization, Members, Settings (connections dot), sign out. Theme lives
 * on the rail itself.
 */
export function AvatarMenu() {
  const { user, signOut } = useAuth();
  const { current, workspaces, switchTo } = useWorkspace();
  const { connections } = useConnections();
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    (meta.full_name as string) || (meta.name as string) || user?.email || "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu — ${displayName}${current ? `, organization ${current.name}` : ""}`}
          className="mt-1 flex size-[26px] cursor-pointer items-center justify-center rounded-full border border-line bg-hover transition-[border-color] duration-[var(--dur-fast)] hover:border-line-strong data-[state=open]:border-line-strong"
        >
          <UserAvatar user={user} size={24} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={10}
        className="w-[232px] rounded-card border-line bg-pill p-1 text-t1 shadow-[var(--shadow-float)]"
      >
        <div className="px-2 pb-1.5 pt-1.5">
          <p className="[overflow-wrap:anywhere] text-[13px] font-semibold leading-tight">{displayName}</p>
          <p className="[overflow-wrap:anywhere] font-mono text-[10.5px] text-t3">{user?.email}</p>
        </div>
        <DropdownMenuSeparator className="bg-line2" />
        <DropdownMenuLabel className="px-2 pb-0.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3">
          Organization
        </DropdownMenuLabel>
        {workspaces.map((w) => {
          const isCurrent = w.id === current?.id;
          return (
            <DropdownMenuItem
              key={w.id}
              className="gap-2 rounded-row text-[13px]"
              onClick={() => !isCurrent && switchTo(w.id)}
              aria-current={isCurrent ? "true" : undefined}
            >
              <span className="inline-flex size-3.5 items-center justify-center">
                {isCurrent ? (
                  <Check aria-hidden="true" className="size-3.5" />
                ) : (
                  <span aria-hidden="true" className="size-[6px] rounded-full bg-off" />
                )}
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{w.name}</span>
              <span className="ml-auto text-[10.5px] text-t3">{w.role}</span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuItem asChild className="gap-2 rounded-row text-[13px]">
          <Link href="/settings/organization">
            <Building2 aria-hidden="true" className="size-3.5" />
            Organization
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2 rounded-row text-[13px]">
          <Link href="/settings/members">
            <Users aria-hidden="true" className="size-3.5" />
            Members
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-line2" />
        <DropdownMenuItem asChild className="gap-2 rounded-row text-[13px]">
          <Link href="/settings/organization">
            <Settings aria-hidden="true" className="size-3.5" />
            Settings
            <span
              aria-hidden="true"
              className={`ml-auto size-[6px] rounded-full ${connections.length > 0 ? "bg-ok" : "bg-off"}`}
            />
            <span className="sr-only">
              {connections.length > 0
                ? `— ${connections.length} platform${connections.length > 1 ? "s" : ""} connected`
                : "— no platforms connected yet"}
            </span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 rounded-row text-[13px]" onClick={signOut}>
          <LogOut aria-hidden="true" className="size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import type { Role, WorkspaceMember } from "@/app/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { InlineConfirm } from "@/components/shared/InlineConfirm";
import { canManageMember } from "@/lib/roles";
import { ago } from "@/lib/time";

export function memberName(m: WorkspaceMember): string {
  return m.display_name || m.email || m.user_id;
}

/** "maya" — the first word of the name, for the confirm question. */
export function firstName(m: WorkspaceMember): string {
  return memberName(m).split(/[\s@._-]+/)[0].toLowerCase();
}

/*
 * One member: checkbox (when the viewer can manage them), avatar, name and
 * email, last-active meta, then the role control — a menu when manageable,
 * a static pill otherwise. Remove turns the right side into an inline confirm.
 */
export function MemberRow({
  member,
  isSelf,
  viewerRole,
  checked,
  onCheck,
  onSetRole,
  onTransfer,
  onRemove,
}: {
  member: WorkspaceMember;
  isSelf: boolean;
  viewerRole: Role;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  onSetRole: (role: "admin" | "member") => Promise<void>;
  onTransfer: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Remove swaps the menu's trigger for the confirm strip: keep Radix from
  // returning focus to a control that is gone, so the strip's Cancel takes it.
  const handingOff = useRef(false);
  const manageable = canManageMember(viewerRole, member.role, isSelf);
  const name = memberName(member);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="flex items-center gap-3 border-t border-line2 px-4 py-[11px] transition-colors duration-[var(--dur-fast)] hover:bg-hover">
      {manageable && (
        <span className="relative flex size-[15px] flex-none items-center justify-center">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheck(e.target.checked)}
            aria-label={`Select ${name}`}
            className="peer size-[15px] cursor-pointer appearance-none rounded-[4px] border border-line-strong bg-transparent checked:border-t1 checked:bg-t1"
          />
          <Check aria-hidden="true" className="pointer-events-none absolute size-[10px] text-bg opacity-0 peer-checked:opacity-100" strokeWidth={3} />
        </span>
      )}
      <InitialsAvatar name={name} size={28} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">
          {name}
          {isSelf && <span className="font-normal text-t3"> (you)</span>}
        </p>
        {member.email && <p className="truncate font-mono text-[11px] text-t3">{member.email}</p>}
      </div>
      <span className="flex-none font-mono text-[10.5px] text-t3">
        {isSelf ? "that’s you" : member.lastActiveAt ? `active ${ago(member.lastActiveAt)}` : ""}
      </span>

      {confirming ? (
        <InlineConfirm
          question={`remove ${firstName(member)}?`}
          confirmLabel="Remove"
          busy={busy}
          onConfirm={() => run(onRemove)}
          onCancel={() => setConfirming(false)}
        />
      ) : manageable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={busy}
              aria-label={`Change role for ${name} — ${member.role}`}
              className="flex flex-none cursor-pointer items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-[3px] font-mono text-[11px] text-t1 transition-colors duration-[var(--dur-fast)] hover:border-t1 disabled:opacity-50 data-[state=open]:border-t1"
            >
              {member.role}
              <span aria-hidden="true" className="text-[9px] text-t3">
                ▾
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            onCloseAutoFocus={(e) => {
              if (handingOff.current) {
                e.preventDefault();
                handingOff.current = false;
              }
            }}
            className="w-[220px] rounded-card border-line bg-pill p-1 text-t1 shadow-[var(--shadow-float)]"
          >
            <DropdownMenuLabel className="px-2 pb-0.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3">Change role</DropdownMenuLabel>
            {viewerRole === "owner" && member.role !== "owner" && (
              <DropdownMenuItem className="rounded-row text-[13px]" onSelect={() => run(onTransfer)}>
                Transfer ownership
              </DropdownMenuItem>
            )}
            {member.role !== "admin" && (
              <DropdownMenuItem className="rounded-row text-[13px]" onSelect={() => run(() => onSetRole("admin"))}>
                Make admin
              </DropdownMenuItem>
            )}
            {member.role !== "member" && (
              <DropdownMenuItem className="rounded-row text-[13px]" onSelect={() => run(() => onSetRole("member"))}>
                Make member
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="bg-line2" />
            <DropdownMenuItem
              variant="destructive"
              className="rounded-row text-[13px] text-err-text"
              onSelect={() => {
                handingOff.current = true;
                setConfirming(true);
              }}
            >
              Remove from organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="flex-none rounded-full border border-line px-2.5 py-[3px] font-mono text-[11px] text-t2">{member.role}</span>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { removeMember, transferOwnership, updateMemberRole, WorkspaceMember } from "@/app/lib/api";
import { useAuth } from "@/components/app/AuthProvider";
import { useRole, useWorkspace } from "@/components/app/WorkspaceProvider";
import { useSettings } from "@/components/settings/SettingsProvider";
import { InviteCard } from "@/components/settings/InviteCard";
import { MemberRow, memberName } from "@/components/settings/MemberRow";
import { PendingInvites } from "@/components/settings/PendingInvites";
import { Card, CardHeader, SectionTitle } from "@/components/shared/Card";
import { InlineConfirm } from "@/components/shared/InlineConfirm";
import { Button } from "@/components/ui/button";
import { can, roleNoun } from "@/lib/roles";
import { errorText, toastError } from "@/lib/feedback";

export default function MembersPage() {
  const role = useRole();
  const { user } = useAuth();
  const { current, refresh } = useWorkspace();
  const { members, invites, error, reload } = useSettings();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const workspaceId = current?.id ?? "";

  const setRole = async (m: WorkspaceMember, next: "admin" | "member") => {
    try {
      await updateMemberRole(workspaceId, m.user_id, next);
      toast.success(`${memberName(m)} is now ${roleNoun(next)}`);
      reload();
    } catch (err) {
      toastError(err, "The role couldn’t be changed. Try again.");
    }
  };

  const transfer = async (m: WorkspaceMember) => {
    try {
      await transferOwnership(workspaceId, m.user_id);
      toast.success(`Ownership transferred to ${memberName(m)} — you are now an admin`);
      refresh();
      reload();
    } catch (err) {
      toastError(err, "Ownership couldn’t be transferred. Try again.");
    }
  };

  const remove = async (m: WorkspaceMember) => {
    try {
      await removeMember(workspaceId, m.user_id);
      toast.success(`${memberName(m)} removed from the organization`);
      setSelected((s) => {
        const n = new Set(s);
        n.delete(m.user_id);
        return n;
      });
      reload();
    } catch (err) {
      toastError(err, "The member couldn’t be removed. Try again.");
    }
  };

  const removeSelected = async () => {
    const ids = [...selected];
    setBulkBusy(true);
    const results = await Promise.allSettled(ids.map((id) => removeMember(workspaceId, id)));
    setBulkBusy(false);
    setConfirmBulk(false);
    const failed = results.filter((r) => r.status === "rejected");
    const done = ids.length - failed.length;
    if (done > 0) toast.success(`${done} member${done === 1 ? "" : "s"} removed from the organization`);
    if (failed.length) {
      const first = failed[0] as PromiseRejectedResult;
      toast.error(errorText(first.reason, `${failed.length} couldn’t be removed`));
    }
    setSelected(new Set());
    reload();
  };

  const count = members?.length ?? null;

  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-4">
      <SectionTitle>
        <span id="members-heading">Members</span>
      </SectionTitle>

      <Card>
        <CardHeader title="People" meta={count ?? undefined} />
        {selected.size > 0 && (
          <div className="flex items-center gap-2.5 border-t border-line2 bg-hover px-4 py-2">
            <span className="flex-1 font-mono text-[11px] text-t2">{selected.size} selected</span>
            {confirmBulk ? (
              <InlineConfirm
                question={`remove ${selected.size} member${selected.size === 1 ? "" : "s"}?`}
                confirmLabel="Remove"
                busy={bulkBusy}
                onConfirm={removeSelected}
                onCancel={() => setConfirmBulk(false)}
              />
            ) : (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  size="xs"
                  onClick={() => setConfirmBulk(true)}
                  className="cursor-pointer rounded-control text-[12px] font-semibold dark:bg-destructive"
                >
                  Remove selected
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => setSelected(new Set())} className="cursor-pointer rounded-control text-[12px] text-t2 hover:text-t1">
                  Clear
                </Button>
              </>
            )}
          </div>
        )}
        {error && <p role="alert" className="border-t border-line2 px-4 py-3 text-[12.5px] text-err-text">{error}</p>}
        {!members && !error && <p className="border-t border-line2 px-4 py-3 font-mono text-[11px] text-t3">loading…</p>}
        {members?.map((m) => (
          <MemberRow
            key={m.user_id}
            member={m}
            isSelf={m.user_id === user?.id}
            viewerRole={role}
            checked={selected.has(m.user_id)}
            onCheck={(on) =>
              setSelected((s) => {
                const n = new Set(s);
                if (on) n.add(m.user_id);
                else n.delete(m.user_id);
                return n;
              })
            }
            onSetRole={(r) => setRole(m, r)}
            onTransfer={() => transfer(m)}
            onRemove={() => remove(m)}
          />
        ))}
      </Card>

      {can(role, "invite") && workspaceId && <InviteCard workspaceId={workspaceId} viewerRole={role} onSent={reload} />}
      {can(role, "manageInvites") && workspaceId && <PendingInvites workspaceId={workspaceId} invites={invites} onChange={reload} />}
    </section>
  );
}

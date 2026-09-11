"use client";

import { useState } from "react";
import { toast } from "sonner";
import { resendInvite, revokeInvite, WorkspaceInvite } from "@/app/lib/api";
import { Card, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/feedback";
import { ago } from "@/lib/time";

/** Pending invites — resend (new link) or revoke. Rendered only when there are any. */
export function PendingInvites({ workspaceId, invites, onChange }: { workspaceId: string; invites: WorkspaceInvite[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!invites.length) return null;

  const resend = async (inv: WorkspaceInvite) => {
    setBusy(inv.id);
    try {
      const row = await resendInvite(workspaceId, inv.id);
      if (row?.sendError) toast.success(`Invite saved — email not delivered · ${inv.email} still joins on first sign-in`);
      else toast.success(`Invite resent to ${inv.email}`);
      onChange();
    } catch (err) {
      toastError(err, "The invite couldn’t be resent. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (inv: WorkspaceInvite) => {
    setBusy(inv.id);
    try {
      await revokeInvite(workspaceId, inv.id);
      toast.success("Invite revoked");
      onChange();
    } catch (err) {
      toastError(err, "The invite couldn’t be revoked. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Pending invites" meta={invites.length} />
      {invites.map((inv) => (
        <div key={inv.id} className="flex items-center gap-3 border-t border-line2 px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{inv.email}</span>
          <span className="flex-none font-mono text-[10.5px] text-t3">
            invited {ago(inv.invited_at)} · {inv.role}
            {inv.sendError && <span className="text-warn-text"> · not delivered</span>}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={busy === inv.id}
            onClick={() => resend(inv)}
            className="cursor-pointer rounded-control border-line-strong bg-transparent text-[12px] font-semibold hover:bg-hover dark:bg-transparent dark:hover:bg-hover"
          >
            Resend
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy === inv.id}
            onClick={() => revoke(inv)}
            className="cursor-pointer rounded-control text-[12px] text-t2 hover:text-t1"
          >
            Revoke
          </Button>
        </div>
      ))}
    </Card>
  );
}

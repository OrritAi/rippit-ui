"use client";

import { useState } from "react";
import posthog from "posthog-js";
import { toast } from "sonner";
import { inviteMember, Role } from "@/app/lib/api";
import { Card } from "@/components/shared/Card";
import { Segmented } from "@/components/shared/Segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inviteRoleOptions, ROLE_LABEL } from "@/lib/roles";
import { toastError } from "@/lib/feedback";

/** Email + role + Invite. Owners may invite an owner (a handoff on accept). */
export function InviteCard({ workspaceId, viewerRole, onSent }: { workspaceId: string; viewerRole: Role; onSent: () => void }) {
  const options = inviteRoleOptions(viewerRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  if (!options.length) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value.includes("@") || busy) return;
    setBusy(true);
    try {
      const inv = await inviteMember(workspaceId, value, role);
      posthog.capture("workspace_member_invited", { role, delivery_status: inv?.sendError ? "failed" : "sent" });
      if (inv?.sendError) toast.success(`Invite saved — email not delivered · ${value} still joins on first sign-in`);
      else toast.success(`Invite sent — ${value} joins on first sign-in`);
      setEmail("");
      onSent();
    } catch (err) {
      toastError(err, "The invite couldn’t be sent. Check the address and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        <h3 className="text-[13px] font-semibold">Invite</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Invite by email…"
            aria-label="Email address to invite"
            autoComplete="off"
            className="h-9 min-w-[220px] flex-1 rounded-control border-line-strong bg-hover text-[13px] placeholder:text-t3 dark:bg-hover"
          />
          <Segmented
            label="Invite role"
            value={role}
            options={options.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            onChange={setRole}
          />
          <Button type="submit" size="sm" disabled={!email.trim() || busy} className="cursor-pointer rounded-control text-[12.5px] font-semibold">
            Invite
          </Button>
        </div>
        <p className="text-[12px] text-t3 [text-wrap:pretty]">
          Invited people join the first time they sign in with that email — everyone here sees the same connections, tags, comments and change log.
        </p>
      </form>
    </Card>
  );
}

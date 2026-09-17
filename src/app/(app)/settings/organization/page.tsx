"use client";

import { useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { toast } from "sonner";
import { renameWorkspace } from "@/app/lib/api";
import { useRole, useWorkspace } from "@/components/app/WorkspaceProvider";
import { useSettings } from "@/components/settings/SettingsProvider";
import { Card, SectionTitle } from "@/components/shared/Card";
import { Field } from "@/components/shared/Field";
import { StatusPill } from "@/components/shared/StatusPill";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/roles";
import { monthYear } from "@/lib/time";
import { toastError } from "@/lib/feedback";

export default function OrganizationPage() {
  const role = useRole();
  const { current, refresh } = useWorkspace();
  const { org, members, reload } = useSettings();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const orgName = org?.name ?? current?.name ?? "";
  const status = org?.status ?? current?.status ?? "active";
  const createdAt = org?.createdAt ?? current?.created_at ?? null;
  const isOwner = can(role, "rename");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = name.trim();
    if (!current || !next || busy) return;
    setBusy(true);
    try {
      await renameWorkspace(current.id, next);
      posthog.capture("workspace_renamed");
      toast.success(`Organization renamed to ${next}`);
      setName("");
      refresh();
      reload();
    } catch (err) {
      toastError(err, "The organization couldn’t be renamed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="org-heading" className="flex flex-col gap-4">
      <SectionTitle>
        <span id="org-heading">Organization</span>
      </SectionTitle>

      <Card>
        <div className="flex flex-col gap-3.5 p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="[overflow-wrap:anywhere] text-[16px] font-bold tracking-[-0.02em]">{orgName || "…"}</h3>
              <p className="mt-[3px] font-mono text-[11px] text-t3">
                you are {role}
                {members ? ` · ${members.length} member${members.length === 1 ? "" : "s"}` : ""}
                {createdAt ? ` · created ${monthYear(createdAt)}` : ""}
              </p>
            </div>
            <StatusPill pill={status === "suspended" ? { label: "Suspended", tone: "muted" } : { label: "Active", tone: "ok" }} />
          </div>

          {isOwner ? (
            <form onSubmit={save} className="flex items-end gap-2 border-t border-line2 pt-3.5">
              <Field label="Organization name" value={name} onChange={setName} placeholder={orgName} className="max-w-[320px] flex-1" />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={!name.trim() || busy}
                className="cursor-pointer rounded-control border border-line text-[12.5px] font-semibold"
              >
                Save
              </Button>
            </form>
          ) : (
            <p className="border-t border-line2 pt-3 text-[12.5px] text-t3">Only the owner can rename or delete this organization.</p>
          )}
        </div>
      </Card>

      {isOwner && (
        <Card>
          <div className="flex flex-col p-4">
            <h3 className="mb-1.5 text-[13px] font-semibold">Danger zone</h3>
            <div className="flex items-center gap-3 border-t border-line2 py-[11px]">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">Transfer ownership</p>
                <p className="mt-px text-[12px] text-t3">Hand the organization to another member — you become an admin.</p>
              </div>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="rounded-control border-line-strong bg-transparent text-[12.5px] font-semibold hover:bg-hover dark:bg-transparent dark:hover:bg-hover"
              >
                <Link href="/settings/members">Transfer…</Link>
              </Button>
            </div>
            <div className="flex items-center gap-3 border-t border-line2 pb-0.5 pt-[11px]">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-err-text">Delete organization</p>
                <p className="mt-px text-[12px] text-t3">Contact orrit to delete this organization.</p>
              </div>
            </div>
          </div>
        </Card>
      )}
    </section>
  );
}

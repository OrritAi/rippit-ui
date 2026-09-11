"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateMe } from "@/app/lib/api";
import { useAuth } from "@/components/app/AuthProvider";
import { useSettings } from "@/components/settings/SettingsProvider";
import { AcceptedTermsList } from "@/components/connect/ConsentGate";
import { Card, CardHeader, SectionTitle } from "@/components/shared/Card";
import { Field } from "@/components/shared/Field";
import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/feedback";
import { supabase } from "@/lib/supabase";

export default function AccountPage() {
  const { user, signOut } = useAuth();
  const { members, reload } = useSettings();
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const me = members?.find((m) => m.user_id === user?.id);
  const initial = me?.display_name ?? ((meta.full_name as string) || (meta.name as string) || "");
  const [draft, setDraft] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // The saved name arrives after mount; show it until the field is edited.
  const name = touched ? draft : initial;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = name.trim();
    if (!next || busy) return;
    setBusy(true);
    try {
      await updateMe(next);
      // The API also wrote user_metadata.full_name — pull a fresh session so
      // the avatar menu shows the new name without a reload.
      await supabase.auth.refreshSession().catch(() => {});
      toast.success("Display name saved");
      setTouched(false);
      reload();
    } catch (err) {
      toastError(err, "The name couldn’t be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="account-heading" className="flex flex-col gap-4">
      <SectionTitle>
        <span id="account-heading">Account</span>
      </SectionTitle>

      <Card>
        <div className="flex flex-col gap-3.5 p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-[13px] font-semibold">Signed in</h3>
              <p className="mt-[3px] [overflow-wrap:anywhere] font-mono text-[12px] text-t2">{user?.email}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={leaving}
              onClick={async () => {
                setLeaving(true);
                await signOut();
              }}
              className="cursor-pointer rounded-control border-line-strong bg-transparent text-[12.5px] font-semibold hover:bg-hover dark:bg-transparent dark:hover:bg-hover"
            >
              {leaving ? "Signing out…" : "Sign out"}
            </Button>
          </div>
          <form onSubmit={save} className="flex items-end gap-2 border-t border-line2 pt-3.5">
            <Field
              label="Display name"
              value={name}
              onChange={(v) => {
                setTouched(true);
                setDraft(v);
              }}
              placeholder="Shown to teammates"
              autoComplete="name"
              className="max-w-[320px] flex-1"
            />
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
        </div>
      </Card>

      <Card>
        <CardHeader title="Terms you have accepted" />
        <AcceptedTermsList />
      </Card>
    </section>
  );
}

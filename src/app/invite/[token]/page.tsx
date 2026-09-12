"use client";

/*
 * Where an invite email lands. Outside the (app) group on purpose: that
 * layout redirects signed-out users to /login and the token would be lost.
 * The lookup is public (organization, role, masked address); accepting needs
 * a session for the invited address.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import {
  acceptInviteByToken,
  clearApiCaches,
  errorCode,
  fetchInviteByToken,
  PublicInvite,
  setActiveWorkspaceId,
} from "@/app/lib/api";
import { useAuth } from "@/components/app/AuthProvider";
import { PortalHeader } from "@/components/shared/PortalHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { errorText } from "@/lib/feedback";
import { until } from "@/lib/time";

const GONE: Record<string, string> = {
  invite_expired: "This invite has expired — ask for a new one.",
  invite_revoked: "This invite was revoked.",
  invite_accepted: "This invite has already been accepted.",
  invite_not_found: "This invite link is not valid.",
};

export default function InvitePage() {
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  const { session, user, loading } = useAuth();
  const [invite, setInvite] = useState<PublicInvite | null>(null);
  const [gone, setGone] = useState("");
  const [mismatch, setMismatch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Invitation — Rippit";
    let live = true;
    fetchInviteByToken(token)
      .then((inv) => live && setInvite(inv))
      .catch((e: unknown) => {
        if (!live) return;
        const code = errorCode(e);
        setGone((code && GONE[code]) || GONE.invite_not_found);
      });
    return () => {
      live = false;
    };
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await acceptInviteByToken(token);
      setActiveWorkspaceId(res.workspaceId);
      clearApiCaches();
      router.replace("/dashboard");
    } catch (e) {
      const code = errorCode(e);
      if (code === "invite_email_mismatch") {
        setMismatch(`This invite was sent to ${invite?.emailMasked ?? "another address"} — sign in with that address.`);
      } else if (code && GONE[code]) {
        setGone(GONE[code]);
      } else {
        setError(errorText(e, "The invite couldn’t be accepted. Try again."));
      }
      setBusy(false);
    }
  };

  const signOutToSwitch = async () => {
    await supabase.auth.signOut();
    clearApiCaches();
    window.location.assign(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  };

  const next = encodeURIComponent(`/invite/${token}`);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-t1">
      <PortalHeader crumb="invitation" />
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center gap-4 px-6 py-16 outline-none">
        {gone ? (
          <p role="status" className="text-[13.5px] text-t2">
            {gone}
          </p>
        ) : !invite ? (
          <p role="status" className="font-mono text-[11px] text-t3">
            loading…
          </p>
        ) : (
          <div className="flex flex-col gap-4 rounded-card border border-line bg-panel p-5">
            <div>
              <p className="text-[12px] text-t3">You are invited to</p>
              <h1 className="mt-0.5 [overflow-wrap:anywhere] text-[18px] font-bold tracking-[-0.02em]">{invite.organizationName || "an organization"}</h1>
              <p className="mt-1.5 font-mono text-[11px] text-t3">
                as {invite.role} · for {invite.emailMasked}
                {invite.inviterName ? ` · from ${invite.inviterName}` : ""}
                {invite.expiresAt ? ` · expires ${until(invite.expiresAt)}` : ""}
              </p>
            </div>

            {loading ? null : mismatch ? (
              <>
                <p role="alert" className="text-[13px] text-warn-text">
                  {mismatch}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={signOutToSwitch}
                  className="h-auto w-full cursor-pointer rounded-control border-line-strong bg-transparent py-2.5 text-[13.5px] font-semibold hover:bg-hover dark:bg-transparent dark:hover:bg-hover"
                >
                  Sign out
                </Button>
              </>
            ) : session && user ? (
              <>
                <p className="font-mono text-[11px] text-t3">signed in as {user.email}</p>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={accept}
                  className="h-auto w-full cursor-pointer rounded-control py-2.5 text-[13.5px] font-semibold hover:opacity-85 disabled:opacity-50"
                >
                  {busy ? "Joining…" : "Accept"}
                  {!busy && <ArrowRight aria-hidden="true" className="size-3.5" />}
                </Button>
                {error && (
                  <p role="alert" className="text-[12.5px] text-err-text">
                    {error}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-[12.5px] text-t3">Sign in with that address to accept.</p>
                <Button
                  type="button"
                  onClick={() => router.push(`/login?next=${next}`)}
                  className="h-auto w-full cursor-pointer rounded-control py-2.5 text-[13.5px] font-semibold hover:opacity-85"
                >
                  Sign in
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

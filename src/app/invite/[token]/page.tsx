"use client";

/*
 * Where an invite email lands. Outside the (app) group on purpose: that
 * layout redirects signed-out users to /login and the token would be lost.
 *
 * One page carries the whole path. The public lookup says who invited you to
 * what and whether the invited address already has an account:
 *   - no account   → name + password here; the API creates the account for
 *                    the invited address (confirmed — the link proved the
 *                    inbox), then this page signs in and accepts.
 *   - an account   → Sign in (`/login?next=/invite/{token}`) and back here.
 *   - signed in    → Accept; a different address gets Sign out, which lands
 *                    back on this page rather than on /login.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import {
  acceptInviteByToken,
  clearApiCaches,
  createInviteAccount,
  errorCode,
  fetchInviteByToken,
  PublicInvite,
  setActiveWorkspaceId,
} from "@/app/lib/api";
import { useAuth } from "@/components/app/AuthProvider";
import { LogoMark } from "@/components/shared/LogoMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { errorText } from "@/lib/feedback";
import { until } from "@/lib/time";

const GONE: Record<string, string> = {
  invite_expired: "This invite has expired. Ask whoever invited you to send a new one.",
  invite_revoked: "This invite was revoked.",
  invite_accepted: "This invite has already been accepted.",
  invite_not_found: "This invite link is not valid.",
};

const PASSWORD_MIN = 8;

const primaryButton =
  "h-auto w-full cursor-pointer rounded-control py-2.5 text-[13.5px] font-semibold hover:opacity-85 disabled:opacity-50";
const inputClass = "h-9 rounded-control border-line-strong bg-hover text-[14px] placeholder:text-t3";
const linkButton = "cursor-pointer text-t2 underline-offset-2 hover:text-t1 hover:underline";

export default function InvitePage() {
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  const { session, user, loading } = useAuth();
  const [invite, setInvite] = useState<PublicInvite | null>(null);
  const [gone, setGone] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // Set while create → sign in → accept runs, so the session appearing
  // mid-way does not swap the form for the signed-in view.
  const [joining, setJoining] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [signInFirst, setSignInFirst] = useState(false);

  useEffect(() => {
    document.title = "Invitation — Orrit";
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

  const organization = invite?.organizationName;
  // An invitation to Orrit itself names no organization.
  const isPlatform = !organization;
  const next = encodeURIComponent(`/invite/${token}`);
  const hasAccount = signInFirst || invite?.accountExists === true;

  const failAccept = (e: unknown) => {
    const code = errorCode(e);
    if (code === "invite_email_mismatch") setMismatch(true);
    else if (code && GONE[code]) setGone(GONE[code]);
    else setError(errorText(e, "The invite couldn’t be accepted. Try again."));
  };

  const finish = async () => {
    const res = await acceptInviteByToken(token);
    setActiveWorkspaceId(res.workspaceId);
    clearApiCaches();
    router.replace("/dashboard");
  };

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      await finish();
    } catch (e) {
      failAccept(e);
      setBusy(false);
    }
  };

  const createAndJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (password.length < PASSWORD_MIN) {
      setError(`Use at least ${PASSWORD_MIN} characters for your password.`);
      return;
    }
    setBusy(true);
    let email: string;
    try {
      ({ email } = await createInviteAccount(token, { password, displayName: name.trim() || undefined }));
    } catch (err) {
      const code = errorCode(err);
      if (code === "account_exists") {
        setSignInFirst(true);
        setNotice("You already have a Orrit account for this address. Sign in to accept.");
      } else if (code && GONE[code]) {
        setGone(GONE[code]);
      } else {
        setError(errorText(err, "Your account couldn’t be created. Try again."));
      }
      setBusy(false);
      return;
    }
    setJoining(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
    } catch {
      // The account exists; only the automatic sign-in failed.
      setJoining(false);
      setBusy(false);
      setSignInFirst(true);
      setNotice("Your account is ready. Sign in to accept the invite.");
      return;
    }
    try {
      await finish();
    } catch (err) {
      setJoining(false);
      setBusy(false);
      failAccept(err);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    clearApiCaches();
    setMismatch(false);
    setError("");
    setBusy(false);
  };

  const heading = invite
    ? isPlatform
      ? "You’re invited to Orrit"
      : invite.inviterName
        ? `${invite.inviterName} invited you to`
        : "You’re invited to"
    : "";

  return (
    <main
      id="main"
      tabIndex={-1}
      className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-vpbg p-4 outline-none"
      style={{
        backgroundImage: "radial-gradient(var(--dot) 1.2px, transparent 1.6px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 70% 60% at 50% 45%, transparent 0%, var(--vpbg) 85%)" }}
      />

      <div className="relative w-full max-w-[400px]" style={{ animation: "riseIn .55s var(--ease-out) both" }}>
        <div className="mb-7 flex items-center justify-center gap-2.5">
          <LogoMark size={18} />
          <span className="text-[17px] font-extrabold tracking-[-0.02em]">orrit</span>
        </div>

        <div className="rounded-card border border-line bg-panel shadow-[var(--shadow-float)] backdrop-blur-[14px]">
          {gone ? (
            <div className="space-y-4 p-6 text-center">
              <p role="status" className="text-[14px] leading-relaxed text-t2">
                {gone}
              </p>
              <Button type="button" variant="outline" onClick={() => router.push("/login")} className={`${primaryButton} border-line-strong bg-transparent hover:bg-hover dark:bg-transparent dark:hover:bg-hover`}>
                Go to Orrit
              </Button>
            </div>
          ) : !invite ? (
            <div className="space-y-3 p-6" role="status" aria-label="Loading invitation">
              <div className="h-3 w-32 animate-pulse rounded bg-hover" />
              <div className="h-6 w-52 animate-pulse rounded bg-hover" />
              <div className="h-3 w-40 animate-pulse rounded bg-hover" />
            </div>
          ) : (
            <>
              <div className="border-b border-line px-6 pb-5 pt-6 text-center">
                {!isPlatform && <p className="text-[13px] text-t3">{heading}</p>}
                <h1 className="mt-1 [overflow-wrap:anywhere] text-[22px] font-bold leading-tight tracking-[-0.02em]">
                  {isPlatform ? heading : organization}
                </h1>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 font-mono text-[11px] text-t3">
                  {!isPlatform && (
                    <span className="rounded-full border border-line px-2 py-0.5 capitalize">{invite.role}</span>
                  )}
                  <span className="rounded-full border border-line px-2 py-0.5">{invite.emailMasked}</span>
                  {invite.expiresAt && (
                    <span className="rounded-full border border-line px-2 py-0.5">expires {until(invite.expiresAt)}</span>
                  )}
                </div>
              </div>

              <div className="space-y-4 p-6">
                {loading ? (
                  <div className="h-9 animate-pulse rounded-control bg-hover" />
                ) : joining ? (
                  <p role="status" className="flex items-center justify-center gap-2 py-2 text-[13.5px] text-t2">
                    <span aria-hidden="true" className="spin inline-block size-3 rounded-full border-[1.5px] border-current border-t-transparent" />
                    {isPlatform ? "Setting up your account…" : `Joining ${organization}…`}
                  </p>
                ) : session && user ? (
                  mismatch ? (
                    <>
                      <p role="alert" className="text-[13px] leading-relaxed text-warn-text">
                        You’re signed in as <span className="font-medium">{user.email}</span>, but this invite was sent to{" "}
                        {invite.emailMasked}.
                      </p>
                      <Button type="button" onClick={signOut} className={primaryButton}>
                        Sign out and continue
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button type="button" disabled={busy} onClick={accept} className={primaryButton}>
                        {busy ? "Joining…" : isPlatform ? "Accept invite" : `Join ${organization}`}
                        {!busy && <ArrowRight aria-hidden="true" className="size-3.5" />}
                      </Button>
                      {error && (
                        <p role="alert" className="text-center text-[12.5px] text-err-text">
                          {error}
                        </p>
                      )}
                      <p className="text-center text-[12px] text-t3">
                        Signed in as {user.email} ·{" "}
                        <button type="button" onClick={signOut} className={linkButton}>
                          Not you?
                        </button>
                      </p>
                    </>
                  )
                ) : hasAccount ? (
                  <>
                    <p className="text-center text-[13.5px] leading-relaxed text-t2">
                      {notice || `Sign in as ${invite.emailMasked} to accept.`}
                    </p>
                    <Button type="button" onClick={() => router.push(`/login?next=${next}`)} className={primaryButton}>
                      Sign in to accept
                      <ArrowRight aria-hidden="true" className="size-3.5" />
                    </Button>
                  </>
                ) : (
                  <form onSubmit={createAndJoin} className="space-y-4">
                    <div>
                      <p className="text-[14px] font-semibold">Create your account</p>
                      <p className="mt-0.5 text-[12.5px] text-t3">You’ll sign in with {invite.emailMasked}.</p>
                    </div>
                    <div>
                      <label htmlFor="invite-name" className="mb-1.5 block text-[12px] font-semibold text-t3">
                        Your name
                      </label>
                      <Input
                        id="invite-name"
                        autoComplete="name"
                        maxLength={60}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Jane Cooper"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="invite-password" className="mb-1.5 block text-[12px] font-semibold text-t3">
                        Password
                      </label>
                      <Input
                        id="invite-password"
                        type="password"
                        required
                        minLength={PASSWORD_MIN}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={`At least ${PASSWORD_MIN} characters`}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? "invite-error" : undefined}
                        className={inputClass}
                      />
                    </div>
                    {error && (
                      <p role="alert" id="invite-error" className="text-[12.5px] text-err-text">
                        {error}
                      </p>
                    )}
                    <Button type="submit" disabled={busy} className={primaryButton}>
                      {busy ? "Creating account…" : isPlatform ? "Create account" : "Create account and join"}
                      {!busy && <ArrowRight aria-hidden="true" className="size-3.5" />}
                    </Button>
                    <p className="text-center text-[12px] text-t3">
                      Already have an account?{" "}
                      <button type="button" onClick={() => router.push(`/login?next=${next}`)} className={linkButton}>
                        Sign in
                      </button>
                    </p>
                  </form>
                )}
              </div>
            </>
          )}
        </div>

        <p className="mx-auto mt-6 max-w-[320px] text-center text-[11.5px] leading-relaxed text-t3">
          Orrit is a read-only map of your Make and GoHighLevel automations. It never edits or triggers anything.
        </p>
      </div>
    </main>
  );
}

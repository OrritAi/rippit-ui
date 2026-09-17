"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/app/AuthProvider";
import { supabase } from "@/lib/supabase";
import { LoadingState } from "@/components/shared/LoadingState";

const EASE = [0.22, 1, 0.36, 1] as const;

/*
 * Landing page for Supabase password-recovery links. The emailed link
 * carries a recovery token; the Supabase client exchanges it on load
 * (detectSessionInUrl), so a valid link arrives here already holding a
 * session — we just set the new password.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords don’t match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t update password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      id="main"
      tabIndex={-1}
      className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-vpbg p-4"
      style={{
        backgroundImage: "radial-gradient(var(--dot) 1.2px, transparent 1.6px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 45%, transparent 0%, var(--vpbg) 85%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: EASE }}
        className="relative w-full max-w-sm"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <motion.div
            aria-hidden="true"
            initial={{ rotate: 0, opacity: 0 }}
            animate={{ rotate: 45, opacity: 1 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.1 }}
            className="mb-5 flex size-10 items-center justify-center rounded-[11px] bg-t1"
          >
            <div className="size-3 rounded-full bg-bg" />
          </motion.div>
          <h1 className="text-[27px] font-bold tracking-[-0.5px]">orrit</h1>
          <p className="mt-1.5 text-[14px] text-t2">
            {session ? "Set a new password" : "Password reset"}
          </p>
        </div>

        <div className="space-y-4 rounded-card border border-line bg-panel p-6 shadow-[0_12px_34px_var(--shade)] backdrop-blur-[14px]">
          {loading ? (
            <div className="py-6">
              <LoadingState message="Checking your reset link…" />
            </div>
          ) : !session ? (
            <div className="space-y-4 text-center">
              <p role="alert" className="text-[13.5px] leading-relaxed text-t2">
                This reset link is invalid or has expired — they’re single-use
                and time-limited.
              </p>
              <Link
                href="/login"
                className="inline-block text-[13px] font-semibold text-t1 underline-offset-4 hover:underline"
              >
                Request a new one from the sign-in page
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label
                  htmlFor="new-password"
                  className="mb-1.5 block text-[12px] font-semibold text-t3"
                >
                  New password
                </label>
                <Input
                  id="new-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "reset-error" : undefined}
                  className="h-9 rounded-control border-line-strong bg-hover text-[14px] placeholder:text-t3"
                />
              </div>
              <div>
                <label
                  htmlFor="confirm-password"
                  className="mb-1.5 block text-[12px] font-semibold text-t3"
                >
                  Confirm password
                </label>
                <Input
                  id="confirm-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Same again"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "reset-error" : undefined}
                  className="h-9 rounded-control border-line-strong bg-hover text-[14px] placeholder:text-t3"
                />
              </div>

              {error && (
                <motion.div
                  role="alert"
                  id="reset-error"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-control border border-[color-mix(in_srgb,var(--err)_32%,transparent)] bg-[color-mix(in_srgb,var(--err)_10%,transparent)] px-3 py-2 text-[13px] text-err-text"
                >
                  {error}
                </motion.div>
              )}

              <Button
                type="submit"
                disabled={busy}
                className="h-auto w-full cursor-pointer rounded-control py-2.5 text-[13.5px] font-semibold hover:opacity-85 disabled:opacity-50"
              >
                {busy ? "Updating…" : "Set new password"}
                {!busy && (
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                )}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center font-mono text-[11px] text-t3">
          orrit · workflow monitor
        </p>
      </motion.div>
    </main>
  );
}

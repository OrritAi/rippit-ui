"use client";

/*
 * Where the bookmarklet lands.
 *
 * Top-level rather than inside the (app) group on purpose: that layout
 * redirects signed-out users to /login, and a redirect would take the URL
 * fragment with it. So this page reads the fragment into memory *before* any
 * auth check, stashes it for the round trip, and strips it from the URL
 * immediately — the GoHighLevel token should not sit in session history.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { useAuth } from "@/components/app/AuthProvider";
import { Button } from "@/components/ui/button";
import LocationPicker from "@/components/connect/LocationPicker";
import {
  connectContainers,
  connectGhlAccount,
  fetchContainers,
  type ContainerList,
  type ContainerRow,
} from "@/app/lib/api";
import {
  HANDOFF_ERRORS,
  parseHandoff,
  type HandoffPayload,
} from "@/lib/bookmarklet";

const STASH_KEY = "orrit.connect.handoff";
// Mirrors MAX_CONTAINERS_PER_REQUEST on the API.
const MAX_PER_REQUEST = 25;

type Phase = "reading" | "signin" | "connecting" | "choosing" | "done" | "error";

export default function ConnectPage() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>("reading");
  const [message, setMessage] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [list, setList] = useState<ContainerList | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectedCount, setConnectedCount] = useState(0);
  const payload = useRef<HandoffPayload | null>(null);
  const started = useRef(false);

  // 1. Take the fragment before anything else can navigate away from it.
  useEffect(() => {
    const fromUrl = parseHandoff(window.location.hash);
    if (fromUrl) {
      payload.current = fromUrl;
      sessionStorage.setItem(STASH_KEY, JSON.stringify(fromUrl));
      // Out of the address bar and out of session history.
      history.replaceState(null, "", window.location.pathname);
    } else {
      const stashed = sessionStorage.getItem(STASH_KEY);
      if (stashed) {
        try {
          payload.current = JSON.parse(stashed) as HandoffPayload;
        } catch {
          /* malformed stash is the same as no stash */
        }
      }
    }
    if (!payload.current) {
      setPhase("error");
      setMessage(
        "Nothing to connect. Click the Orrit bookmark from a GoHighLevel tab."
      );
    }
  }, []);

  const connect = useCallback(async () => {
    const data = payload.current;
    if (!data?.refreshToken) return;
    setPhase("connecting");
    try {
      const account = await connectGhlAccount(data.refreshToken);
      sessionStorage.removeItem(STASH_KEY);
      payload.current = null; // the token is stored server-side now
      setAccountId(account.id);
      const containers = await fetchContainers(account.id);
      setList(containers);
      setPhase("choosing");
    } catch (e) {
      setPhase("error");
      setMessage(
        e instanceof Error ? e.message : "Could not connect that GoHighLevel session."
      );
    }
  }, []);

  // 2. Once we know who the user is, either connect or send them to sign in.
  useEffect(() => {
    if (loading || started.current) return;
    const data = payload.current;
    if (!data) return;
    if (data.error) {
      started.current = true;
      setPhase("error");
      setMessage(HANDOFF_ERRORS[data.error] ?? "Could not read your GoHighLevel session.");
      return;
    }
    if (!session) {
      setPhase("signin");
      return;
    }
    started.current = true;
    void connect();
  }, [loading, session, connect]);

  async function handleConnect(chosen: ContainerRow[]) {
    if (!accountId) return;
    setBusy(true);
    try {
      const result = await connectContainers(
        accountId,
        chosen.map((c) => ({ external_id: c.externalId, name: c.name }))
      );
      setConnectedCount(result.count);
      setPhase("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not connect those sub-accounts.");
    } finally {
      setBusy(false);
    }
  }

  const noun = list?.containerNoun ?? "sub-account";

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 px-6 py-16">
      <header>
        <h1 className="text-[19px] font-semibold tracking-[-0.02em]">
          Connect GoHighLevel
        </h1>
        <p className="mt-1 text-[13.5px] text-t2">
          {phase === "choosing"
            ? `Your session works. Choose which ${noun}s Orrit should read.`
            : "Handing your GoHighLevel session to Orrit."}
        </p>
      </header>

      {(phase === "reading" || phase === "connecting") && (
        <p role="status" className="flex items-center gap-2 text-[13.5px] text-t2">
          <span
            aria-hidden="true"
            className="size-3.5 animate-spin rounded-full border-2 border-t2 border-t-transparent motion-reduce:animate-none"
          />
          {phase === "reading" ? "Reading the handoff…" : "Checking the session…"}
        </p>
      )}

      {phase === "signin" && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-panel p-4">
          <p className="text-[13.5px] text-t2">
            Sign in to Orrit and this will pick up where it left off — your
            GoHighLevel session is held in this tab only.
          </p>
          <Button
            onClick={() => router.push("/login?next=/connect")}
            className="h-auto w-full cursor-pointer rounded-control py-2.5 text-[13.5px] font-semibold"
          >
            Sign in
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      )}

      {phase === "choosing" && list && (
        <>
          {list.canEnumerate && list.complete === false && (
            <p
              role="status"
              className="rounded-card border border-[color-mix(in_srgb,var(--warn)_32%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-warn-text"
            >
              HighLevel only returned part of your account, so this list may be
              missing {noun}s. Connect what you see now — opening a missing{" "}
              {noun} in HighLevel and clicking the bookmark again adds it.
            </p>
          )}
          {list.canEnumerate ? (
            <LocationPicker
              containers={list.containers}
              noun={noun}
              busy={busy}
              max={MAX_PER_REQUEST}
              onConnect={handleConnect}
            />
          ) : (
            /* Enumeration failing is a real answer, not an error: GoHighLevel
               publishes no listing endpoint we can rely on. Say so rather than
               claiming the account has no sub-accounts. */
            <div className="rounded-card border border-line bg-panel p-4 text-[13.5px] text-t2">
              <p>
                Your session is connected, but GoHighLevel didn’t give us a list
                of {noun}s to choose from.
              </p>
              <p className="mt-2 text-t3">
                Open a {noun} in GoHighLevel and click the Orrit bookmark again
                — connecting from inside one picks it up directly.
              </p>
            </div>
          )}
          {message && (
            <p role="alert" className="text-[12.5px] text-err-text">
              {message}
            </p>
          )}
        </>
      )}

      {phase === "done" && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-panel p-4">
          <p className="flex items-center gap-2 text-[13.5px] text-ok-text">
            <Check aria-hidden="true" className="size-4" />
            {connectedCount} {connectedCount === 1 ? noun : `${noun}s`} connected —
            syncing now.
          </p>
          <p className="text-[12.5px] text-t3">
            Workflows appear as each one finishes. You don’t need to wait here.
          </p>
          <Button
            onClick={() => router.push("/dashboard")}
            className="h-auto w-full cursor-pointer rounded-control py-2.5 text-[13.5px] font-semibold"
          >
            Open Orrit
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col gap-3 rounded-card border border-[color-mix(in_srgb,var(--err)_32%,transparent)] bg-[color-mix(in_srgb,var(--err)_8%,transparent)] p-4">
          <p className="flex items-start gap-2 text-[13.5px] text-err-text">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {message}
          </p>
          <Button
            variant="outline"
            onClick={() => router.push("/settings/connections")}
            className="h-auto w-full cursor-pointer rounded-control py-2.5 text-[13.5px]"
          >
            Back to Connections
          </Button>
        </div>
      )}
    </main>
  );
}

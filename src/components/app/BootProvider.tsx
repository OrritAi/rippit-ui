"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { INTRO } from "@/components/dashboard/globe/intro";
import { LogoMark } from "@/components/shared/LogoMark";

/*
 * The boot screen: what a landing paints first, in place of a spinner. Page
 * background, the mark, the wordmark and a live status line rise in (the
 * design-system entrance register) and stay up while the session, the
 * workspace and — on the home page — the globe's estate load. It lifts the
 * moment the view underneath is ready to be seen, never before its own
 * entrance has finished, and plays on every landing: a fresh document is a
 * fresh boot; in-app navigation never sees it.
 *
 * The home page owns the fade. The globe claims the screen on mount and, once
 * it has nodes, asks for an intro clock: the cover fades at t = 1.0s of that
 * clock (INTRO.overlayFadeAtMs), so the sphere's ring is three-quarters drawn
 * as the cover lifts — the handoff timeline, whatever the network did. Every
 * other landing releases the screen as soon as the shell is up.
 *
 * The cover is pointer-events: none throughout, so an eager user can start
 * dragging the globe (or hit the rail) before it has gone.
 */

export const BOOT_HOME_PATH = "/dashboard";

export const BOOT_LINES = {
  auth: "signing you in…",
  workspace: "loading organization…",
  connecting: "connecting platforms…",
  indexing: (workflows: number) =>
    `connecting platforms · indexing ${workflows} workflow${workflows === 1 ? "" : "s"}`,
} as const;

/** Nobody claimed or released the screen (a crashed view, say): drop it. */
const SAFETY_MS = 12_000;

interface BootCtx {
  /** Whether the cover is still mounted (fading counts as mounted). */
  visible: boolean;
  setLine: (line: string) => void;
  /** Take the fade over. True while the screen is up (a pending release is
   *  cancelled); false once it has gone, when there is nothing to own. */
  claim: () => boolean;
  /** The estate is in: show its count for a beat, fade, and return the intro
   *  clock's origin (performance.now() domain) — the fade is its t = 1.0s. */
  start: (line: string) => number;
  /** Fade now — after the entrance has finished, never mid-rise. */
  release: () => void;
}

const now = () => (typeof performance === "undefined" ? 0 : performance.now());
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const Ctx = createContext<BootCtx>({
  visible: false,
  setLine: () => {},
  claim: () => false,
  start: now,
  release: () => {},
});

export function useBoot() {
  return useContext(Ctx);
}

type Phase = "up" | "scheduled" | "down";

export function BootProvider({ children }: { children: React.ReactNode }) {
  const [shownAt] = useState(now);
  const [visible, setVisible] = useState(true);
  const [line, setLine] = useState<string>(BOOT_LINES.auth);
  const phase = useRef<Phase>("up");
  const timer = useRef<number | null>(null);
  const origin = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const drop = useCallback(() => {
    cancel();
    phase.current = "down";
    setVisible(false);
  }, [cancel]);
  const fadeAt = useCallback(
    (at: number) => {
      cancel();
      phase.current = "scheduled";
      const wait = at - now();
      if (wait <= 0) drop();
      else timer.current = window.setTimeout(drop, wait);
    },
    [cancel, drop],
  );

  const release = useCallback(() => {
    if (phase.current !== "up") return;
    fadeAt(reducedMotion() ? now() : Math.max(now(), shownAt + INTRO.overlayFadeAtMs));
  }, [fadeAt, shownAt]);

  const start = useCallback(
    (next: string) => {
      setLine(next);
      if (phase.current === "down") return now();
      if (origin.current === null) {
        const t = now();
        const at = reducedMotion() ? t : Math.max(t + INTRO.readyHoldMs, shownAt + INTRO.overlayFadeAtMs);
        origin.current = at - INTRO.overlayFadeAtMs;
        fadeAt(at);
      }
      return origin.current;
    },
    [fadeAt, shownAt],
  );

  const claim = useCallback(() => {
    if (phase.current === "down") return false;
    // A release from a view we are replacing is cancelled; a fade the
    // intro itself scheduled is not.
    if (phase.current === "scheduled" && origin.current === null) {
      cancel();
      phase.current = "up";
    }
    return true;
  }, [cancel]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (phase.current !== "down") drop();
    }, SAFETY_MS);
    return () => {
      clearTimeout(t);
      cancel();
    };
  }, [cancel, drop]);

  const value = useMemo(() => ({ visible, setLine, claim, start, release }), [visible, claim, start, release]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <BootScreen visible={visible} line={line} />
    </Ctx.Provider>
  );
}

const rise = (delayMs: number): React.CSSProperties => ({
  animation: `riseIn 450ms var(--ease-out) ${delayMs}ms both`,
});

function BootScreen({ visible, line }: { visible: boolean; line: string }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="boot"
          className="pointer-events-none fixed inset-0 z-[100] grid place-items-center bg-bg text-t1"
          exit={{ opacity: 0 }}
          transition={{ duration: INTRO.overlayFadeDurMs / 1000, ease: "easeOut" }}
        >
          <div className="flex flex-col items-center gap-[14px]">
            <LogoMark size={26} style={rise(0)} />
            <div className="text-[20px] font-extrabold tracking-[-0.02em]" style={rise(120)}>
              rippit
            </div>
            <div role="status" className="flex items-center gap-[7px] font-mono text-[11.5px] text-t3" style={rise(240)}>
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-ok"
                style={{ boxShadow: "0 0 8px var(--ok)", animation: "blinkdot 1.4s ease-in-out infinite" }}
              />
              {line}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

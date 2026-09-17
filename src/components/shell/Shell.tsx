"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { IconRail } from "./IconRail";
import { AnimatePresence, motion } from "framer-motion";
import { SidePanel, panelFor } from "./SidePanel";
import { SupportBanner } from "./SupportBanner";
import { isTypingTarget, NARROW_QUERY, overlayOpen, setRailTransient, useShell } from "./shell-context";
import { useStoredJson, writeStored } from "@/lib/stored";
import { usePalette } from "@/components/palette/palette-context";

/*
 * Application shell: icon rail (52) → optional contextual side panel (206)
 * → the view. Under 1100px the browser floats over the view instead of taking
 * width, and closes on navigation.
 *
 * A page can ask for room through one channel — `useFullBleed` on the shell
 * context. `header` drops the search bar because the page carries its own
 * (Settings); `full` drops the rail and the browser column too, and with them
 * the `[` shortcut, because the page is the whole screen (the workflow
 * history surface). No part of the shell recognises a page by its pathname.
 *
 * Global keys live here (one listener): ⌘K toggles the action hub, Esc walks
 * the escape layers (palette → overlays → page dock), `[` toggles the browser.
 */
const EASE = [0.22, 1, 0.36, 1] as const;

function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

const PANEL_WIDTH_KEY = "orrit.panelWidth";
const PANEL_DEFAULT = 206;
const PANEL_MIN = 180;
const PANEL_MAX = 560;
const clampWidth = (w: number) => Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(Number.isFinite(w) ? w : PANEL_DEFAULT)));

export function Shell({ children }: { children: React.ReactNode }) {
  const { railOpen, toggleRail, fireEscape, fullBleed } = useShell();
  const palette = usePalette();
  const pathname = usePathname();
  // Show the shortcut that actually works on this platform, not both.
  const [shortcutHint, setShortcutHint] = useState("⌘K");
  useEffect(() => {
    const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
    setShortcutHint(mac ? "⌘K" : "Ctrl K");
  }, []);
  const narrow = useMediaQuery(NARROW_QUERY);
  const bleed = fullBleed === "full";
  const available = !bleed && !!panelFor(pathname).Component;
  const show = railOpen && available;

  /* ---- resizable browser column ---- */
  const storedWidth = useStoredJson<number>(PANEL_WIDTH_KEY, PANEL_DEFAULT);
  const panelWidth = clampWidth(storedWidth);
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef<{ x: number; w: number; raf: number } | null>(null);
  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      resizeRef.current = { x: e.clientX, w: panelWidth, raf: 0 };
      setResizing(true);
      const move = (ev: PointerEvent) => {
        const r = resizeRef.current;
        if (!r) return;
        const next = clampWidth(r.w + (ev.clientX - r.x));
        if (r.raf) return;
        r.raf = requestAnimationFrame(() => {
          r.raf = 0;
          writeStored(PANEL_WIDTH_KEY, next);
        });
      };
      const up = (ev: PointerEvent) => {
        const r = resizeRef.current;
        if (r) writeStored(PANEL_WIDTH_KEY, clampWidth(r.w + (ev.clientX - r.x)));
        resizeRef.current = null;
        setResizing(false);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    },
    [panelWidth]
  );
  const onResizeKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 48 : 16;
      if (e.key === "ArrowLeft") writeStored(PANEL_WIDTH_KEY, clampWidth(panelWidth - step));
      else if (e.key === "ArrowRight") writeStored(PANEL_WIDTH_KEY, clampWidth(panelWidth + step));
      else if (e.key === "Home") writeStored(PANEL_WIDTH_KEY, PANEL_DEFAULT);
      else return;
      e.preventDefault();
    },
    [panelWidth]
  );

  // The overlay browser closes when you navigate — but only as an overlay.
  // `setRailTransient` leaves the stored preference alone, so widening the
  // window (or the next visit) still shows the column the user chose.
  useEffect(() => {
    if (narrow) setRailTransient(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Wide enough for a column again: the dismissal was about the overlay.
  useEffect(() => {
    if (!narrow) setRailTransient(null);
  }, [narrow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "k") {
        e.preventDefault();
        palette.setOpen(!palette.isOpen);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (k === "Escape") {
        if (palette.isOpen || overlayOpen()) return; // they handle themselves
        if (fireEscape()) e.preventDefault();
        return;
      }
      if (isTypingTarget(e.target) || palette.isOpen || overlayOpen()) return;
      if (k === "[") {
        e.preventDefault();
        if (available) toggleRail();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [palette, toggleRail, fireEscape, available]);

  return (
    <div className="flex h-svh overflow-hidden bg-bg text-t1">
      {!bleed && <IconRail />}
      <AnimatePresence initial={false}>
        {show && !narrow && (
          <motion.div
            key="panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: resizing ? 0 : 0.28, ease: EASE }}
            className="relative h-full flex-none overflow-hidden"
          >
            <SidePanel />
            {/* Resize handle: drag (or arrow keys) to set the browser's width;
                the choice persists per viewer. */}
            {/* The WAI-ARIA window-splitter pattern is a focusable separator
                that takes pointer + arrow keys; the a11y rule cannot see the
                role's interactive variant. */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize side panel"
              aria-valuemin={PANEL_MIN}
              aria-valuemax={PANEL_MAX}
              aria-valuenow={panelWidth}
              tabIndex={0}
              onPointerDown={onResizeStart}
              onKeyDown={onResizeKey}
              className={`absolute inset-y-0 right-0 z-10 w-[6px] cursor-col-resize select-none touch-none outline-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-line after:transition-colors hover:after:bg-line-strong focus-visible:after:bg-line-strong ${resizing ? "after:bg-line-strong" : ""}`}
            />
          </motion.div>
        )}
        {show && narrow && (
          <motion.div key="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="fixed inset-0 z-20">
            {/* Dismissing the overlay is not a layout choice either: transient,
                so the column is still there on a wide screen. */}
            <button type="button" aria-label="Close side panel" onClick={() => setRailTransient(false)} className="absolute inset-0 bg-[color-mix(in_srgb,var(--bg)_55%,transparent)]" />
            <motion.div initial={{ x: -24 }} animate={{ x: 0 }} exit={{ x: -24 }} transition={{ duration: 0.24, ease: EASE }} className="absolute inset-y-0 left-[52px] z-30 shadow-[var(--shadow-float)]" style={{ width: panelWidth }}>
              <SidePanel />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <main id="main" tabIndex={-1} className="relative flex min-w-0 flex-1 flex-col overflow-hidden outline-none">
        <SupportBanner />
        {/* Dropped by any page carrying its own header — Settings' portal
            header, the history surface's. */}
        {!fullBleed && (
          <header role="search" className="flex flex-none items-center border-b border-line bg-panel px-4 py-2">
            <button type="button" onClick={palette.open} aria-label="Search workflows, steps and assets" aria-haspopup="dialog" className="flex w-full max-w-2xl items-center gap-2 rounded-control border border-line bg-bg px-3 py-2 text-left text-[13px] text-t2 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ringc)]">
              <Search aria-hidden="true" className="size-4 flex-none" />
              <span className="flex-1">Search workflows, steps and assets…</span>
              <kbd className="hidden text-[11px] text-t3 sm:block">{shortcutHint}</kbd>
            </button>
          </header>
        )}
        <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE }} className="flex min-h-0 flex-1 flex-col">
          {children}
        </motion.div>
      </main>
    </div>
  );
}

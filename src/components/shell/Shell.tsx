"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { IconRail } from "./IconRail";
import { AnimatePresence, motion } from "framer-motion";
import { SidePanel, panelFor } from "./SidePanel";
import { isTypingTarget, overlayOpen, useShell } from "./shell-context";
import { usePalette } from "@/components/palette/palette-context";

/*
 * Application shell: icon rail (52) → optional contextual side panel (206)
 * → the view. Under 1100px the browser floats over the view instead of taking
 * width, and closes on navigation.
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

export function Shell({ children }: { children: React.ReactNode }) {
  const { railOpen, setRailOpen, toggleRail, fireEscape } = useShell();
  const palette = usePalette();
  const pathname = usePathname();
  // Show the shortcut that actually works on this platform, not both.
  const [shortcutHint, setShortcutHint] = useState("⌘K");
  useEffect(() => {
    const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
    setShortcutHint(mac ? "⌘K" : "Ctrl K");
  }, []);
  const narrow = useMediaQuery("(max-width: 1100px)");
  const available = !!panelFor(pathname).Component;
  const show = railOpen && available;

  // Overlay browser closes when you navigate.
  useEffect(() => {
    if (narrow && railOpen) setRailOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

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
      <IconRail />
      <AnimatePresence initial={false}>
        {show && !narrow && (
          <motion.div
            key="panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 206, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="relative h-full flex-none overflow-hidden"
          >
            <SidePanel />
          </motion.div>
        )}
        {show && narrow && (
          <motion.div key="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="fixed inset-0 z-20">
            <button type="button" aria-label="Close side panel" onClick={() => setRailOpen(false)} className="absolute inset-0 bg-[color-mix(in_srgb,var(--bg)_55%,transparent)]" />
            <motion.div initial={{ x: -24 }} animate={{ x: 0 }} exit={{ x: -24 }} transition={{ duration: 0.24, ease: EASE }} className="absolute inset-y-0 left-[52px] z-30 shadow-[var(--shadow-float)]">
              <SidePanel />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <main id="main" tabIndex={-1} className="relative flex min-w-0 flex-1 flex-col overflow-hidden outline-none">
        <header role="search" className="flex flex-none items-center border-b border-line bg-panel px-4 py-2">
          <button type="button" onClick={palette.open} aria-label="Search workflows, steps and assets" aria-haspopup="dialog" className="flex w-full max-w-2xl items-center gap-2 rounded-control border border-line bg-bg px-3 py-2 text-left text-[13px] text-t2 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ringc)]">
            <Search aria-hidden="true" className="size-4 flex-none" />
            <span className="flex-1">Search workflows, steps and assets…</span>
            <kbd className="hidden text-[11px] text-t3 sm:block">{shortcutHint}</kbd>
          </button>
        </header>
        <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE }} className="flex min-h-0 flex-1 flex-col">
          {children}
        </motion.div>
      </main>
    </div>
  );
}

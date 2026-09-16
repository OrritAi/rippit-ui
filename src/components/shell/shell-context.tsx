"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/*
 * Shell state shared by the icon rail, the browser column and the views:
 *  - railOpen: whether the 206px workflow browser is showing (persisted)
 *  - escape layers: the topmost registered handler wins on Esc, so a page
 *    can close its dock without fighting dialogs/palette (which register
 *    above it while open)
 *  - full bleed: the one channel a page has for asking the shell to step
 *    out of its way (`useFullBleed`), so no part of the shell has to
 *    recognise a page by its pathname
 */

/* Deliberately not `orrit.railOpen`. That key holds values nobody chose: a
 * navigation under 1100px used to write a collapse straight to storage, so an
 * existing "0" is as likely to be an accident as a preference and there is no
 * way to tell them apart. Reading a fresh key discards the lot once and lets
 * the corrected default apply. The old key is abandoned, not migrated. */
const RAIL_KEY = "orrit.railOpen.v2";

/** Below this the browser column is an overlay, not a column. Shared with
 *  `Shell`, which does the layout, so one number decides both. */
export const NARROW_QUERY = "(max-width: 1100px)";

const listeners = new Set<() => void>();
let railCache: boolean | null = null;
/* A viewport-driven close is not a preference. Navigating on a narrow screen
 * dismisses the overlay, and that used to be written straight to storage — so
 * one navigation on a laptop under 1100px erased the choice, and the browser
 * came back collapsed on every screen and every visit. The dismissal lives
 * here instead: it overrides the stored value until the user says otherwise
 * or the window is wide enough for a column again. */
let transient: boolean | null = null;

function stored(): boolean {
  try {
    const raw = localStorage.getItem(RAIL_KEY);
    // Nothing stored is a first visit, not a preference for collapsed. The
    // browser column *is* the navigation, so it opens — unless the window is
    // too narrow to hold one, where it would land as an overlay over the page.
    if (raw === null) return !window.matchMedia(NARROW_QUERY).matches;
    return raw === "1";
  } catch {
    return false;
  }
}

function readRail(): boolean {
  if (transient !== null) return transient;
  if (railCache === null) railCache = stored();
  return railCache;
}

function writeRail(v: boolean) {
  transient = null;
  railCache = v;
  try {
    localStorage.setItem(RAIL_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Change the live value without recording it as a choice. `null` drops the
 *  override and the stored preference applies again. */
export function setRailTransient(v: boolean | null) {
  if (transient === v) return;
  transient = v;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

type EscapeHandler = () => boolean | void;

/**
 * How much of the shell a page is asking to have out of its way:
 *  - `header`: the page carries its own header instead of the search bar
 *    (Settings' portal header).
 *  - `full`: the page takes the whole frame — icon rail, browser column and
 *    header all step out (the workflow history surface).
 * `full` wins whenever both are claimed, so the answer never depends on
 * which page mounted first.
 */
export type FullBleed = "header" | "full";

interface ShellCtx {
  railOpen: boolean;
  setRailOpen: (v: boolean) => void;
  toggleRail: () => void;
  /** Register an Esc handler; returns the unregister. Last registered wins. */
  pushEscape: (h: EscapeHandler) => () => void;
  /** Fire the topmost Esc handler; true when one consumed it. */
  fireEscape: () => boolean;
  /** What the mounted pages are asking the shell to drop, or null. */
  fullBleed: FullBleed | null;
  /** Claim (or, with null, release) a full-bleed level under `key`.
   *  Use `useFullBleed` rather than calling this directly. */
  setFullBleed: (key: string, mode: FullBleed | null) => void;
}

const Ctx = createContext<ShellCtx>({
  railOpen: false,
  setRailOpen: () => {},
  toggleRail: () => {},
  pushEscape: () => () => {},
  fireEscape: () => false,
  fullBleed: null,
  setFullBleed: () => {},
});

export function useShell() {
  return useContext(Ctx);
}

/** Register an Esc handler for as long as `active` is true. */
export function useEscape(active: boolean, handler: EscapeHandler) {
  const { pushEscape } = useShell();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!active) return;
    return pushEscape(() => ref.current());
  }, [active, pushEscape]);
}

/** Ask the shell to step out of the way for as long as this component is
 *  mounted with a non-null `mode`. The claim is released on unmount, so a
 *  page never has to undo it — and the shell never has to know the page. */
export function useFullBleed(mode: FullBleed | null) {
  const { setFullBleed } = useShell();
  const key = useId();
  useEffect(() => {
    setFullBleed(key, mode);
    return () => setFullBleed(key, null);
  }, [key, mode, setFullBleed]);
}

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const railOpen = useSyncExternalStore(subscribe, readRail, () => false);
  const stack = useRef<EscapeHandler[]>([]);
  const [claims, setClaims] = useState<Readonly<Record<string, FullBleed>>>({});

  const setRailOpen = useCallback((v: boolean) => writeRail(v), []);
  const toggleRail = useCallback(() => writeRail(!readRail()), []);
  const pushEscape = useCallback((h: EscapeHandler) => {
    stack.current.push(h);
    return () => {
      stack.current = stack.current.filter((x) => x !== h);
    };
  }, []);
  const fireEscape = useCallback(() => {
    const top = stack.current[stack.current.length - 1];
    if (!top) return false;
    return top() !== false;
  }, []);

  const setFullBleed = useCallback((key: string, mode: FullBleed | null) => {
    setClaims((cur) => {
      if (mode === null) {
        if (!(key in cur)) return cur;
        const next = { ...cur };
        delete next[key];
        return next;
      }
      if (cur[key] === mode) return cur;
      return { ...cur, [key]: mode };
    });
  }, []);
  const fullBleed: FullBleed | null = useMemo(() => {
    const claimed = Object.values(claims);
    return claimed.includes("full") ? "full" : claimed.length > 0 ? "header" : null;
  }, [claims]);

  const value = useMemo(
    () => ({ railOpen, setRailOpen, toggleRail, pushEscape, fireEscape, fullBleed, setFullBleed }),
    [railOpen, setRailOpen, toggleRail, pushEscape, fireEscape, fullBleed, setFullBleed]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** True when the event target is a text-entry element (skip shortcuts). */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

/** True when a Radix dialog / menu / popover is currently open. */
export function overlayOpen(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"], [data-radix-popper-content-wrapper]'
  );
}

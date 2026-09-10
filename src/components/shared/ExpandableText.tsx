"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ChevronDown } from "lucide-react";

/*
 * ExpandableText — the one place in the app where text may be clamped.
 *
 * Rule: nothing in the UI shows an ellipsis. Where a single line (or two)
 * is structurally required — a fixed-height bar, a dense list row — the
 * text is clamped with CSS here, overflow is detected with a
 * ResizeObserver, and an overflowing clamp is always expandable inline:
 * either the text itself becomes a <button aria-expanded> (ExpandableText),
 * or, when the text already sits inside a link or button, the row renders
 * an ExpandToggle beside it (useClamp + ExpandToggle) so no interactive
 * element nests inside another.
 *
 * Non-overflowing text renders as plain text with no control.
 */

const WRAP: CSSProperties = { overflowWrap: "anywhere", wordBreak: "break-word" };

function clampStyle(lines: number): CSSProperties {
  return {
    ...WRAP,
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
  };
}

/**
 * Clamp `text` to `lines` and report whether it overflows. `expanded`
 * removes the clamp; while expanded the last measured overflow is kept so
 * the collapse control does not vanish. Pass `attach` as the text element's
 * ref and `style` as its style.
 */
export function useClamp(lines: number, text: string, expanded = false): { attach: (el: HTMLElement | null) => void; overflowing: boolean; style: CSSProperties } {
  const [overflowing, setOverflowing] = useState(false);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const attach = useCallback((node: HTMLElement | null) => setEl(node), []);

  useEffect(() => {
    if (!el || expanded) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, expanded, lines, text]);

  return { attach, overflowing, style: expanded ? WRAP : clampStyle(lines) };
}

/**
 * Clamped text that becomes a button when it overflows; click (or Enter /
 * Space) toggles the full, wrapped text inline. Must not be placed inside a
 * link or button — use useClamp + ExpandToggle there.
 */
export function ExpandableText({
  text,
  lines = 1,
  className = "",
  title,
}: {
  text: string;
  lines?: number;
  className?: string;
  /** Tooltip on the plain (non-overflowing) rendering only. */
  title?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { attach, overflowing, style } = useClamp(lines, text, expanded);
  if (!overflowing && !expanded) {
    return (
      <span ref={attach} className={`block ${className}`} style={style} title={title}>
        {text}
      </span>
    );
  }
  return (
    <button
      ref={attach}
      type="button"
      aria-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
      title={expanded ? "Show less" : "Show the full text"}
      className={`block w-full cursor-pointer border-0 bg-transparent p-0 text-left underline-offset-2 hover:underline focus-visible:underline ${className}`}
      style={style}
    >
      {text}
    </button>
  );
}

/** The beside-the-row expand control for text inside a link or button row. */
export function ExpandToggle({
  expanded,
  onToggle,
  label,
  className = "",
}: {
  expanded: boolean;
  onToggle: () => void;
  /** What is being expanded, e.g. "Show the full workflow name". */
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? "Show less" : label}
      title={expanded ? "Show less" : label}
      onClick={onToggle}
      className={`mt-[3px] inline-flex size-[18px] flex-none cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-t3 transition-colors hover:bg-hover hover:text-t1 ${className}`}
    >
      <ChevronDown aria-hidden="true" className={`size-[11px] transition-transform duration-[var(--dur-fast)] ${expanded ? "rotate-180" : ""}`} />
    </button>
  );
}

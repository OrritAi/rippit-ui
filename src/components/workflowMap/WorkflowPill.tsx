"use client";

import { memo, type CSSProperties, type ReactElement } from "react";
import { AppPuck } from "@/components/shared/AppPuck";
import { pillChip, pillNoun } from "@/lib/workflowMap/model";
import { runAria, type RunState } from "@/lib/workflowMap/run";
import { PILL_NAME_MAX_W } from "@/lib/workflowMap/tokens";
import type { MapNode } from "@/lib/workflowMap/types";
import { ExpandCap } from "./ExpandCap";
import { MapTip } from "./MapTip";
import type { RefCallback } from "./useMapMeasure";
import type { TreeItemProps } from "./useMapKeyboard";

/*
 * Workflow pill — a root caller or an attached workflow preview. Two
 * controls, siblings inside one capsule (no nested interactives):
 *   body    (role=treeitem) → select: sidebar + centre
 *   end cap (button)        → show / hide the flow: "12 steps" ("modules" on
 *                             a Make scenario) and a circle — tinted with a
 *                             chevron while shut, filled and turned once open
 * The links — "Open in Orrit" and the platform ↗ — live in the sidebar the
 * body opens, never on the capsule. Three small targets side by side are
 * three things to tell apart before every click, and what a reader reaches
 * for on a connected workflow is its steps, so that is the one thing the
 * capsule offers, in words.
 * The capsule element carries the measure ref (edges leave from its right
 * edge) and the tint. Connected pills wear the accent — a faint tint at rest
 * (6 % bg / 28 % border), stronger when open (7 % / 35 %) and selected
 * (55 %). The VIEWED workflow's pill (every copy of it) is the map's start
 * state, drawn like an FSM start node: solid `--text` fill, name and chip in
 * `--bg`, and a double ring (`0 0 0 2px --bg, 0 0 0 4px --text`; accent +
 * glow when selected).
 * The wrapper gets 4px of margin so the ring never clips; the capsule is
 * still the measured element, so edges attach exactly as before. It also
 * carries aria-current and an "(viewing)" aria-label suffix.
 * Steps stay on the plain card surface; the mono meta line hangs under it.
 * Run replay: `run` lands as `data-run` on the capsule (the measured element,
 * which also carries `data-pair`) — "reached" for a pill under a step the
 * run went through, "untouched" under a step it never reached — and the
 * aria-label says so. A related workflow's own run (`runMeta`, "ran 2h ago
 * · failed") joins the meta line under the capsule and the aria-label; the
 * line wraps within the pill's width and never truncates.
 */
const baseLabel = (node: MapNode) => (node.isViewed ? `${node.name} (viewing)` : node.name);

export const WorkflowPill = memo(function WorkflowPill({
  node,
  selected,
  itemProps,
  nodeRef,
  onClick,
  onToggle,
  far = false,
  pair = null,
  run = null,
  runMeta = null,
}: {
  node: MapNode;
  selected: boolean;
  itemProps: TreeItemProps;
  nodeRef: RefCallback;
  onClick: (node: MapNode) => void;
  onToggle: (node: MapNode) => void;
  /** Zoomed out: hide the meta line. */
  far?: boolean;
  /** Pairing focus attributes (class + data-pulse + data-pair) or null. */
  pair?: { className: string; "data-pulse": string; "data-pair": "source" | "target" } | null;
  /** State in the replayed run (lib/workflowMap/run.ts), or null. */
  run?: RunState | null;
  /** This workflow's own run related to the replayed one ("ran 2h ago · failed"), or null. */
  runMeta?: string | null;
}) {
  const p = node.pill;
  const ariaLabel = [baseLabel(node), runAria(run), runMeta].filter(Boolean).join(" — ");
  const meta = [node.meta, runMeta].filter(Boolean).join(" · ");
  const tip = (el: ReactElement) => (run === "unknown" ? <MapTip label="Not checked in this run">{el}</MapTip> : el);
  const open = !!p?.open;
  const loading = !!p?.loading;
  const full = pillChip(node);
  const canToggle = !!p && !p.pinned && !p.cycle && !p.unavailable && !p.error;
  const verb = open ? "Hide" : "Show";
  /* The label is a span keyed by the STATE it reports, not its text, so the
     motion layer's crossfade (`.wm-chip-elsewhere`) restarts exactly when the
     open copy moves — `open in Canceled` → `open in Reschedule` — and never
     otherwise: not when a count arrives with its summary, and not on a zoom.
     It stays mounted in far mode (visually hidden, not removed) for the same
     reason — remounting it would restart the fade on every crossing of
     FAR_AT. Only the "open elsewhere" state carries the class, so a reset —
     which a branch fold elsewhere can cause for several pills at once —
     never animates. */
  const chipLabel = (
    <span key={p?.openAt ? `elsewhere:${p.openAt.id}` : "here"} className={p?.openAt ? "wm-chip-elsewhere" : undefined}>
      {full}
    </span>
  );
  const viewed = !!node.isViewed;
  const tinted = open || selected;
  const borderColor = viewed
    ? "var(--text)"
    : selected
      ? "color-mix(in srgb, var(--map-accent) 55%, transparent)"
      : open
        ? "color-mix(in srgb, var(--map-accent) 35%, transparent)"
        : "color-mix(in srgb, var(--map-accent) 28%, transparent)";
  const background = viewed
    ? "var(--text)"
    : tinted
      ? "color-mix(in srgb, var(--map-accent) 7%, var(--pill))"
      : "color-mix(in srgb, var(--map-accent) 6%, var(--pill))";
  /* The start-state rings; selected swaps the outer ring for the accent + glow. */
  const ring = viewed
    ? selected
      ? "0 0 0 2px var(--bg), 0 0 0 4px var(--map-accent), 0 0 16px color-mix(in srgb, var(--map-accent) 45%, transparent)"
      : "0 0 0 2px var(--bg), 0 0 0 4px var(--text)"
    : undefined;
  /* Written out literally (not spread) so jsx-a11y can see the role, focus and key handling. */
  const {
    tabIndex,
    onKeyDown,
    onFocus,
    "aria-level": ariaLevel,
    "aria-selected": ariaSelected,
    "aria-expanded": ariaExpanded,
  } = itemProps;

  return (
    <div className={`flex flex-none flex-col gap-1.5 ${viewed ? "m-1" : ""}`}>
      <div
        ref={nodeRef}
        data-node-id={node.id}
        data-pair={pair?.["data-pair"]}
        data-pulse={pair?.["data-pulse"]}
        data-run={run ?? undefined}
        className={`${pair ? "wm-pair " : ""}pointer-events-auto flex min-h-10 flex-none items-center gap-[9px] rounded-full border border-[var(--pill-border)] bg-pill py-1.5 pl-[9px] pr-1.5 shadow-[var(--shadow-card)] transition-[border-color,background,transform,box-shadow] duration-[220ms] ease-[var(--ease-out)] hover:-translate-y-[2px] ${viewed ? "text-bg" : "text-t1 hover:border-line-strong"}`}
        style={
          {
            "--pill-border": borderColor,
            background,
            boxShadow: ring,
          } as CSSProperties
        }
      >
        {tip(
          <div
            role="treeitem"
            tabIndex={tabIndex}
            aria-level={ariaLevel}
            aria-selected={ariaSelected}
            aria-expanded={ariaExpanded}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            aria-current={viewed ? "true" : undefined}
            title={node.desc}
            aria-label={ariaLabel}
            onClick={() => onClick(node)}
            className="flex min-w-0 cursor-pointer select-none items-center gap-[9px] rounded-full text-left"
          >
            <span className="relative flex flex-none">
              <AppPuck app={node.app} size={24} />
              {node.status && (
                <span
                  aria-hidden="true"
                  className={`absolute -bottom-px -right-px size-1.5 rounded-full border border-pill ${node.status === "ok" ? "bg-ok" : "bg-off"}`}
                  style={
                    node.status === "ok"
                      ? { animation: "blinkdot 1.6s ease-in-out infinite" }
                      : undefined
                  }
                />
              )}
              {node.status && (
                <span className="sr-only">
                  {node.status === "ok" ? "active" : "paused"}
                </span>
              )}
            </span>
            <span
              className={`text-[12.5px] font-semibold leading-[1.25] [overflow-wrap:anywhere] ${viewed ? `text-bg ${node.hit ? "underline decoration-map-accent decoration-2 underline-offset-2" : ""}` : node.hit ? "text-map-accent-text" : "text-t1"}`}
              style={{ maxWidth: PILL_NAME_MAX_W }}
            >
              {node.name}
            </span>
          </div>,
        )}
        {full && !far && (
          /* The seam between the capsule's two targets: left of it selects,
             right of it opens. */
          <span
            aria-hidden="true"
            className="h-5 w-px flex-none"
            style={{
              background: viewed
                ? "color-mix(in srgb, var(--bg) 30%, transparent)"
                : "color-mix(in srgb, var(--map-accent) 24%, transparent)",
            }}
          />
        )}
        {full &&
          (canToggle ? (
            /* The end cap mirrors the app puck at the other end, and the edge
               to the first step leaves the capsule right beside it, so an open
               pill reads as the circle its line comes out of. */
            <ExpandCap
              pillToggle
              open={open}
              loading={loading}
              label={chipLabel}
              hideLabel={far}
              ariaExpanded={open}
              ariaLabel={
                p?.openAt
                  ? `Open ${node.name} here — it is currently open in ${p.openAt.where}`
                  : `${verb} the ${pillNoun(node)} of ${node.name}`
              }
              tip={p?.openAt ? `Open here — it is open in ${p.openAt.where}` : `${verb} ${pillNoun(node)}`}
              onToggle={() => onToggle(node)}
            />
          ) : (
            <span className={`flex-none whitespace-nowrap text-[11px] font-medium leading-none ${viewed ? "text-bg" : "text-t2"}`}>
              {far ? (p?.cycle ? "↺" : "!") : full}
            </span>
          ))}
      </div>
      {meta && !far && (
        <div
          className="pl-3 font-mono text-[10px] text-t3 [overflow-wrap:anywhere]"
          style={{ maxWidth: PILL_NAME_MAX_W + 60 }}
        >
          {meta}
        </div>
      )}
    </div>
  );
});

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import type { RunRow, RunStatus } from "@/app/lib/api";
import { useEscape } from "@/components/shell/shell-context";
import { RUN_TONE } from "@/components/shared/RunsPanel";
import { formatDuration, runStepsRatio } from "@/lib/triage";
import { CHIP_STATUSES, type RunHistory } from "./useRunHistory";

/*
 * Level 2's only run chrome: the run *is* the page title, and the title is a
 * dropdown.
 *
 * Three alternatives were built and rejected, and each failure produced a
 * constraint this satisfies: a permanent bottom split with the table (halved
 * the canvas — "super hard to see"), a horizontal filmstrip of run cards
 * (took a band off the top and still showed only a handful), and a 40px rail
 * of red/green status ticks down the canvas edge (visually noisy next to the
 * map). All three tried to keep the list visible. The answer is not to: put
 * the run in the title position, where a page name would be, and let the list
 * come to the front only when asked.
 *
 * The cost model that makes it work: **one click to switch run** (title → a
 * row), **zero clicks** for the neighbouring run (`←`/`→`, which is the
 * common "was the one before this fine?" move and never opens the dropdown at
 * all), and two clicks as the worst case between any two runs.
 *
 * Anchoring note: the spec gives fixed coordinates (`left: 158px; top: 66px`)
 * and records the prototype measuring `left 172 / top 78`. They differ because
 * the trigger moves — the back button is "All runs" here and "Back" at level
 * 1, which are different widths. So this anchors to the trigger element
 * instead of a literal offset; the design's intent is "under the title", and a
 * hard-coded left would drift the first time a label changed.
 */

const ROW_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "34px 78px 84px 68px 58px minmax(0,1.5fr) 92px",
  alignItems: "center",
  gap: "0 12px",
};

/** Rendered rows are capped: a workflow can hold 500 runs and the dropdown is
 *  a picker, not the list. Level 1 is the list. */
const MAX_ROWS = 60;

const CHIP = "cursor-pointer rounded-full border px-2.5 py-[3px] text-[11px] font-semibold transition-colors duration-[var(--dur-fast)]";
const CHIP_ON = "border-t1 bg-t1 text-bg";
const CHIP_OFF = "border-line text-t2 hover:border-line-strong hover:text-t1";

export function RunSwitcher({
  history,
  current,
  onPick,
  onWalk,
  now,
}: {
  history: RunHistory;
  /** The run on the canvas. */
  current: RunRow | null;
  onPick: (executionId: string) => void;
  onWalk?: (executionId: string) => void;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<RunStatus | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const { rows, counts } = history;
  const index = current ? rows.findIndex((r) => r.executionId === current.executionId) : -1;

  const matches = useMemo(() => {
    const byStatus = status ? rows.filter((r) => r.status === status) : rows;
    const needle = query.trim().toLowerCase();
    if (!needle) return byStatus;
    // Status word, error text, run id, and the row number — the four things
    // someone actually remembers about a run they are looking for.
    return byStatus.filter((r, i) => {
      const n = rows.indexOf(r) + 1;
      return (
        r.status.includes(needle) ||
        (RUN_TONE[r.status]?.label ?? "").toLowerCase().includes(needle) ||
        `${r.errorName ?? ""} ${r.errorMessage ?? ""}`.toLowerCase().includes(needle) ||
        r.executionId.toLowerCase().includes(needle) ||
        String(n) === needle ||
        String(i + 1) === needle
      );
    });
  }, [rows, status, query]);

  const step = useCallback(
    (delta: number) => {
      if (index < 0) return;
      const next = rows[index + delta];
      if (next) onPick(next.executionId);
    },
    [index, rows, onPick],
  );

  /* `R` toggles, arrows step to the neighbouring run without opening
     anything, Esc closes. Ignored while a field has focus so typing in the
     search box does not walk the runs out from under it. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // Above the node panel, below the palette — the shell's own LIFO stack.
  useEscape(open, () => setOpen(false));

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const tone = current ? (RUN_TONE[current.status] ?? RUN_TONE.unknown) : null;
  const steps = current ? runStepsRatio(current) : null;

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Switch run"
        className={`flex h-[38px] min-w-0 max-w-[560px] items-center gap-2 rounded-control border px-[11px] transition-colors duration-[var(--dur-fast)] ${
          open ? "border-line-strong bg-hover" : "border-transparent hover:bg-hover"
        }`}
      >
        {tone && (
          <span
            aria-hidden
            className="size-[7px] flex-none rounded-full"
            style={{ background: tone.accent, boxShadow: `0 0 8px ${tone.accent}` }}
          />
        )}
        <span className="min-w-0 truncate text-[15px] font-extrabold tracking-[-0.02em]">
          {current ? `${tone?.label ?? current.status} · ${relative(current.startedAt, now)}${steps ? ` · ${steps}` : ""}` : "Run"}
        </span>
        {current && <span className="flex-none font-mono text-[10.5px] text-t3">{shortId(current.executionId)}</span>}
        <ChevronDown aria-hidden className="size-3.5 flex-none text-t3" />
      </button>

      {open && (
        <>
          {/* Outside click closes. A transparent full-screen button rather
              than a document listener, so focus order stays sane. */}
          <button
            type="button"
            aria-label="Close the run switcher"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[40] cursor-default"
          />
          <div
            role="dialog"
            aria-label="Runs"
            className="anim-pop-in absolute left-0 top-[52px] z-[41] w-[700px] max-w-[calc(100vw-180px)] overflow-hidden rounded-card border border-line-strong bg-pill shadow-[var(--shadow-float)]"
          >
            <div className="flex h-[46px] items-center gap-2.5 border-b border-line2 px-4">
              <Search aria-hidden className="size-3.5 flex-none text-t3" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // The footer promises `↵ to load`. With arrows reserved for
                  // stepping runs, the highlighted row is the top match — so
                  // typing "error" and pressing return opens the newest
                  // failure without touching the mouse.
                  if (e.key === "Enter" && matches[0]) {
                    e.preventDefault();
                    setOpen(false);
                    onPick(matches[0].executionId);
                  }
                }}
                placeholder="Find a run — status, error, id, or #"
                aria-label="Find a run"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-t1 outline-none placeholder:text-t3"
              />
              <span className="tabular flex-none font-mono text-[10px] text-t3">
                {query.trim() || status ? `${matches.length} matches` : `${rows.length} runs`}
              </span>
              <kbd className="flex-none rounded-control border border-line px-1.5 py-[1px] font-mono text-[9.5px] text-t3">esc</kbd>
            </div>

            <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5 border-b border-line2 px-4 py-2.5">
              <button type="button" onClick={() => setStatus(null)} aria-pressed={status === null} className={`${CHIP} ${status === null ? CHIP_ON : CHIP_OFF}`}>
                all <span className="tabular font-mono opacity-70">{rows.length}</span>
              </button>
              {CHIP_STATUSES.map((s) => (
                <button key={s} type="button" onClick={() => setStatus(status === s ? null : s)} aria-pressed={status === s} className={`${CHIP} ${status === s ? CHIP_ON : CHIP_OFF}`}>
                  {RUN_TONE[s].label} <span className="tabular font-mono opacity-70">{counts[s] ?? 0}</span>
                </button>
              ))}
            </div>

            <div className="thin-scroll max-h-[52vh] overflow-auto">
              {matches.length === 0 ? (
                <p className="m-0 px-4 py-7 text-center text-[12.5px] italic text-t3">No run matches that.</p>
              ) : (
                matches.slice(0, MAX_ROWS).map((r) => (
                  <SwitchRow
                    key={r.executionId}
                    run={r}
                    num={rows.indexOf(r) + 1}
                    active={r.executionId === current?.executionId}
                    now={now}
                    onPick={(id) => {
                      setOpen(false);
                      onPick(id);
                    }}
                    onWalk={onWalk}
                  />
                ))
              )}
            </div>

            <p className="m-0 border-t border-line2 px-4 py-2 font-mono text-[9.5px] text-t3">
              R to open · ↵ to load · ← → for neighbours · esc
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function SwitchRow({
  run: r,
  num,
  active,
  now,
  onPick,
  onWalk,
}: {
  run: RunRow;
  num: number;
  active: boolean;
  now: number;
  onPick: (id: string) => void;
  onWalk?: (id: string) => void;
}) {
  const tone = RUN_TONE[r.status] ?? RUN_TONE.unknown;
  const err = [r.errorName, r.errorMessage].filter(Boolean).join(" · ");
  return (
    <div
      style={{ ...ROW_GRID, borderLeftColor: active ? "var(--map-accent)" : "transparent" }}
      className={`relative border-b border-l-2 border-line2 px-3.5 py-[7px] text-[11.5px] ${active ? "bg-hover" : "hover:bg-hover"}`}
    >
      <button type="button" onClick={() => onPick(r.executionId)} className="absolute inset-0 cursor-pointer" aria-label={`Open run ${num}`} />
      <span className="tabular pointer-events-none font-mono text-[10px] text-t3">{num}</span>
      <span className="pointer-events-none font-mono text-[10px] text-t3">{relative(r.startedAt, now)}</span>
      <span className="pointer-events-none flex items-center gap-1.5" style={{ color: tone.text }}>
        <span aria-hidden className="size-1.5 flex-none rounded-full" style={{ background: tone.accent }} />
        {tone.label}
      </span>
      <span className="tabular pointer-events-none font-mono text-[10px] text-t3">{formatDuration(r.durationMs)}</span>
      <span className="tabular pointer-events-none font-mono text-[10px] text-t3">{runStepsRatio(r) ?? "—"}</span>
      <span className="pointer-events-none min-w-0 truncate text-t3" title={err || undefined}>
        {err || "—"}
      </span>
      <span className="pointer-events-none flex items-center justify-end gap-2">
        <span className="truncate font-mono text-[9.5px] text-t3">{shortId(r.executionId)}</span>
        {onWalk && (
          <button
            type="button"
            onClick={() => onWalk(r.executionId)}
            className="pointer-events-auto flex-none cursor-pointer rounded-full border border-line px-2 py-[2px] text-[10px] font-semibold text-t2 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1"
          >
            Walk
          </button>
        )}
      </span>
    </div>
  );
}

/** Make's imtId is `{ms}_{32 hex}`; only the tail is worth showing. */
function shortId(id: string): string {
  const tail = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
  return `e-${tail.slice(-5)}`;
}

function relative(iso: string | null, now: number): string {
  if (!iso) return "";
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

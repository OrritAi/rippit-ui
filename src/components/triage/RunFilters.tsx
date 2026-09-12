"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { RecordKind, RunStatus, RunWindow, WorkflowCard } from "@/app/lib/api";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CONNECTORS } from "@/lib/connectors";
import { RECORD_KIND_WORD, RUN_STATUSES, RUN_WINDOWS } from "@/lib/triage";

/*
 * One row of small controls over the run table: status · workflow · window ·
 * record search. No labels above the controls — the chips and the
 * placeholder say what they are.
 */

const CHIP = "cursor-pointer rounded-full border px-2.5 py-[3px] text-[11px] font-semibold transition-colors duration-[var(--dur-fast)]";
const CHIP_ON = "border-t1 bg-t1 text-bg";
const CHIP_OFF = "border-line text-t2 hover:border-line-strong hover:text-t1";

function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: string; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-label={label} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}>
      {children}
    </button>
  );
}

/** `make:1234` — the picker's value, split back into the two query params. */
export function workflowKey(w: { source: string; refId: string }): string {
  return `${w.source}:${w.refId}`;
}

function WorkflowPicker({ workflows, value, onChange }: { workflows: WorkflowCard[]; value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Opening focuses the filter box; closing clears it in the handler below,
  // so no state is set from inside the effect.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const selected = workflows.find((w) => workflowKey(w) === value) ?? null;
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? workflows.filter((w) => (w.name ?? "").toLowerCase().includes(f) || w.refId.toLowerCase().includes(f)) : workflows;
    return list.slice(0, 200);
  }, [workflows, filter]);

  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFilter(""); }}>
      <DropdownMenuTrigger
        aria-label={selected ? `Workflow: ${selected.name}` : "Workflow: all"}
        className={`inline-flex max-w-[220px] cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold transition-colors duration-[var(--dur-fast)] ${selected ? CHIP_ON : CHIP_OFF}`}
      >
        <span className="truncate">{selected ? selected.name : "All workflows"}</span>
        <ChevronDown aria-hidden="true" className="size-3 flex-none opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[320px] w-[260px] overflow-y-auto border-line bg-panel p-1">
        <div className="sticky top-0 z-10 bg-panel pb-1">
          <label className="flex h-[26px] items-center gap-[7px] rounded-control border border-line bg-hover px-[9px] focus-within:border-line-strong">
            <Search aria-hidden="true" className="size-[11px] flex-none text-t3" />
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Filter workflows"
              aria-label="Filter workflows"
              className="w-full min-w-0 border-0 bg-transparent text-[12px] text-t1 outline-none placeholder:text-t3"
            />
          </label>
        </div>
        <button type="button" onClick={() => pick(null)} className="flex w-full cursor-pointer items-center gap-2 rounded-[5px] px-2 py-[5px] text-left text-[12px] text-t1 hover:bg-hover">
          <Check aria-hidden="true" className={`size-3 flex-none ${value ? "opacity-0" : "opacity-100"}`} />
          All workflows
        </button>
        {shown.map((w) => {
          const k = workflowKey(w);
          return (
            <button key={k} type="button" onClick={() => pick(k)} className="flex w-full cursor-pointer items-center gap-2 rounded-[5px] px-2 py-[5px] text-left text-[12px] text-t1 hover:bg-hover">
              <Check aria-hidden="true" className={`size-3 flex-none ${value === k ? "opacity-100" : "opacity-0"}`} />
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <span className="flex-none text-[9.5px] text-t3">{CONNECTORS[w.source]?.shortLabel ?? w.source}</span>
            </button>
          );
        })}
        {shown.length === 0 && <p className="m-0 px-2 py-3 text-center text-[11.5px] italic text-t3">No match</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RunFilters({
  status,
  onStatus,
  workflow,
  onWorkflow,
  workflows,
  window: win,
  onWindow,
  q,
  onQuery,
  recordKind,
}: {
  status: RunStatus | null;
  onStatus: (s: RunStatus | null) => void;
  /** Omitted on one workflow's own log — there is nothing to pick between. */
  workflow?: string | null;
  onWorkflow?: (w: string | null) => void;
  workflows?: WorkflowCard[];
  window: RunWindow;
  onWindow: (w: RunWindow) => void;
  /** Omitted where a record search makes no sense (one workflow's log). */
  q?: string;
  onQuery?: (q: string) => void;
  recordKind?: RecordKind | null;
}) {
  const [draft, setDraft] = useState(q ?? "");
  // A new `?q=` (the action hub deep-links here) resets the box — state from props, no effect.
  const [draftFor, setDraftFor] = useState(q ?? "");
  if (draftFor !== (q ?? "")) {
    setDraftFor(q ?? "");
    setDraft(q ?? "");
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onQuery?.(draft.trim());
  };

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="group" aria-label="Status" className="flex flex-wrap items-center gap-1.5">
        <Chip on={status === null} onClick={() => onStatus(null)}>
          All
        </Chip>
        {RUN_STATUSES.map((s) => (
          <Chip key={s.value} on={status === s.value} onClick={() => onStatus(status === s.value ? null : s.value)}>
            {s.label}
          </Chip>
        ))}
      </div>

      {onWorkflow && <WorkflowPicker workflows={workflows ?? []} value={workflow ?? null} onChange={onWorkflow} />}

      <div role="group" aria-label="Time window" className="flex items-center gap-1.5">
        {RUN_WINDOWS.map((w) => (
          <Chip key={w} on={win === w} onClick={() => onWindow(w)} label={`Window ${w}`}>
            {w}
          </Chip>
        ))}
      </div>

      {onQuery && (
      <form onSubmit={submit} className="flex min-w-[200px] flex-1 items-center gap-2">
        <label className="flex h-[26px] min-w-0 flex-1 items-center gap-[7px] rounded-control border border-line bg-hover px-[9px] transition-[border-color] duration-[var(--dur-fast)] focus-within:border-line-strong">
          <Search aria-hidden="true" className="size-[11px] flex-none text-t3" />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="email, phone or record id"
            aria-label="Find runs by record — email, phone or record id"
            className="w-full min-w-0 border-0 bg-transparent text-[12px] text-t1 outline-none placeholder:text-t3"
          />
        </label>
        {recordKind && (
          <span className="inline-flex flex-none items-center rounded-full border border-line px-2 py-[2px] font-mono text-[10px] text-t3">record · {RECORD_KIND_WORD[recordKind] ?? recordKind}</span>
        )}
      </form>
      )}
    </div>
  );
}

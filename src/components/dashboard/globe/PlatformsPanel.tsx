"use client";

import { INTRO } from "./intro";
import type { GlobePlatform } from "./model";
import { platformColor, type CanvasPalette, type MarkerShape } from "./palette";

const ENTRANCE = `riseIn 450ms var(--ease-out) ${INTRO.panelDelayMs}ms both`;

function Marker({ shape, color }: { shape: MarkerShape; color: string }) {
  const base = "size-2 flex-none";
  if (shape === "diamond") return <span aria-hidden="true" className={`${base} rotate-45`} style={{ background: color }} />;
  if (shape === "triangle")
    return <span aria-hidden="true" className={base} style={{ background: color, clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }} />;
  if (shape === "square") return <span aria-hidden="true" className={base} style={{ background: color }} />;
  return <span aria-hidden="true" className={`${base} rounded-full`} style={{ background: color }} />;
}

function Row({
  active,
  onClick,
  marker,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  marker: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center gap-[9px] rounded-row px-[9px] py-[7px] text-[12px] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover ${
        active ? "bg-hover font-semibold text-t1" : "font-medium text-t2"
      }`}
    >
      {marker}
      <span className="flex-1 truncate text-left">{label}</span>
      <span className="tabular font-mono text-[10.5px] text-t3">{count}</span>
    </button>
  );
}

export function PlatformsPanel({
  platforms,
  total,
  connected,
  filter,
  onFilter,
  open,
  onToggle,
  palette,
  animate,
}: {
  platforms: GlobePlatform[];
  total: number;
  connected: number;
  filter: string | null;
  onFilter: (id: string | null) => void;
  open: boolean;
  onToggle: () => void;
  palette: CanvasPalette;
  /** Play the delayed entrance (first load only). */
  animate: boolean;
}) {
  return (
    <div
      className="absolute left-4 top-4 z-[5] flex max-h-[calc(100%-60px)] w-[224px] flex-col rounded-card border border-line bg-pill shadow-[var(--shadow-card)]"
      style={animate ? { animation: ENTRANCE } : undefined}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex cursor-pointer items-center gap-2 rounded-t-card px-[13px] py-[11px] text-left text-t1 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover"
      >
        <span className="flex-1 text-[12px] font-semibold">Platforms</span>
        <span className="tabular font-mono text-[10.5px] text-t3">{connected} connected</span>
        <span aria-hidden="true" className="font-mono text-[10.5px] text-t3">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className="thin-scroll min-h-0 overflow-auto border-t border-line2 px-[5px] pb-[7px] pt-[5px]">
          <Row
            active={filter === null}
            onClick={() => onFilter(null)}
            marker={<span aria-hidden="true" className="size-2 flex-none rounded-full border border-line-strong" />}
            label="All platforms"
            count={total}
          />
          {platforms.map((p) => (
            <Row
              key={p.id}
              active={filter === p.id}
              onClick={() => onFilter(filter === p.id ? null : p.id)}
              marker={<Marker shape={p.shape} color={platformColor(palette, p.id)} />}
              label={p.label}
              count={p.count}
            />
          ))}
        </div>
      )}
    </div>
  );
}

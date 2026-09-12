"use client";

import { X } from "lucide-react";

import type { ExecutionBundles } from "@/app/lib/api";
import { formatValue, flattenPaths } from "@/components/projection/Provenance";
import type { Stage } from "./Cube";

/*
 * RECEIVED / RETURNED — the only place bundle data appears in the walk.
 *
 * It opens on a click, beneath the cube, and closes on the next step. Putting
 * this on the cube itself, or leaving it always open, turns the world back
 * into the dashboard the walk exists to not be.
 *
 * Opaque `--pill`, never a translucent panel: `backdrop-filter` over
 * 3D-transformed content is a documented Chrome compositing bug, and this
 * whole surface is `preserve-3d`.
 */

export function StagePanel({
  stage,
  bundles,
  loading,
  onClose,
}: {
  stage: Stage;
  bundles: ExecutionBundles | null;
  loading: boolean;
  onClose: () => void;
}) {
  const frame = bundles?.frames?.[stage.nodeId];
  const op = frame?.operations?.[0];

  return (
    <aside
      aria-label={`Step data for ${stage.name}`}
      className="absolute left-1/2 top-[58%] z-10 w-[400px] -translate-x-1/2 overflow-hidden rounded-card border border-line-strong bg-pill shadow-[var(--shadow-float)]"
    >
      <header className="flex items-center gap-2 border-b border-line2 px-4 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-t1">{stage.name}</span>
        <span className="flex-none font-mono text-[9.5px] tracking-[.12em] text-t3">{stage.ordinal}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close step data"
          className="flex-none text-t3 transition-colors duration-[var(--dur-fast)] hover:text-t1"
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div className="max-h-[38vh] overflow-y-auto">
        {loading ? (
          <p className="m-0 px-4 py-3 text-[11.5px] text-t3">Reading this run…</p>
        ) : !op ? (
          <p className="m-0 px-4 py-3 text-[11.5px] leading-[1.5] text-t3">
            {bundles?.reason ?? "This step recorded nothing in this run."}
          </p>
        ) : (
          <>
            <Side label="RECEIVED" value={op.input} />
            <Side label="RETURNED" value={op.output} />
            {frame && frame.operations.length > 1 && (
              <p className="m-0 border-t border-line2 px-4 py-2 font-mono text-[9.5px] text-t3">
                first of {frame.operations.length} operations · open this step on the map for the rest
              </p>
            )}
          </>
        )}
      </div>

      <p className="m-0 border-t border-line2 px-4 py-2 font-mono text-[9.5px] text-t3">never stored</p>
    </aside>
  );
}

function Side({ label, value }: { label: string; value: unknown }) {
  const rows = value == null ? [] : flattenPaths(value).slice(0, 12);
  const total = value == null ? 0 : flattenPaths(value).length;
  return (
    <section className="border-b border-line2 px-4 py-2.5 last:border-b-0">
      <h3 className="m-0 mb-1.5 font-mono text-[9px] font-semibold tracking-[.14em] text-t3">{label}</h3>
      {rows.length === 0 ? (
        <p className="m-0 font-mono text-[11px] italic text-t3">—</p>
      ) : (
        <>
          {rows.map((r) => (
            <div key={r.path} className="flex gap-2 py-[3px]">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-t3" title={r.path}>
                {r.path}
              </span>
              <span className="min-w-0 max-w-[55%] truncate font-mono text-[10.5px] text-t2">
                {formatValue(r.value)}
              </span>
            </div>
          ))}
          {total > rows.length && (
            <p className="m-0 mt-1 font-mono text-[9.5px] text-t3">+{total - rows.length} more</p>
          )}
        </>
      )}
    </section>
  );
}

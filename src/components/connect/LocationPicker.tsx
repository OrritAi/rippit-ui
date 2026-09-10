"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ContainerRow } from "@/app/lib/api";

/**
 * Choose which sub-accounts to connect.
 *
 * Built for a hundred rows, not a dozen: search, select-all, a live count, and
 * already-connected rows shown but locked so "select all" never re-adds them.
 */
export default function LocationPicker({
  containers,
  noun,
  busy,
  max,
  onConnect,
}: {
  containers: ContainerRow[];
  noun: string;
  busy?: boolean;
  /** Server-side cap per request, surfaced rather than discovered by error. */
  max: number;
  onConnect: (chosen: ContainerRow[]) => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const available = useMemo(
    () => containers.filter((c) => !c.connected),
    [containers]
  );
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return containers;
    return containers.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(needle) ||
        c.externalId.toLowerCase().includes(needle)
    );
  }, [containers, q]);

  const selectableVisible = visible.filter((c) => !c.connected);
  const allVisiblePicked =
    selectableVisible.length > 0 &&
    selectableVisible.every((c) => picked.has(c.externalId));
  const overCap = picked.size > max;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const c of selectableVisible) {
        if (allVisiblePicked) next.delete(c.externalId);
        else next.add(c.externalId);
      }
      return next;
    });
  }

  const plural = `${noun}s`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-t3"
          />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${plural}…`}
            aria-label={`Search ${plural}`}
            className="h-9 rounded-control border-line-strong bg-hover pl-8 text-[13.5px]"
          />
        </div>
        {selectableVisible.length > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={toggleAllVisible}
            className="h-9 cursor-pointer rounded-control text-[13px]"
          >
            {allVisiblePicked ? "Clear" : `Select all${q ? " shown" : ""}`}
          </Button>
        )}
      </div>

      <p role="status" className="text-[12.5px] text-t3">
        {picked.size} of {available.length} {plural} selected
        {q && ` · ${visible.length} shown`}
      </p>

      <ul className="max-h-80 overflow-y-auto thin-scroll overflow-hidden rounded-card border border-line bg-panel">
        {visible.length === 0 && (
          <li className="px-3.5 py-6 text-center text-[13px] italic text-t3">
            No {plural} match “{q}”.
          </li>
        )}
        {visible.map((c) => {
          const checked = picked.has(c.externalId);
          return (
            <li key={c.externalId} className="border-b border-line2 last:border-b-0">
              <label
                className={`flex cursor-pointer items-center gap-3 px-3.5 py-2.5 text-[13.5px] ${
                  c.connected ? "cursor-default opacity-60" : "hover:bg-hover"
                }`}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--text)]"
                  disabled={c.connected || busy}
                  checked={c.connected || checked}
                  onChange={() => toggle(c.externalId)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block [overflow-wrap:anywhere]">
                    {c.name || <span className="tabular text-t2">{c.externalId}</span>}
                  </span>
                  {c.name && (
                    <span className="block [overflow-wrap:anywhere] text-[11.5px] tabular text-t3">
                      {c.externalId}
                    </span>
                  )}
                </span>
                {c.connected && (
                  <span className="flex shrink-0 items-center gap-1 text-[12px] text-ok-text">
                    <Check aria-hidden="true" className="size-3.5" />
                    Connected
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      {overCap && (
        <p role="alert" className="text-[12.5px] text-warn-text">
          {max} {plural} at a time — deselect {picked.size - max} and you can add
          the rest straight after.
        </p>
      )}

      <Button
        type="button"
        disabled={busy || picked.size === 0 || overCap}
        onClick={() =>
          onConnect(containers.filter((c) => picked.has(c.externalId)))
        }
        className="h-auto w-full cursor-pointer rounded-control py-2.5 text-[13.5px] font-semibold hover:opacity-85 disabled:opacity-50"
      >
        {busy
          ? "Connecting…"
          : picked.size === 0
            ? `Select ${plural} to connect`
            : `Connect ${picked.size} ${picked.size === 1 ? noun : plural}`}
      </Button>
    </div>
  );
}

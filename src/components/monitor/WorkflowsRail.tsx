"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ST, WFS, type FeedEntry } from "./data";

export type FeedItem = FeedEntry & { id: number };

const EASE = [0.22, 1, 0.36, 1] as const;

export function WorkflowsRail({
  active,
  incident,
  feed,
  sparkActive,
  sparkIdle,
  onSelect,
}: {
  active: number;
  incident: boolean;
  feed: FeedItem[];
  sparkActive: string;
  sparkIdle: string;
  onSelect: (i: number) => void;
}) {
  return (
    <motion.aside
      aria-label="Workflows and live activity"
      initial={{ opacity: 0, x: -26 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.55, ease: EASE, delay: 0.05 }}
      className="absolute bottom-3 left-3 top-3 z-[3] flex w-[252px] flex-col overflow-hidden rounded-card border border-line bg-panel shadow-[0_12px_34px_var(--shade)] backdrop-blur-[14px]"
    >
      <h2 className="px-4 pb-2 pt-3.5 text-[11.5px] font-semibold text-t3">
        Workflows
      </h2>
      <div className="flex flex-col gap-1 px-2">
        {WFS.map((w, i) => {
          const st = i === 0 && incident ? "err" : w.st;
          const isActive = active === i;
          return (
            <button
              key={w.name}
              onClick={() => onSelect(i)}
              aria-pressed={isActive}
              className="flex cursor-pointer flex-col gap-[7px] rounded-row border px-[11px] py-2.5 text-left transition-colors hover:bg-hover"
              style={{
                background: isActive ? "var(--hover)" : "transparent",
                borderColor: isActive ? "var(--line)" : "transparent",
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-[7px] flex-none rounded-full"
                  style={{
                    background: ST[st].dot,
                    boxShadow: `0 0 7px ${ST[st].dot}`,
                  }}
                />
                <span className="sr-only">{ST[st].label} —</span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-[13px] font-semibold">
                  {w.name}
                </span>
                <span className="font-mono text-[10.5px] text-t3">{w.ops}</span>
              </div>
              <div className="flex items-end justify-between gap-2">
                <span className="text-[11px] text-t3">{w.plats}</span>
                <span
                  aria-hidden="true"
                  className="flex h-3.5 items-end gap-[2px]"
                >
                  {w.spark.map((h, j) => (
                    <span
                      key={j}
                      className="w-[3px] rounded-[1px]"
                      style={{
                        height: h,
                        background: isActive ? sparkActive : sparkIdle,
                      }}
                    />
                  ))}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* live activity — pinned to bottom */}
      <div className="mt-auto flex flex-col overflow-hidden border-t border-line2">
        <h2 className="px-4 pb-1.5 pt-3 text-[11.5px] font-semibold text-t3">
          Live activity
        </h2>
        <div aria-live="off" className="flex flex-col px-2 pb-2.5">
          <AnimatePresence initial={false}>
            {feed.map((f) => (
              <motion.div
                key={f.id}
                layout
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="flex items-center gap-2 rounded-[6px] px-2 py-[5px] transition-colors hover:bg-hover"
              >
                <span
                  aria-hidden="true"
                  className="size-[5px] flex-none rounded-full"
                  style={{ background: f.c, boxShadow: `0 0 6px ${f.c}` }}
                />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-[12px] text-t2">{f.t}</span>
                <span className="flex-none font-mono text-[10px] text-t3">
                  {f.d}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </motion.aside>
  );
}

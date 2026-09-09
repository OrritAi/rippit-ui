"use client";

import { AnimatePresence, motion } from "framer-motion";
import { INTRO } from "./intro";
import { LogoMark } from "./LogoMark";

const rise = (delayMs: number) => ({ animation: `riseIn 450ms var(--ease-out) ${delayMs}ms both` });

/** The first-load cover: solid page background with the mark, wordmark and a
 *  live status line, fading out once the globe underneath has started. */
export function BootOverlay({ show, workflows }: { show: boolean; workflows: number }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="boot"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-bg"
          exit={{ opacity: 0 }}
          transition={{ duration: INTRO.overlayFadeDurMs / 1000, ease: "easeOut" }}
        >
          <div className="flex flex-col items-center gap-[14px]">
            <LogoMark size={26} style={rise(0)} />
            <div className="text-[20px] font-extrabold tracking-[-0.02em] text-t1" style={rise(120)}>
              rippit
            </div>
            <div className="flex items-center gap-[7px] font-mono text-[11.5px] text-t3" style={rise(240)}>
              <span
                className="size-1.5 rounded-full bg-ok"
                style={{ boxShadow: "0 0 8px var(--ok)", animation: "blinkdot 1.4s ease-in-out infinite" }}
              />
              {workflows > 0 ? `connecting platforms · indexing ${workflows} workflows` : "connecting platforms…"}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

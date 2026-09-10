"use client";

import { useEffect, useState } from "react";

/**
 * A clock that ticks every `intervalMs` (default 30 s) so relative labels
 * ("synced 2 min ago") keep moving without the page re-rendering for any
 * other reason. Pauses while the tab is hidden; re-syncs on return.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: number | undefined;
    const tick = () => setNow(Date.now());
    const start = () => {
      tick();
      timer = window.setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
  return now;
}

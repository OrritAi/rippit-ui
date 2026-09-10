"use client";

import { useEffect, useState } from "react";

/**
 * Whether the document is currently visible. Ambient animation (edge drift,
 * pulses, live-run SMIL) pauses while the tab is hidden so a background tab
 * costs nothing. Starts `true` so SSR and the first client paint agree.
 */
export function useTabVisible(): boolean {
  const [v, setV] = useState(true);
  useEffect(() => {
    const on = () => setV(document.visibilityState === "visible");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return v;
}

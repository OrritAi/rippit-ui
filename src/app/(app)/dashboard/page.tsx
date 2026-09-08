"use client";

import { useEffect } from "react";
import { SystemGlobe } from "@/components/dashboard/SystemGlobe";

/*
 * Home = the system map, and nothing else. A full-bleed 3D graph of the whole
 * estate. No numbers, no charts — browse/search/health live elsewhere.
 */
export default function DashboardPage() {
  useEffect(() => {
    document.title = "Rippit";
  }, []);
  return (
    <div className="h-full w-full overflow-hidden" style={{ background: "var(--bg)" }}>
      <SystemGlobe />
    </div>
  );
}

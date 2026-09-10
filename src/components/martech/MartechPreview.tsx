"use client";

import { useEffect, useMemo } from "react";
import { bigCreatorProtocolGraph, creatorProtocolGraph } from "@/lib/martech/fixtures/creatorProtocol";
import { MartechView } from "./MartechView";

/** Client half of /martech/preview — renders the fixture through the real view. */
export function MartechPreview({ big }: { big: boolean }) {
  const graph = useMemo(() => (big ? bigCreatorProtocolGraph() : creatorProtocolGraph), [big]);
  useEffect(() => {
    document.title = `${graph.funnel.name} — Martech preview`;
  }, [graph]);
  return <MartechView graph={graph} />;
}

"use client";

import { ArrowUpRight } from "lucide-react";
import type { MapNode } from "@/lib/workflowMap/types";
import { MapTip } from "./MapTip";
import { nodeLink } from "./nodeLink";

/*
 * The ↗ control a step card carries: a 24px icon button that opens the
 * node's workflow on its platform in a new tab. It stops click and
 * pointerdown so it neither selects the node nor starts a pan. With no
 * derivable URL it renders as an aria-disabled button (still focusable, so
 * its tooltip explains why) — the affordance stays in the same place on
 * every card. Every state has a Radix tooltip (MapTip), no native title.
 * Workflow pills do not carry it: their links live in the sidebar, next to
 * "Open in Orrit" — see WorkflowPill.
 */
const BASE =
  "inline-flex size-6 flex-none items-center justify-center rounded-control border border-line bg-pill text-t3 transition-colors duration-[var(--dur-fast)]";

export function NodeLinkButton({ node, className = "" }: { node: MapNode; className?: string }) {
  const { href, label, title } = nodeLink(node);
  if (!href) {
    return (
      <MapTip label={title}>
        <button
          type="button"
          aria-disabled="true"
          aria-label={`${label} — no editor link for this platform yet`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`${BASE} cursor-default opacity-50 ${className}`}
        >
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </button>
      </MapTip>
    );
  }
  return (
    <MapTip label={title}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className={`${BASE} cursor-pointer hover:border-line-strong hover:text-t1 ${className}`}
      >
        <ArrowUpRight aria-hidden="true" className="size-3.5" />
      </a>
    </MapTip>
  );
}

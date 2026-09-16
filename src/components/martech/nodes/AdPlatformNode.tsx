"use client";

import { Megaphone } from "lucide-react";
import { SoftwareLogo } from "@/components/shared/SoftwareLogo";
import { appColor } from "@/lib/apps";
import { adPlatformSoftware } from "@/lib/martech/labels";
import type { AdNode } from "@/lib/martech/types";
import { evidenceClasses, selectionRing } from "./evidence";

/*
 * Traffic source. Orrit reads nothing from the ad account: when the
 * platform can be inferred from attribution / conversion targets the card
 * says so; otherwise it is an honest "not captured" outline.
 */
export function AdPlatformNode({ node, selected }: { node: AdNode; selected: boolean }) {
  const software = node.inferred ? adPlatformSoftware(node.destination) : null;
  return (
    <div
      className={`flex min-h-full w-full items-center gap-2.5 rounded-card border px-3 py-2 ${evidenceClasses(node.evidence)}`}
      style={{ boxShadow: selectionRing(selected) }}
    >
      {software ? (
        <span
          aria-hidden="true"
          className="flex size-8 flex-none items-center justify-center rounded-node border border-white/40 text-white"
          style={{ background: `color-mix(in oklab, ${appColor(software)} 52%, #000)` }}
        >
          <SoftwareLogo app={software} size={18} />
        </span>
      ) : (
        <span className="flex size-8 flex-none items-center justify-center rounded-node border border-dashed border-line-strong text-t3">
          <Megaphone aria-hidden="true" className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block [overflow-wrap:anywhere] text-[12.5px] font-semibold leading-tight">{node.label}</span>
        <span className="block [overflow-wrap:anywhere] text-[10px] leading-[13px] text-t3">{node.sublabel}</span>
      </span>
    </div>
  );
}

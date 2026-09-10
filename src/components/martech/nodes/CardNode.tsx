"use client";

import { createElement } from "react";
import { Radar, type LucideIcon } from "lucide-react";
import { SoftwareLogo } from "@/components/shared/SoftwareLogo";
import { appColor } from "@/lib/apps";
import { ACTION_KIND_LABEL, ASSET_KIND_LABEL, actionIcon, actionSoftware, assetIcon, triggerIcon } from "@/lib/martech/labels";
import type { ActionNode, AssetNode, PixelNode, TriggerNode } from "@/lib/martech/types";
import { evidenceClasses, selectionRing } from "./evidence";

/*
 * The 116px-wide sub-lane card (54px when its name fits one line), in four variants: asset (form / survey /
 * calendar on the page), pixel (browser tracking — always not captured),
 * trigger (the workflow's entry condition) and action (one configured step;
 * conversion actions carry the destination's logo).
 */
export function CardNode({ node, selected }: { node: AssetNode | PixelNode | TriggerNode | ActionNode; selected: boolean }) {
  let Icon: LucideIcon;
  let caption: string;
  let logo: string | null = null;
  switch (node.kind) {
    case "asset":
      Icon = assetIcon(node.asset.kind);
      caption = ASSET_KIND_LABEL[node.asset.kind];
      break;
    case "pixel":
      Icon = Radar;
      caption = "Pixel";
      break;
    case "trigger":
      Icon = triggerIcon(node.automation.trigger);
      caption = "Trigger";
      break;
    default:
      Icon = node.action ? actionIcon(node.action.kind) : actionIcon("other");
      caption = node.action ? ACTION_KIND_LABEL[node.action.kind] : "Actions";
      if (node.action?.kind === "conversion") logo = actionSoftware(node.action);
  }
  return (
    <div
      className={`flex min-h-full w-full items-center gap-2 rounded-control border px-2 py-1.5 ${evidenceClasses(node.evidence)}`}
      style={{ boxShadow: selectionRing(selected) }}
    >
      {logo ? (
        <span
          aria-hidden="true"
          className="flex size-6 flex-none items-center justify-center rounded-[6px] border border-white/40 text-white"
          style={{ background: `color-mix(in oklab, ${appColor(logo)} 52%, #000)` }}
        >
          <SoftwareLogo app={logo} size={13} />
        </span>
      ) : (
        <span className={`flex size-6 flex-none items-center justify-center rounded-[6px] border ${node.evidence === "configured" ? "border-line bg-hover text-t2" : "border-dashed border-line-strong text-t3"}`}>
          {createElement(Icon, { "aria-hidden": true, className: "size-3" })}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block [overflow-wrap:anywhere] text-[9px] font-semibold uppercase leading-[12px] tracking-[.05em] text-t3">{caption}</span>
        <span className="block [overflow-wrap:anywhere] text-[11px] font-medium leading-tight">
          {node.label}
        </span>
      </span>
    </div>
  );
}

"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/*
 * The map's tooltip: the app's Radix tooltip on any icon-only control, shown
 * on hover and keyboard focus. One `TooltipProvider` lives at the WorkflowMap
 * root (delayDuration 250) — never per node. The content is portalled and
 * ignores pointer events so it can never intercept a pan or a click.
 */
export function MapTip({ label, side = "top", children }: { label: string; side?: "top" | "right" | "bottom" | "left"; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6} className="pointer-events-none">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

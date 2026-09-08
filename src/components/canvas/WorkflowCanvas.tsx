"use client";

import type { ComponentProps } from "react";
import type { ProviderId } from "@/lib/connectors/types";
import ScenarioCanvas from "./ScenarioCanvas";

/** The workflow canvas. On-canvas filtering was removed — a single workflow
 * reads better whole, and browse/search lives in the shell. */
export function WorkflowCanvas(
  {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    provider, workflowId, revision, ...canvas
  }: ComponentProps<typeof ScenarioCanvas> & { provider: ProviderId; workflowId: string; revision: number }
) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <ScenarioCanvas {...canvas} />
      </div>
    </div>
  );
}

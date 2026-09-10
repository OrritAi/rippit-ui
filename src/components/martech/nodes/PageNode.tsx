"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import type { FunnelPageScreenshot } from "@/app/lib/api";
import { roleLabel } from "@/lib/martech/labels";
import type { PageNode as PageNodeModel } from "@/lib/martech/types";
import { evidenceClasses, selectionRing } from "./evidence";

/*
 * Page card: a 16:9 thumbnail (the worker's screenshot of the public URL)
 * over a name strip. Four thumbnail states, none invented: captured →
 * image; pending → "Capturing…"; failed / unavailable / none → "Screenshot
 * not captured" with the reason as a tooltip. Placeholder tile when the
 * canvas is in LITE mode or zoomed out too far to read an image.
 */
export function PageNode({
  node,
  width,
  thumbH,
  selected,
  placeholder,
}: {
  node: PageNodeModel;
  width: number;
  thumbH: number;
  selected: boolean;
  placeholder: boolean;
}) {
  const shot = node.page?.screenshot ?? null;
  const role = roleLabel(node.role);
  return (
    <div
      className={`flex min-h-full w-full flex-col overflow-hidden rounded-card border ${evidenceClasses(node.evidence)}`}
      style={{ width, boxShadow: selectionRing(selected) }}
    >
      <div className="relative flex-none overflow-hidden border-b border-line2 bg-plane" style={{ height: thumbH }}>
        {placeholder ? <PlaceholderTile /> : <Thumbnail shot={shot} name={node.label} evidence={node.evidence} />}
        {role && (
          <span className="absolute left-1.5 top-1.5 rounded-full border border-line bg-pill px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[.05em] text-t3">
            {role}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col justify-center px-2.5 py-1.5">
        <span className="block [overflow-wrap:anywhere] text-[12px] font-semibold leading-tight">
          {node.label}
        </span>
        <span className="tabular block [overflow-wrap:anywhere] font-mono text-[9.5px] leading-[13px] text-t3">
          {node.sublabel ?? (node.evidence === "not-captured" ? "Not captured" : "")}
        </span>
      </div>
    </div>
  );
}

function PlaceholderTile() {
  return <div aria-hidden="true" className="h-full w-full bg-hover" />;
}

function Thumbnail({ shot, name, evidence }: { shot: FunnelPageScreenshot | null; name: string; evidence: "configured" | "not-captured" }) {
  const [broken, setBroken] = useState(false);
  if (shot?.status === "captured" && shot.url && !broken) {
    return (
      <img  // eslint-disable-line @next/next/no-img-element -- signed storage URL, not an optimisable asset
        src={shot.url}
        alt={`Screenshot of ${name}`}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover object-top"
        onError={() => setBroken(true)}
      />
    );
  }
  if (shot?.status === "pending") {
    return (
      <div role="status" className="flex h-full w-full animate-pulse items-center justify-center bg-hover text-[10.5px] text-t3 motion-reduce:animate-none">
        Capturing…
      </div>
    );
  }
  const reason = broken ? "The screenshot could not be loaded" : shot?.reason ?? (evidence === "not-captured" ? "No page captured for this step" : "No screenshot yet");
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-t3" title={reason}>
      <ImageOff aria-hidden="true" className="size-4" />
      <span className="text-[10px]">Screenshot not captured</span>
      <span className="sr-only">{reason}</span>
    </div>
  );
}

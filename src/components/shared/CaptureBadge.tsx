"use client";

import { AlertTriangle, Archive, CircleSlash, Clock } from "lucide-react";
import type { CaptureState } from "@/app/lib/api";
import { ago } from "@/lib/time";

type Tone = "warn" | "err" | "off";

function describe(capture: CaptureState): {
  label: string;
  detail: string;
  tone: Tone;
  Icon: typeof AlertTriangle;
} | null {
  if (capture.deletedUpstreamAt) {
    return {
      label: "Removed in the platform",
      detail: `Kept for its history since ${ago(capture.deletedUpstreamAt)} — not live documentation.`,
      tone: "off",
      Icon: Archive,
    };
  }
  switch (capture.state) {
    case "failed":
      return {
        label: "Not re-read",
        detail: `Orrit could not read this on the last sync (${ago(capture.attemptedAt)}). Showing what it captured ${ago(capture.at)}.${capture.error ? ` ${capture.error}` : ""}`,
        tone: "warn",
        Icon: AlertTriangle,
      };
    case "never-captured":
      return {
        label: "Never read",
        detail: "This exists in the platform, but Orrit has never managed to read its contents.",
        tone: "err",
        Icon: CircleSlash,
      };
    case "changed":
      return {
        label: "Changed upstream",
        detail: `Edited in the platform since Orrit last read it ${ago(capture.at)}.`,
        tone: "warn",
        Icon: Clock,
      };
    default:
      // "current" is the normal case and needs no badge — a chip on every row
      // would be noise, and the freshness is on the connection anyway.
      return null;
  }
}

const TONE: Record<Tone, string> = {
  warn: "border-[color-mix(in_srgb,var(--warn)_38%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] text-warn-text",
  err: "border-[color-mix(in_srgb,var(--err)_38%,transparent)] bg-[color-mix(in_srgb,var(--err)_10%,transparent)] text-err-text",
  off: "border-line-strong bg-hover text-t3",
};

/**
 * States what Orrit actually has for a workflow, when nothing is wrong with
 * the workflow itself.
 *
 * This is deliberately worded as Orrit's problem, not the estate's: a failed
 * capture is us failing to read, and presenting it as breakage is the exact
 * false alarm the health model exists to prevent.
 */
export function CaptureBadge({
  capture,
  compact = false,
}: {
  capture?: CaptureState;
  compact?: boolean;
}) {
  if (!capture) return null;
  const info = describe(capture);
  if (!info) return null;
  const { label, detail, tone, Icon } = info;

  return (
    <span
      title={detail}
      className={`inline-flex items-center gap-1 rounded-control border px-1.5 py-[2px] text-[11px] font-semibold ${TONE[tone]}`}
    >
      <Icon aria-hidden="true" className="size-3" />
      {compact ? null : label}
      <span className="sr-only">{detail}</span>
    </span>
  );
}

/** Longer form for the workflow header, where there is room to say why. */
export function CaptureNotice({ capture }: { capture?: CaptureState }) {
  if (!capture) return null;
  const info = describe(capture);
  if (!info) return null;
  const { label, detail, tone, Icon } = info;
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-control border px-3 py-2 text-[12.5px] ${TONE[tone]}`}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 flex-none" />
      <p>
        <span className="font-semibold">{label}.</span> {detail}
      </p>
    </div>
  );
}

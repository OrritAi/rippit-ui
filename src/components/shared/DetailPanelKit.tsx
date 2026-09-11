"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export const EASE = [0.22, 1, 0.36, 1] as const;

/* Recursive syntax-colored JSON renderer (handoff JSON palette). */
export function JsonValue({ value, depth }: { value: unknown; depth: number }) {
  if (value === null || value === undefined)
    return <span style={{ color: "var(--jbool)" }}>null</span>;
  if (typeof value === "boolean")
    return <span style={{ color: "var(--jbool)" }}>{String(value)}</span>;
  if (typeof value === "number")
    return <span style={{ color: "var(--jnum)" }}>{value}</span>;
  if (typeof value === "string")
    return <span style={{ color: "var(--jstr)" }}>&quot;{value}&quot;</span>;

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [i, v] as const)
    : Object.entries(value as Record<string, unknown>);
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";

  if (entries.length === 0)
    return (
      <span style={{ color: "var(--jpunc)" }}>
        {open}
        {close}
      </span>
    );

  return (
    <>
      <span style={{ color: "var(--jpunc)" }}>{open}</span>
      {entries.map(([k, v], i) => (
        <div key={String(k)} style={{ paddingLeft: 14 }}>
          {!isArray && (
            <>
              <span style={{ color: "var(--jkey)" }}>&quot;{k}&quot;</span>
              <span style={{ color: "var(--jpunc)" }}>: </span>
            </>
          )}
          <JsonValue value={v} depth={depth + 1} />
          {i < entries.length - 1 && (
            <span style={{ color: "var(--jpunc)" }}>,</span>
          )}
        </div>
      ))}
      <span style={{ color: "var(--jpunc)" }}>{close}</span>
    </>
  );
}

export function JsonBlock({ data }: { data: unknown }) {
  if (data == null) return <p className="text-[12px] italic text-t3">None</p>;
  return (
    <div className="max-h-64 overflow-auto rounded-code border border-line2 bg-code px-3.5 py-3 font-mono text-[12px] leading-[1.75]">
      <JsonValue value={data} depth={0} />
    </div>
  );
}

export function Section({
  title,
  action,
  tone = "default",
  children,
}: {
  title: string;
  action?: React.ReactNode;
  /** `triage`: the header wears the triage-layer accent (replay sections). */
  tone?: "default" | "triage";
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className={`text-[11.5px] font-semibold ${tone === "triage" ? "text-triage" : "text-t3"}`}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Values always wrap; `wrap` top-aligns the key for values known to run long. */
export function KvRow({ k, v, wrap = false }: { k: string; v: React.ReactNode; wrap?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 border-b border-line2 px-0.5 py-[9px] ${wrap ? "items-start" : "items-center"}`}>
      <div className="flex-none text-[12px] text-t3">{k}</div>
      <div className="min-w-0 text-right font-mono text-[11.5px] [overflow-wrap:anywhere]">{v}</div>
    </div>
  );
}

/** Copy-as-JSON action for a Section header. */
export function CopyJsonButton({ data }: { data: unknown }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(JSON.stringify(data, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      aria-label={copied ? "Copied to clipboard" : "Copy JSON to clipboard"}
      className="flex cursor-pointer items-center gap-1 text-[11px] text-t3 transition-colors hover:text-t1"
    >
      <span aria-hidden="true">{copied ? "copied" : "copy"}</span>
      {copied ? (
        <Check aria-hidden="true" className="size-2.5" />
      ) : (
        <Copy aria-hidden="true" className="size-2.5" />
      )}
    </button>
  );
}

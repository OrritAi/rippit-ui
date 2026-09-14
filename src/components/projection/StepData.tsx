"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import type { BundleFrame, ExecutionBundles, FieldProvenance, ProjectedField } from "@/app/lib/api";
import { JsonBlock, Section } from "@/components/shared/DetailPanelKit";
import { Segmented } from "@/components/shared/Segmented";
import { ProvenanceRow, flattenPaths } from "./Provenance";

/*
 * Step data — what this step actually received and returned.
 *
 * This section replaces the note Rippit used to show on every non-entry step:
 * "<platform> does not expose this step's data." That was true of the API
 * Rippit was using and false of the API Make has; the endpoint behind this
 * panel was verified live on 2026-09-12.
 *
 * Three things the shape of this panel is deliberate about:
 *
 *  - **Operations, not the first bundle.** A module can run forty times in one
 *    execution. Showing operation 1 and calling it "the input" would be a lie
 *    the operator could not detect, so the picker is always present when there
 *    is more than one.
 *  - **Dotted paths, not raw JSON.** A row reads straight back into
 *    `{{4.contact.city}}`. Raw is a toggle for when the shape matters more.
 *  - **Two kinds of truncation.** Make's own flag and Rippit's cap are
 *    different facts and are reported as different sentences; neither trims
 *    silently.
 */

export interface StepDataProps {
  /** Null while loading, `available: false` with a reason once resolved. */
  bundles: ExecutionBundles | null;
  loading: boolean;
  nodeId: string;
  /** Per-field provenance from a projection, when one is active. Without it
   *  every value is `observed` — it came from the platform. */
  projected?: ProjectedField[];
  /** Offered per row; absent when the workflow cannot be projected. */
  onOverride?: (nodeId: string, key: string, current: unknown) => void;
  onTestStep?: (nodeId: string) => void;
  /** A platform that exposes no step data says so in its own words. */
  unsupportedReason?: string | null;
}

type Side = "input" | "output";

export function StepData({
  bundles,
  loading,
  nodeId,
  projected,
  onOverride,
  onTestStep,
  unsupportedReason,
}: StepDataProps) {
  const [side, setSide] = useState<Side>("input");
  const [op, setOp] = useState(0);
  const [query, setQuery] = useState("");
  const [raw, setRaw] = useState(false);

  const frame: BundleFrame | undefined = bundles?.frames?.[nodeId];
  const operations = frame?.operations ?? [];
  const index = Math.min(op, Math.max(0, operations.length - 1));
  const current = operations[index];
  const value = current ? (side === "input" ? current.input : current.output) : undefined;

  const stateByKey = useMemo(() => {
    const out = new Map<string, ProjectedField>();
    for (const f of projected ?? []) out.set(f.key, f);
    return out;
  }, [projected]);

  const rows = useMemo(() => {
    const all = value == null ? [] : flattenPaths(value);
    const needle = query.trim().toLowerCase();
    return needle ? all.filter((r) => r.path.toLowerCase().includes(needle)) : all;
  }, [value, query]);

  const total = value == null ? 0 : flattenPaths(value).length;

  if (unsupportedReason) {
    return (
      <Section title="Step data">
        <p className="m-0 text-[11.5px] leading-[1.5] text-t3">{unsupportedReason}</p>
      </Section>
    );
  }

  if (loading) {
    return (
      <Section title="Step data">
        <p className="m-0 text-[11.5px] text-t3">Reading this run…</p>
      </Section>
    );
  }

  // Not "no data": a step Make recorded nothing for is a different fact from a
  // run whose data has aged out, and both are different from a platform that
  // exposes none. Each says which.
  if (!bundles?.available || !frame) {
    return (
      <Section title="Step data">
        <p className="m-0 text-[11.5px] leading-[1.5] text-t3">
          {bundles?.reason ?? "This step recorded nothing in this run."}
        </p>
      </Section>
    );
  }

  return (
    <Section
      title="Step data"
      action={
        <button
          type="button"
          onClick={() => setRaw((r) => !r)}
          aria-pressed={raw}
          className="rounded-control border border-line px-2 py-[3px] font-mono text-[9.5px] text-t3 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1"
        >
          raw
        </button>
      }
    >
      <div className="flex items-center gap-2">
        <Segmented<Side>
          value={side}
          onChange={(v) => setSide(v)}
          label="Step data side"
          options={[
            { value: "input", label: "Input" },
            { value: "output", label: "Output" },
          ]}
        />
        <span className="ml-auto font-mono text-[10px] text-t3 tabular">
          {rows.length === total ? `${total} of ${total}` : `${rows.length} of ${total}`} fields
        </span>
      </div>

      {operations.length > 1 && (
        <div className="mt-2 flex items-center gap-2">
          <OpButton label="Previous operation" onClick={() => setOp(Math.max(0, index - 1))} disabled={index === 0}>
            <ChevronLeft className="size-3" />
          </OpButton>
          <span className="tabular flex-1 text-center font-mono text-[10.5px] text-t2">
            op {index + 1} of {operations.length}
          </span>
          <OpButton
            label="Next operation"
            onClick={() => setOp(Math.min(operations.length - 1, index + 1))}
            disabled={index >= operations.length - 1}
          >
            <ChevronRight className="size-3" />
          </OpButton>
        </div>
      )}

      {!raw && total > 6 && (
        <div className="mt-2 flex items-center gap-2 rounded-control border border-line bg-pill px-2.5 py-1.5">
          <Search className="size-3 flex-none text-t3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter fields…"
            aria-label="Filter fields"
            className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-t1 outline-none placeholder:text-t3"
          />
        </div>
      )}

      <div className="mt-2">
        {raw ? (
          <JsonBlock data={value} />
        ) : rows.length === 0 ? (
          <p className="m-0 text-[11.5px] text-t3">
            {total === 0
              ? `Nothing recorded on this step's ${side}.`
              : "No field matches that filter."}
          </p>
        ) : (
          <div className="-mx-4 border-t border-line2">
            {rows.map((row) => {
              const field = stateByKey.get(row.path);
              const state: FieldProvenance = field?.state ?? "observed";
              return (
                <ProvenanceRow
                  key={row.path}
                  path={row.path || "(root)"}
                  state={state}
                  value={row.value}
                  blockedBy={field?.blockedBy}
                  action={
                    onOverride && side === "input" ? (
                      <button
                        type="button"
                        onClick={() => onOverride(nodeId, row.path, row.value)}
                        className="font-mono text-[9.5px] text-t3 underline decoration-line-strong underline-offset-2 transition-colors duration-[var(--dur-fast)] hover:text-t1"
                      >
                        override
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {current?.truncated && (
        <p className="m-0 mt-2 text-[10.5px] leading-[1.5] text-warn-text">
          Make truncated this bundle when it recorded the run.
        </p>
      )}
      {current?.cappedBy === "rippit" && (
        <p className="m-0 mt-1 text-[10.5px] leading-[1.5] text-warn-text">
          Too large to show — Rippit caps what it fetches. Open the run in Make for the whole bundle.
        </p>
      )}
      {current?.unparsed && (
        <p className="m-0 mt-1 text-[10.5px] leading-[1.5] text-t3">
          Not JSON — shown as the platform sent it.
        </p>
      )}
      {frame.inBlueprint === false && (
        <p className="m-0 mt-1 text-[10.5px] leading-[1.5] text-t3">
          This step ran but is no longer in the workflow.
        </p>
      )}

      {onTestStep && (
        <button
          type="button"
          onClick={() => onTestStep(nodeId)}
          className="mt-3 w-full rounded-control border border-line-strong px-3 py-1.5 text-[11.5px] font-semibold text-t2 transition-colors duration-[var(--dur-fast)] hover:text-t1"
        >
          Test this step
        </button>
      )}

      <p className="m-0 mt-3 border-t border-line2 pt-2.5 font-mono text-[10px] text-t3">never stored</p>
    </Section>
  );
}

function OpButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex size-[22px] flex-none items-center justify-center rounded-control border border-line text-t3 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

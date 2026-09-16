"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { fetchInputContract, type ContractField, type InputContract } from "@/app/lib/api";
import type { ProviderId } from "@/lib/connectors/types";

/*
 * Dry run — type an input, see where it would go.
 *
 * A **left** inset, not the right dock, and that is the answer to the dock
 * conflict recorded in `design/claude-design-brief.md` §6: input on the left,
 * inspection on the right, so an override stays editable while its effect is
 * visible. Putting both in one dock would make the operator choose between
 * seeing the cause and seeing the result.
 *
 * Two things carry the design:
 *
 *  - **Gated fields first, with their thresholds.** A field only mapped into a
 *    later step cannot change the path; a field a router tests can. Showing
 *    `≥ 1000` next to `value` is the highest-value microcopy here — it tells
 *    the operator what to type to reach the interesting case, instead of
 *    making them guess and re-run.
 *  - **The verdict recomputes on every keystroke, locally.** The contract
 *    already carries the operator and the comparison value, so the first gate
 *    can be evaluated in the browser with no round trip. Projecting the whole
 *    workflow is the explicit button.
 *
 * Nothing typed here is stored, logged, or put in the URL — a reload clears
 * it, and the panel says so rather than letting an empty form look broken.
 */

export function DryRunPanel({
  provider,
  externalId,
  onProject,
  onClose,
  busy = false,
}: {
  provider: ProviderId;
  externalId: string;
  onProject: (input: Record<string, string>) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [omitted, setOmitted] = useState<Record<string, boolean>>({});
  /* The answer is keyed by the request that asked for it, so an answer in
     flight when the workflow changes is never painted under the new one —
     and "loading" is derived from that key rather than set inside an effect
     (which `react-hooks/set-state-in-effect` rightly forbids). */
  const requestKey = `${provider}|${externalId}`;
  const [answer, setAnswer] = useState<{ key: string; contract: InputContract | null; error: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    fetchInputContract(provider, externalId)
      .then((c) => live && setAnswer({ key: `${provider}|${externalId}`, contract: c, error: false }))
      .catch(() => live && setAnswer({ key: `${provider}|${externalId}`, contract: null, error: true }));
    return () => {
      live = false;
    };
  }, [provider, externalId]);

  const loaded = answer?.key === requestKey ? answer : null;
  const contract = loaded?.contract ?? null;
  const error = !!loaded?.error;
  const fields = useMemo(() => contract?.fields ?? [], [contract]);
  const verdict = useMemo(() => verdictFor(fields, values), [fields, values]);

  const submit = () => {
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (!omitted[k] && v !== "") payload[k] = v;
    }
    onProject(payload);
  };

  return (
    <aside
      aria-label="Dry run"
      className="flex w-[274px] flex-none flex-col overflow-y-auto border-r border-line bg-panel"
    >
      <header className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="m-0 flex-1 text-[13px] font-semibold text-t1">Dry run</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dry run"
          className="text-t3 transition-colors duration-[var(--dur-fast)] hover:text-t1"
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div className="flex-1 px-4 py-3">
        {error ? (
          <p className="m-0 text-[11.5px] leading-[1.5] text-t3">
            The input contract could not be read. Close the panel and try again.
          </p>
        ) : !loaded ? (
          <p className="m-0 text-[11.5px] text-t3">Reading what this workflow expects…</p>
        ) : !contract || !contract.supported ? (
          <p className="m-0 text-[11.5px] leading-[1.5] text-t3">{contract?.reason ?? "This platform cannot be projected yet."}</p>
        ) : fields.length === 0 ? (
          <p className="m-0 text-[11.5px] leading-[1.5] text-t3">
            This workflow&apos;s steps don&apos;t read any trigger fields Orrit can see, so there is
            nothing to fill in.
          </p>
        ) : (
          <>
            {contract?.shape === "contact" && (
              <p className="m-0 mb-3 text-[11px] leading-[1.5] text-t3">
                GoHighLevel workflows read a contact record, not a request body.
              </p>
            )}
            {fields.map((f) => (
              <Field
                key={f.path}
                field={f}
                value={values[f.path] ?? ""}
                omitted={!!omitted[f.path]}
                onChange={(v) => setValues((s) => ({ ...s, [f.path]: v }))}
                onOmit={(v) => setOmitted((s) => ({ ...s, [f.path]: v }))}
              />
            ))}
            {verdict && (
              <p className="m-0 mt-3 rounded-row border border-line2 bg-code px-3 py-2.5 text-[11.5px] leading-[1.5] text-t2">
                {verdict}
              </p>
            )}
          </>
        )}
      </div>

      {contract?.supported && fields.length > 0 && (
        <footer className="flex-none border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={submit}
            disabled={busy || Object.values(values).every((v) => v === "")}
            className="w-full rounded-control bg-t1 px-3 py-2 text-[12px] font-semibold text-bg transition-opacity duration-[var(--dur-fast)] disabled:pointer-events-none disabled:opacity-40"
          >
            {busy ? "Projecting…" : "Project this payload"}
          </button>
          <p className="m-0 mt-2 font-mono text-[9.5px] leading-[1.5] text-t3">
            nothing runs · nothing stored · a reload clears it
          </p>
        </footer>
      )}
    </aside>
  );
}

function Field({
  field,
  value,
  omitted,
  onChange,
  onOmit,
}: {
  field: ContractField;
  value: string;
  omitted: boolean;
  onChange: (v: string) => void;
  onOmit: (v: boolean) => void;
}) {
  const threshold = thresholdOf(field);
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center gap-1.5">
        <label htmlFor={`dry-${field.path}`} className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-t3">
          {field.path}
        </label>
        {threshold && (
          <span className="flex-none rounded-full border border-line px-[6px] py-[1px] font-mono text-[9px] text-t3">
            {threshold}
          </span>
        )}
      </div>
      <input
        id={`dry-${field.path}`}
        value={omitted ? "" : value}
        disabled={omitted}
        onChange={(e) => onChange(e.target.value)}
        inputMode={field.inferredType === "number" ? "numeric" : undefined}
        className="w-full rounded-control border border-line bg-pill px-2.5 py-1.5 font-mono text-[11.5px] text-t1 outline-none transition-colors duration-[var(--dur-fast)] focus:border-line-strong disabled:opacity-40"
      />
      {/* Blank and absent are different things to an `exists` gate, so the
          form can say which one it means rather than guessing. */}
      <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-[10px] text-t3">
        <input type="checkbox" checked={omitted} onChange={(e) => onOmit(e.target.checked)} className="size-3" />
        leave this field out entirely
      </label>
    </div>
  );
}

/** `≥ 1000`, `exists`, `= cpc` — the comparison the blueprint actually makes,
 *  read off the contract rather than re-derived. */
export function thresholdOf(field: ContractField): string | null {
  if (!field.inGate) return null;
  const op = field.operators[0];
  const to = field.comparedTo[0];
  if (!op) return null;
  const verb = op.includes(":") ? op.split(":")[1] : op;
  const symbol: Record<string, string> = {
    gte: "≥", greaterorequal: "≥", greater: ">", gt: ">",
    lte: "≤", lessorequal: "≤", less: "<", lt: "<",
    equal: "=", equalci: "=",
  };
  if (verb.startsWith("notexist")) return "must be absent";
  if (verb.startsWith("exist")) return "exists";
  if (!to) return verb;
  return `${symbol[verb] ?? verb} ${to}`;
}

/** The first gated field with a value decides the headline, computed locally.
 *  A verdict that needed the server would not survive a keystroke. */
export function verdictFor(fields: ContractField[], values: Record<string, string>): string | null {
  const gated = fields.find((f) => f.inGate && (values[f.path] ?? "") !== "");
  if (!gated) return null;
  const raw = values[gated.path];
  const to = gated.comparedTo[0];
  const op = gated.operators[0] ?? "";
  const verb = op.includes(":") ? op.split(":")[1] : op;
  if (op.startsWith("number") || gated.inferredType === "number") {
    const left = Number(raw);
    const right = Number(to);
    if (Number.isNaN(left)) return `${gated.path} is not a number, so this gate cannot be evaluated.`;
    if (Number.isNaN(right)) return null;
    const passes =
      verb === "greater" || verb === "gt" ? left > right
      : verb === "less" || verb === "lt" ? left < right
      : verb === "lte" || verb === "lessorequal" ? left <= right
      : left >= right;
    return `${gated.path} ${raw} ${thresholdOf(gated)} → the gated path would ${passes ? "run" : "be skipped"}.`;
  }
  if (to == null) return null;
  const passes = verb.startsWith("not") ? raw !== to : raw === to;
  return `${gated.path} ${JSON.stringify(raw)} ${thresholdOf(gated)} → the gated path would ${passes ? "run" : "be skipped"}.`;
}

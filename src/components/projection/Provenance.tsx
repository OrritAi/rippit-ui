import type { FieldProvenance } from "@/app/lib/api";

/*
 * The provenance register — the design's core decision, and the thing that
 * keeps this feature honest.
 *
 * Orrit now has four classes of truth: what the platform recorded
 * (`observed`), what the operator typed (`supplied`), what Orrit worked out
 * (`resolved` / `constant` / `opaque`), and what nothing supplies
 * (`unresolved`). They appear side by side in one panel, and the failure this
 * exists to prevent is an observed value and a computed value rendering in the
 * same typography. If a row cannot answer *did this happen, or did Orrit work
 * it out*, it is wrong.
 *
 * Colour cannot carry it: in this product colour is reserved for status and
 * app identity (`design/claude-design-brief.md` §3), and a fifth hue would
 * collide with both. So the register rides on the **stroke style of a 2px left
 * rule plus a mono tag**, with the value's ink stepping back as certainty
 * drops. Accent marks only the class the operator authored, which is the one
 * thing on screen they are responsible for.
 *
 * No new token, no animation as the only signal, legible in both themes and
 * unaffected by lite mode. `Legend` carries a row per mark.
 */

interface Mark {
  /** `border-left-style` — the channel doing the work. */
  stroke: "solid" | "dashed" | "dotted";
  color: string;
  tag: string;
  /** Value ink: certain values read at full strength, guesses recede. */
  ink: string;
  accent?: boolean;
}

const MARKS: Record<FieldProvenance, Mark> = {
  observed: { stroke: "solid", color: "var(--t2)", tag: "observed", ink: "var(--text)" },
  supplied: { stroke: "solid", color: "var(--map-accent)", tag: "you set", ink: "var(--text)", accent: true },
  resolved: { stroke: "dashed", color: "var(--t3)", tag: "computed", ink: "var(--t2)" },
  constant: { stroke: "dashed", color: "var(--t3)", tag: "fixed", ink: "var(--t2)" },
  opaque: { stroke: "dashed", color: "var(--t3)", tag: "derived", ink: "var(--t3)" },
  unresolved: { stroke: "dotted", color: "var(--t3)", tag: "needs a step", ink: "var(--t3)" },
};

export function markFor(state: FieldProvenance): Mark {
  return MARKS[state] ?? MARKS.resolved;
}

/** The 2px rule. `min-height` so a one-line row still reads as a rule rather
 *  than a dash. */
export function ProvenanceRule({ state }: { state: FieldProvenance }) {
  const mark = markFor(state);
  return (
    <span
      aria-hidden
      className="min-h-[26px] w-[2px] flex-none self-stretch"
      style={{ borderLeft: `2px ${mark.stroke} ${mark.color}` }}
    />
  );
}

/** The mono tag. `blockedBy` turns the unresolved tag into the answer to the
 *  operator's actual question — which step would unblock this. */
export function ProvenanceTag({ state, blockedBy }: { state: FieldProvenance; blockedBy?: string }) {
  const mark = markFor(state);
  const label = state === "unresolved" && blockedBy ? `needs step ${blockedBy}` : mark.tag;
  return (
    <span
      className="flex-none whitespace-nowrap rounded-full px-[7px] py-[2px] font-mono text-[9px]"
      style={{
        border: `1px solid ${mark.accent ? "color-mix(in srgb, var(--map-accent) 40%, transparent)" : "var(--line)"}`,
        background: mark.accent ? "color-mix(in srgb, var(--map-accent) 10%, transparent)" : "transparent",
        color: mark.accent ? "var(--map-accent-text)" : "var(--t3)",
      }}
    >
      {label}
    </span>
  );
}

/** One field: dotted path, tag, and the value in its own ink.
 *
 *  Paths are dotted (`contact.address.city`) rather than nested JSON on
 *  purpose — that is the same vocabulary a mapper references, so a row reads
 *  straight into `{{4.contact.address.city}}`. Raw JSON is a toggle away for
 *  when the shape matters more than the values. */
export function ProvenanceRow({
  path,
  state,
  value,
  blockedBy,
  action,
}: {
  path: string;
  state: FieldProvenance;
  value: unknown;
  blockedBy?: string;
  action?: React.ReactNode;
}) {
  const mark = markFor(state);
  const unresolved = state === "unresolved" || state === "opaque";
  return (
    <div className="flex gap-2.5 border-b border-line2 px-4 py-2.5 last:border-b-0">
      <ProvenanceRule state={state} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-t3" title={path}>
            {path}
          </span>
          <ProvenanceTag state={state} blockedBy={blockedBy} />
        </div>
        <div
          className="mt-1 font-mono text-[11.5px] leading-[1.5] [overflow-wrap:anywhere]"
          style={{ color: mark.ink, fontStyle: unresolved ? "italic" : undefined }}
        >
          {unresolved ? "—" : formatValue(value)}
        </div>
        {action ? <div className="mt-1.5">{action}</div> : null}
      </div>
    </div>
  );
}

/** Values render as JSON so a string is visibly a string — `"400"` and `400`
 *  are different things to a numeric gate, and the panel must not hide which
 *  one a step actually received. */
export function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Dotted leaf paths of a bundle, in source order. Lists contribute their
 *  index so a row still reads back into a mapper reference. */
export function flattenPaths(data: unknown, prefix = "", depth = 0): { path: string; value: unknown }[] {
  if (depth > 6) return [{ path: prefix, value: data }];
  if (Array.isArray(data)) {
    if (data.length === 0) return [{ path: prefix, value: data }];
    return data.flatMap((v, i) => flattenPaths(v, prefix ? `${prefix}.${i}` : String(i), depth + 1));
  }
  if (data && typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return [{ path: prefix, value: data }];
    return entries.flatMap(([k, v]) => flattenPaths(v, prefix ? `${prefix}.${k}` : k, depth + 1));
  }
  return [{ path: prefix, value: data }];
}

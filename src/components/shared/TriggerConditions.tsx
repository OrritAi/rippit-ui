import type { AssetRef } from "@/app/lib/api";
import { Section } from "./DetailPanelKit";

const OPERATORS: Record<string, string> = { "==": "is", "!=": "is not", "is-any-of": "is one of", "is-none-of": "is not one of", "has-changed": "has changed", contains: "contains", "is-empty": "is empty", "is-not-empty": "is filled in" };
const ASSET_FIELDS = new Set(["form.id", "survey.id", "calendar.id", "calendar_id"]);

/** Read conditions without exposing opaque identifiers as explanations. */
export function TriggerConditions({ data, assets }: { data: unknown; assets?: AssetRef[] }) {
  if (!data || typeof data !== "object" || !("conditions" in data) || !Array.isArray(data.conditions)) return null;
  const conditions = data.conditions.filter((c): c is Record<string, unknown> => !!c && typeof c === "object");
  if (!conditions.length) return null;
  return <Section title="When it starts"><ul className="space-y-2 text-[12px] leading-relaxed text-t1">
    {conditions.map((c, i) => {
      if (c.field === "surveySubmission.disqualified" && c.operator === "==" && typeof c.value === "boolean") {
        return <li key={i}>{c.value ? "The survey submission is disqualified." : "The survey submission is qualified (not disqualified)."}</li>;
      }
      const title = typeof c.title === "string" ? c.title : "An additional condition";
      const operator = OPERATORS[String(c.operator)];
      if (!operator) return <li key={i}>{title}: explanation unavailable. See Advanced Details.</li>;
      if (["has-changed", "is-empty", "is-not-empty"].includes(String(c.operator))) return <li key={i}>{title} {operator}.</li>;
      const values = Array.isArray(c.value) ? c.value : [c.value];
      const labels = Array.isArray(c.valueLabels) ? c.valueLabels : [];
      return <li key={i}>{title.replace(/ is$/, "")} {operator} {values.map((value, index) => {
        const ref = assets?.find(a => a.value === String(value));
        const supplied = labels[index];
        const name = ref?.label || (typeof supplied === "string" && supplied !== value ? supplied : null);
        const opaque = ASSET_FIELDS.has(String(c.field)) || /^[a-z\d-]{20,}$/i.test(String(value)) || String(value).includes("{{");
        const label = name || (opaque ? "the referenced asset (name unavailable)" : value === true ? "yes" : value === false ? "no" : typeof value === "string" || typeof value === "number" ? String(value) : "an unspecified value");
        return <span key={index}>{index > 0 ? ", " : ""}{ref?.url && !ref.dynamic ? <a className="underline" href={ref.url} target="_blank" rel="noopener noreferrer">{label} ↗</a> : label}</span>;
      })}.</li>;
    })}
  </ul></Section>;
}

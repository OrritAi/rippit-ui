/* Relative time, coarse — "when did this last happen" only ever needs to be
   right to the hour in the UI. Shared by capture badges and the globe. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(secs)) return "never";
  if (secs < 90) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

/** "mar 2026" — for "created …" lines. */
export function monthYear(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", year: "numeric" }).toLowerCase();
}

/** Coarse time until a future instant — "in 6d", "in 3h", "soon"; "expired" once passed. */
export function until(iso: string | null | undefined): string {
  if (!iso) return "—";
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  if (!Number.isFinite(secs)) return "—";
  if (secs <= 0) return "expired";
  if (secs < 3600) return "soon";
  if (secs < 86400) return `in ${Math.round(secs / 3600)}h`;
  return `in ${Math.round(secs / 86400)}d`;
}

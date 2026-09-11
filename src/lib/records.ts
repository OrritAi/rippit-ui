/*
 * Records — is what the user typed a record identifier (an email, a phone
 * number, a contact / record id) rather than a workflow or step name? The
 * palette offers "Find runs touching …" for these, and /triage searches the
 * hashed identifier index (exact match). Pure, no imports.
 */

/** Home of the triage layer: find runs by record, replay failures. */
export const TRIAGE_PATH = "/triage";

export type RecordQueryKind = "email" | "phone" | "id";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Digits with the usual separators only: "+1 (555) 010-9999", "0612 345 678". */
const PHONE_CHARS = /^[\d\s()+.\-]+$/;
const MIN_PHONE_DIGITS = 7;
/** Opaque ids (GHL contact ids are 20 characters, Make ids are numeric). */
const MIN_ID_LENGTH = 20;

/** Which kind of record the query looks like, or null when it reads as a name. */
export function recordKindOf(query: string): RecordQueryKind | null {
  const q = query.trim();
  if (!q) return null;
  if (EMAIL.test(q)) return "email";
  const digits = q.replace(/\D/g, "").length;
  if (digits >= MIN_PHONE_DIGITS && PHONE_CHARS.test(q)) return "phone";
  if (q.length >= MIN_ID_LENGTH && !/\s/.test(q)) return "id";
  return null;
}

export function looksLikeRecord(query: string): boolean {
  return recordKindOf(query) !== null;
}

/** `/triage?q=<record>` — the run timeline for one record. */
export function recordsHref(query: string): string {
  return `${TRIAGE_PATH}?q=${encodeURIComponent(query.trim())}`;
}

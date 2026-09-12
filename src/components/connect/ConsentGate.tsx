"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown } from "lucide-react";
import {
  acceptLegalDocument,
  fetchLegalCatalog,
  fetchLegalDocument,
  fetchMyAcceptances,
  type Acceptance,
  type LegalCatalog,
  type LegalDocument,
} from "@/app/lib/api";
import { Button } from "@/components/ui/button";

/* One in-flight request shared by every gate on the page — the connections
   page renders several, and they all ask the same question. */
let acceptancesCache: Promise<Acceptance[]> | null = null;

function loadAcceptances(): Promise<Acceptance[]> {
  acceptancesCache ??= fetchMyAcceptances()
    .then((r) => r.acceptances)
    .catch((e) => {
      acceptancesCache = null; // don't cache a failure
      throw e;
    });
  return acceptancesCache;
}

/** Call after accepting, so every gate re-reads. */
export function invalidateAcceptances() {
  acceptancesCache = null;
}

/* Which documents each connect path requires. Read from the server so the
   gate the UI shows can never drift from the gate the API enforces. */
let gatesCache: Promise<LegalCatalog["gates"]> | null = null;

export function useLegalGates() {
  const [gates, setGates] = useState<LegalCatalog["gates"] | null>(null);
  useEffect(() => {
    let live = true;
    gatesCache ??= fetchLegalCatalog()
      .then((c) => c.gates)
      .catch((e) => {
        gatesCache = null;
        throw e;
      });
    gatesCache.then((g) => live && setGates(g)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return gates;
}

export function useAcceptances() {
  const [accepted, setAccepted] = useState<Set<string> | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    let live = true;
    loadAcceptances()
      .then((rows) => {
        if (!live) return;
        // Only a current-version acceptance counts — a superseded one is a
        // record of history, not permission.
        setAccepted(new Set(rows.filter((r) => r.current).map((r) => r.slug)));
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load terms"));
    return () => {
      live = false;
    };
  }, []);

  useEffect(refresh, [refresh]);
  return { accepted, error, refresh };
}

/* ─── A very small markdown renderer ──────────────────────────────────────
   The documents are ours and use four constructs: ## headings, - bullets,
   **bold** and paragraphs. That does not justify a dependency. */

function inline(text: string, key: number) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span key={key}>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-t">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        )
      )}
    </span>
  );
}

function DocumentBody({ body }: { body: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc space-y-1 pl-4.5">
        {bullets.map((b, i) => (
          <li key={i}>{inline(b, i)}</li>
        ))}
      </ul>
    );
    bullets = [];
  };

  for (const line of body.split("\n")) {
    const text = line.trim();
    if (!text) {
      flush();
    } else if (text.startsWith("## ")) {
      flush();
      blocks.push(
        <h4 key={`h-${blocks.length}`} className="pt-1 text-[12.5px] font-semibold text-t">
          {text.slice(3)}
        </h4>
      );
    } else if (text.startsWith("- ")) {
      bullets.push(text.slice(2));
    } else {
      flush();
      blocks.push(
        <p key={`p-${blocks.length}`}>{inline(text, blocks.length)}</p>
      );
    }
  }
  flush();

  return <div className="space-y-2 text-[12.5px] leading-[1.55] text-t2">{blocks}</div>;
}

/* ─── The gate ────────────────────────────────────────────────────────── */

function DocumentConsent({
  slug,
  onAccepted,
}: {
  slug: string;
  onAccepted: () => void;
}) {
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // An elevated-risk document opens expanded — nobody should be able to accept
  // one without the text having been in front of them. The document says so
  // itself, so this never drifts from what the server considers risky.
  const risky = doc?.risk === "elevated";
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? risky;

  useEffect(() => {
    let live = true;
    fetchLegalDocument(slug)
      .then((d) => live && setDoc(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load"));
    return () => {
      live = false;
    };
  }, [slug]);

  if (error) {
    return (
      <p role="alert" className="text-[12px] text-err-text">
        {error}
      </p>
    );
  }
  if (!doc) {
    return <div className="h-16 animate-pulse rounded-control bg-hover motion-reduce:animate-none" />;
  }

  return (
    <div
      className={`rounded-control border px-3 py-3 ${
        risky
          ? "border-[color-mix(in_srgb,var(--warn)_38%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)]"
          : "border-line2 bg-hover"
      }`}
    >
      <div className="flex items-start gap-2">
        {risky && (
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 flex-none text-warn-text" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{doc.title}</p>
          {doc.summary && <p className="text-[12px] text-t3">{doc.summary}</p>}
        </div>
        <button
          type="button"
          onClick={() => setManualOpen(!open)}
          aria-expanded={open}
          className="flex flex-none cursor-pointer items-center gap-1 text-[11.5px] font-semibold text-t3 hover:text-t2"
        >
          {open ? "Hide" : "Read"}
          <ChevronDown
            aria-hidden="true"
            className={`size-3 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {open && (
        <div className="mt-3 max-h-72 overflow-y-auto border-t border-line2 pt-3 thin-scroll">
          <DocumentBody body={doc.body} />
        </div>
      )}

      <div className="mt-3 flex items-center gap-2.5">
        <Button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await acceptLegalDocument(slug);
              invalidateAcceptances();
              onAccepted();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not record acceptance");
              setBusy(false);
            }
          }}
          className="h-auto cursor-pointer rounded-control px-3 py-1.5 text-[12.5px] font-semibold hover:opacity-85 disabled:opacity-50"
        >
          {busy ? "Recording…" : risky ? "I understand the risk and accept" : "I accept"}
        </Button>
        <span className="text-[11px] text-t3">Version {doc.version}</span>
      </div>
    </div>
  );
}

/**
 * Renders `children` only once every document in `slugs` has been accepted at
 * its current version; otherwise renders the consent step.
 *
 * This mirrors the server gate rather than replacing it — the API 403s
 * regardless, so a stale client can never connect without a recorded
 * acceptance.
 */
export function ConsentGate({
  slugs,
  intro,
  children,
}: {
  /** null while the caller is still resolving which documents apply — the
   *  gate holds rather than briefly rendering the ungated content. */
  slugs: string[] | null;
  intro?: string;
  children: React.ReactNode;
}) {
  const { accepted, error, refresh } = useAcceptances();

  if (error) {
    return (
      <p role="alert" className="text-[12.5px] text-err-text">
        {error}
      </p>
    );
  }
  if (!accepted || !slugs) {
    return <div className="h-20 animate-pulse rounded-control bg-hover motion-reduce:animate-none" />;
  }

  const outstanding = slugs.filter((slug) => !accepted.has(slug));
  if (!outstanding.length) return <>{children}</>;

  return (
    <div className="flex flex-col gap-2.5">
      {intro && <p className="text-[12.5px] text-t2">{intro}</p>}
      {outstanding.map((slug) => (
        <DocumentConsent key={slug} slug={slug} onAccepted={refresh} />
      ))}
    </div>
  );
}

/** Accepted-terms summary for Settings — "what you accepted, and when". */
export function AcceptedTermsList() {
  const [rows, setRows] = useState<Acceptance[] | null>(null);

  useEffect(() => {
    let live = true;
    loadAcceptances()
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, []);

  if (!rows) return null;
  if (!rows.length) {
    return <p className="border-t border-line2 px-4 py-3 text-[12.5px] text-t3">No terms accepted yet.</p>;
  }

  return (
    <ul>
      {rows.map((row) => (
        <li key={`${row.slug}-${row.version}`} className="flex items-center gap-2.5 border-t border-line2 px-4 py-2.5 text-[13px]">
          <Check aria-hidden="true" className={`size-3 flex-none ${row.current ? "text-ok-text" : "text-t3"}`} />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{row.title}</span>
          <span className="flex-none font-mono text-[11px] text-t3">
            {new Date(row.acceptedAt).toLocaleDateString()}
            {!row.current && " · superseded"}
          </span>
        </li>
      ))}
    </ul>
  );
}

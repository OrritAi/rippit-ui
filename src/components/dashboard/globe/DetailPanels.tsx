"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KvRow, Section } from "@/components/shared/DetailPanelKit";
import { StatusPill } from "@/components/shared/StatusPill";
import { ago } from "@/lib/time";
import {
  linkKindLabel,
  platformLabel,
  platformShort,
  statusPill,
  type GlobeArc,
  type GlobeNode,
} from "./model";

function FloatingCard({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <section
      aria-label={label}
      className="anim-pop-in absolute right-4 top-4 z-[6] w-[288px] max-w-[calc(100%-32px)] rounded-card border border-line bg-pill px-4 pb-4 pt-[14px] shadow-[var(--shadow-float)]"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute right-3 top-[13px] flex size-5 cursor-pointer items-center justify-center text-t3 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-t1"
      >
        <X aria-hidden="true" className="size-3.5" strokeWidth={2} />
      </button>
      {children}
    </section>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function healthLine(node: GlobeNode): string {
  switch (node.reason) {
    case "error":
      return `${plural(node.errorCount, "error")}${node.warnCount ? ` · ${plural(node.warnCount, "warning")}` : ""}`;
    case "warn":
      return plural(node.warnCount, "warning");
    case "draft":
      return `Draft in ${platformShort(node.provider)}`;
    case "inactive":
      return `Inactive in ${platformShort(node.provider)}`;
    case "not-captured":
      return "Rippit could not read it";
    case "removed":
      return `Removed in ${platformShort(node.provider)}`;
    default:
      return "Healthy";
  }
}

function lastRunLine(node: GlobeNode): string {
  if (node.provider !== "make") return "not available";
  const run = node.card?.lastRun;
  if (!run || !run.at) return "none yet";
  return `${run.status} · ${ago(run.at)}`;
}

function capturedLine(node: GlobeNode): string {
  const cap = node.card?.capture;
  if (!cap) return "—";
  switch (cap.state) {
    case "never-captured":
      return "never";
    case "failed":
      return `failed · ${ago(cap.attemptedAt ?? cap.at)}`;
    case "changed":
      return `changed · ${ago(cap.at)}`;
    default:
      return ago(cap.at);
  }
}

const BTN = "rounded-control px-3 text-[12.5px]";

export function NodePanel({ node, onClose }: { node: GlobeNode; onClose: () => void }) {
  const pill = statusPill(node);
  const shown = node.issues.slice(0, 3);
  const more = node.issues.length - shown.length;
  return (
    <FloatingCard label={`${node.name} details`} onClose={onClose}>
      <div className="mb-2 pr-6 text-[13px] font-semibold leading-[1.35] [overflow-wrap:anywhere]">{node.name}</div>
      <StatusPill pill={pill} />
      <div className="mt-2.5">
        <KvRow k="Platform" v={node.account ? `${platformLabel(node.provider)} · ${node.account}` : platformLabel(node.provider)} />
        <KvRow k="Health" v={healthLine(node)} />
        <KvRow k="Last run" v={lastRunLine(node)} />
        <KvRow k="Captured" v={capturedLine(node)} />
        <KvRow k="Links" v={String(node.degree)} />
      </div>
      {shown.length > 0 && (
        <div className="mt-3">
          <Section title="Issues">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {shown.map((issue, i) => (
                <li key={`${issue.code}-${issue.nodeId ?? i}`} className="flex items-start gap-2 text-[11.5px] leading-[1.4] text-t2">
                  <span
                    aria-hidden="true"
                    className="mt-[5px] size-[5px] flex-none rounded-full"
                    style={{ background: issue.severity === "error" ? "var(--err)" : "var(--warn)" }}
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{issue.message}</span>
                </li>
              ))}
              {more > 0 && <li className="font-mono text-[10.5px] text-t3">+{more} more</li>}
            </ul>
          </Section>
        </div>
      )}
      {node.captureIssues.length > 0 && (
        <p className="mt-2 text-[11px] leading-[1.4] text-t3">Capture: {node.captureIssues[0].message}</p>
      )}
      <div className="mt-3">
        <Button asChild size="sm" className={BTN}>
          <Link href={node.href}>Open workflow</Link>
        </Button>
      </div>
    </FloatingCard>
  );
}

export function ArcPanel({ arc, nodes, onClose }: { arc: GlobeArc; nodes: GlobeNode[]; onClose: () => void }) {
  const from = nodes[arc.a];
  const to = nodes[arc.b];
  const first = arc.links[0];
  const stepName = first?.from.stepName;
  return (
    <FloatingCard label={`Link from ${from.name} to ${to.name}`} onClose={onClose}>
      <div className="mb-2 pr-6">
        <div className="mb-0.5 font-mono text-[10.5px] text-t3">{linkKindLabel(arc.kind).toLowerCase()}</div>
        <div className="text-[13px] font-semibold leading-[1.4] [overflow-wrap:anywhere]">{from.name}</div>
        <div className="my-0.5 font-mono text-[10.5px] text-t3">↓ handoff</div>
        <div className="text-[13px] font-semibold leading-[1.4] [overflow-wrap:anywhere]">{to.name}</div>
      </div>
      <StatusPill pill={arc.dead ? { label: "Dead link", tone: "err" } : { label: "Linked", tone: "ok" }} />
      <div className="mt-2.5">
        <KvRow k="Kind" v={linkKindLabel(arc.kind)} />
        <KvRow k="From step" v={stepName || "—"} />
        <KvRow k="Link status" v={arc.dead ? "dead" : "ok"} />
        <KvRow k="Source last run" v={lastRunLine(from)} />
        {arc.links.length > 1 && <KvRow k="Links" v={String(arc.links.length)} />}
      </div>
      <div className="mt-3 flex gap-2">
        <Button asChild variant="outline" size="sm" className={BTN}>
          <Link href={from.href}>Open source</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className={BTN}>
          <Link href={to.href}>Open target</Link>
        </Button>
      </div>
    </FloatingCard>
  );
}

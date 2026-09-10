"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

/* Detail of one side-panel item, shown in the main area. */
export function DetailHeader({
  backHref,
  backLabel,
  leading,
  title,
  sub,
  openHref,
  openLabel = "Open in canvas",
  extra,
}: {
  backHref: string;
  backLabel: string;
  leading?: React.ReactNode;
  title: string;
  sub?: React.ReactNode;
  openHref?: string | null;
  openLabel?: string;
  extra?: React.ReactNode;
}) {
  return (
    <>
      <Link href={backHref} className="mb-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-t3 transition-colors hover:text-t1">
        <ArrowLeft aria-hidden="true" className="size-[11px]" /> {backLabel}
      </Link>
      <div className="mb-3.5 flex items-center gap-3">
        {leading}
        <span className="min-w-0 flex-1">
          <h2 className="m-0 [overflow-wrap:anywhere] text-[16px] font-bold tracking-[-0.01em]">{title}</h2>
          {sub && <p className="tabular m-0 mt-[2px] font-mono text-[10.5px] text-t3">{sub}</p>}
        </span>
        {extra}
        {openHref && (
          <Link href={openHref} className="inline-flex h-[26px] flex-none items-center gap-1 rounded-control bg-t1 px-2.5 text-[12px] font-semibold text-bg transition-opacity hover:opacity-90">
            <ArrowUpRight aria-hidden="true" className="size-[11px]" /> {openLabel}
          </Link>
        )}
      </div>
    </>
  );
}

export function DetailCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 overflow-hidden rounded-card border border-line bg-panel shadow-[var(--shadow-card)] anim-fade-up">
      {title && <h3 className="m-0 border-b border-line2 px-3.5 py-2 text-[11.5px] font-semibold text-t3">{title}</h3>}
      <div className="px-3.5 py-3">{children}</div>
    </section>
  );
}

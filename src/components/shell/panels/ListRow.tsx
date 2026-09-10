"use client";

import Link from "next/link";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ExpandToggle, useClamp } from "@/components/shared/ExpandableText";

/* One row of a side-panel list: icon/puck · title · sub · trailing; active
   state when it is the item shown on the right. Title and sub clamp to two
   lines; when either overflows an expand control sits beside the link. */
export function ListRow({
  href,
  active,
  icon: Icon,
  leading,
  title,
  sub,
  trailing,
  tone,
  unread,
}: {
  href: string;
  active?: boolean;
  icon?: LucideIcon;
  leading?: React.ReactNode;
  title: string;
  sub?: string;
  trailing?: React.ReactNode;
  tone?: "err" | "warn" | null;
  unread?: boolean;
}) {
  const color = tone === "err" ? "var(--err-text)" : tone === "warn" ? "var(--warn-text)" : "var(--t3)";
  const [expanded, setExpanded] = useState(false);
  const { attach: attachTitle, overflowing: titleOverflows, style: titleStyle } = useClamp(2, title, expanded);
  const { attach: attachSub, overflowing: subOverflows, style: subStyle } = useClamp(2, sub ?? "", expanded);
  const canExpand = titleOverflows || subOverflows;
  return (
    <div className="flex w-full items-start">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex min-w-0 flex-1 items-start gap-[7px] rounded-row px-1.5 py-[5px] text-left transition-[background] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover ${active ? "bg-hover" : ""}`}
      >
        {leading ?? (Icon ? (
          <span className="relative mt-px inline-flex size-[18px] flex-none items-center justify-center rounded-[5px] border border-line bg-hover" style={{ color }}>
            <Icon aria-hidden="true" className="size-[10px]" />
            {unread && <span aria-hidden="true" className="absolute -right-[2px] -top-[2px] size-[6px] rounded-full bg-warn" />}
          </span>
        ) : null)}
        <span className="min-w-0 flex-1">
          <span ref={attachTitle} style={titleStyle} className={`text-[11.5px] leading-[1.35] ${active || unread ? "font-semibold text-t1" : "text-t1"}`}>
            {title}
          </span>
          {sub && (
            <span ref={attachSub} style={subStyle} className="tabular font-mono text-[9px] leading-[1.4] text-t3">
              {sub}
            </span>
          )}
        </span>
        {trailing}
      </Link>
      {canExpand && <ExpandToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} label={`Show the full text of ${title}`} />}
    </div>
  );
}

export function PanelSection({ title, count, children }: { title: string; count?: number | string; children: React.ReactNode }) {
  return (
    <section className="mb-1.5" aria-label={title}>
      <p className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3">
        {title}
        {count !== undefined && <span className="tabular font-mono text-[9.5px] normal-case">{count}</span>}
      </p>
      {children}
    </section>
  );
}

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 py-1.5 text-[11px] italic text-t3">{children}</p>;
}

export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-1.5 px-1 py-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} aria-hidden="true" className="h-[26px] animate-pulse rounded-row bg-hover motion-reduce:animate-none" />
      ))}
    </div>
  );
}

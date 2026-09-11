/*
 * Settings / admin card kit — the handoff's Card, CardHeader and row.
 * Panel surface, 8px radius, hairline rows; nothing here carries colour.
 */

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-card border border-line bg-panel ${className}`}>{children}</div>;
}

/** Title + optional mono meta (a count) + optional right-side action. 44px tall. */
export function CardHeader({ title, meta, action }: { title: string; meta?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center gap-2.5 px-4 py-2.5">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {meta != null && meta !== "" && <span className="tabular font-mono text-[11px] text-t3">{meta}</span>}
      {action && <div className="ml-auto flex items-center gap-1.5">{action}</div>}
    </div>
  );
}

/** One hairline-divided row inside a Card. */
export function CardRow({ children, className = "", hover = false }: { children: React.ReactNode; className?: string; hover?: boolean }) {
  return (
    <div className={`flex items-center gap-3 border-t border-line2 px-4 py-[11px] ${hover ? "transition-colors duration-[var(--dur-fast)] hover:bg-hover" : ""} ${className}`}>
      {children}
    </div>
  );
}

/** A quiet section title above a group of cards. */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[13px] font-semibold text-t2">{children}</h2>;
}

import { LogoMark } from "@/components/shared/LogoMark";

/*
 * 52px header for the portal surfaces (settings, admin, invite): mark +
 * wordmark + mono crumb, optional badge; mono meta and any controls right.
 */
export function PortalHeader({
  crumb,
  badge,
  meta,
  children,
}: {
  crumb: string;
  badge?: React.ReactNode;
  meta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex h-[52px] flex-none items-center gap-3.5 border-b border-line bg-bg px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <LogoMark size={15} />
        <span className="text-[15px] font-extrabold tracking-[-0.02em]">orrit</span>
        <span className="font-mono text-[11px] text-t3">{crumb}</span>
        {badge}
      </div>
      <div className="flex-1" />
      {meta != null && meta !== "" && (
        <span className="min-w-0 truncate font-mono text-[11px] text-t3">{meta}</span>
      )}
      {children}
    </header>
  );
}

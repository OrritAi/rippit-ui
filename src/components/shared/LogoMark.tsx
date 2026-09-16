/** The orrit mark: a 45°-rotated rounded square with a centred dot. */
export function LogoMark({ size, className = "", style }: { size: number; className?: string; style?: React.CSSProperties }) {
  const radius = Math.max(4, Math.round(size * 0.27));
  const dot = Math.max(4, Math.round(size * 0.27));
  return (
    <div
      aria-hidden="true"
      className={`grid rotate-45 place-items-center bg-t1 ${className}`}
      style={{ width: size, height: size, borderRadius: radius, ...style }}
    >
      <div className="rounded-full bg-bg" style={{ width: dot, height: dot }} />
    </div>
  );
}

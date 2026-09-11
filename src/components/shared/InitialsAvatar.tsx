/** Circle with up to two initials — members lists. Sizes: 22 and 28. */
export function initialsOf(name: string | null | undefined): string {
  const base = (name ?? "").replace(/@.*$/, "").trim();
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || "?").slice(0, 2).toUpperCase();
}

export function InitialsAvatar({ name, size = 28, className = "" }: { name: string | null | undefined; size?: 22 | 28; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none place-items-center rounded-full border border-line bg-hover font-mono text-t2 ${className}`}
      style={{ width: size, height: size, fontSize: size === 22 ? 9 : 10.5 }}
    >
      {initialsOf(name)}
    </span>
  );
}

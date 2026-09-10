import { SoftwareLogo } from "@/components/shared/SoftwareLogo";
import { appColor, onColorGradient } from "@/lib/apps";

/*
 * App identity tile — the only chrome that carries colour. White glyph on
 * a darkened app-colour gradient (≥4.5:1 for every palette colour).
 */
export function AppPuck({
  app,
  size = 22,
  color,
  glyph,
  className = "",
  title,
  radius: radiusProp,
}: {
  app: string;
  size?: number;
  color?: string;
  glyph?: string;
  className?: string;
  title?: string;
  /** Corner radius override (default size × 0.3, min 4). */
  radius?: number;
}) {
  const col = color ?? appColor(app);
  const radius = radiusProp ?? Math.max(4, Math.round(size * 0.3));
  const font = Math.max(7, Math.round(size * 0.42));
  return (
    <span
      aria-hidden={title ? undefined : "true"}
      title={title}
      className={`inline-flex flex-none items-center justify-center border border-white/25 font-mono font-bold text-white ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: font,
        background: onColorGradient(col),
        boxShadow: size >= 30 ? `0 3px 0 color-mix(in oklab, ${col} 55%, #000), 0 6px 14px var(--ambient)` : undefined,
        textShadow: "0 1px 2px rgba(0,0,0,.3)",
      }}
    >
      {glyph ?? <SoftwareLogo app={app} size={Math.round(size * 0.6)} />}
    </span>
  );
}

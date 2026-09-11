import { SoftwareLogo } from "@/components/shared/SoftwareLogo";
import { appColor, onColorGradient } from "@/lib/apps";

/*
 * App identity tile — the only chrome that carries colour. White glyph on
 * a darkened app-colour gradient (≥4.5:1 for every palette colour).
 */
export type PuckStatus = "ok" | "warn" | "err" | "off";

const STATUS_LABEL: Record<PuckStatus, string> = { ok: "healthy", warn: "needs attention", err: "failing", off: "inactive" };

export function AppPuck({
  app,
  size = 22,
  color,
  glyph,
  className = "",
  title,
  radius: radiusProp,
  status,
}: {
  app: string;
  size?: number;
  color?: string;
  glyph?: string;
  className?: string;
  title?: string;
  /** Corner radius override (default size × 0.3, min 4). */
  radius?: number;
  /** Health dot on the bottom-right corner (connections lists). */
  status?: PuckStatus;
}) {
  const col = color ?? appColor(app);
  const radius = radiusProp ?? Math.max(4, Math.round(size * 0.3));
  const font = Math.max(7, Math.round(size * 0.42));
  const dot = Math.max(6, Math.round(size * 0.28));
  return (
    <span
      aria-hidden={title ? undefined : "true"}
      title={title}
      className={`relative inline-flex flex-none items-center justify-center border border-white/25 font-mono font-bold text-white ${className}`}
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
      {status && (
        <span
          aria-hidden="true"
          title={STATUS_LABEL[status]}
          className="absolute rounded-full border-[1.5px] border-bg"
          style={{ width: dot, height: dot, right: -Math.round(dot * 0.3), bottom: -Math.round(dot * 0.3), background: `var(--${status})` }}
        />
      )}
    </span>
  );
}

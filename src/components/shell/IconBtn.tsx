"use client";

import { forwardRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/*
 * Ghost icon button (rail / action bar / inspector): border brightens on
 * hover, filled when active. Always labelled — the label is the accessible
 * name and, unless `title` is null, a real tooltip (hover + keyboard focus)
 * rendered through the shared Radix tooltip. Sizes from the handoff: 26
 * (bars), 28 (default), 34 (rail).
 */
export interface IconBtnProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> {
  icon: LucideIcon;
  label: string;
  /** Tooltip text; defaults to the label. Pass null when the caller wraps the button in its own tooltip. */
  title?: string | null;
  /** Which side the tooltip opens on. */
  tipSide?: "top" | "bottom" | "left" | "right";
  size?: 22 | 26 | 28 | 34;
  active?: boolean;
  iconSize?: number;
}

export const IconBtn = forwardRef<HTMLButtonElement, IconBtnProps>(
  function IconBtn(
    { icon: Icon, label, size = 28, active, iconSize, className = "", style, title, tipSide = "bottom", ...rest },
    ref
  ) {
    const glyph = iconSize ?? (size >= 34 ? 15 : size <= 22 ? 12 : 13);
    const button = (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        className={`inline-flex flex-none cursor-pointer items-center justify-center rounded-control border transition-[border-color,background,color] duration-[var(--dur-fast)] ease-[var(--ease-out)] ${
          active
            ? "border-line-strong bg-hover text-t1"
            : "border-line text-t3 hover:border-line-strong hover:text-t1"
        } ${className}`}
        style={{ width: size, height: size, ...style }}
        {...rest}
      >
        <Icon aria-hidden="true" style={{ width: glyph, height: glyph }} strokeWidth={2} />
      </button>
    );
    if (title === null) return button;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side={tipSide} sideOffset={6}>
          {title ?? label}
        </TooltipContent>
      </Tooltip>
    );
  }
);

/** Tiny count/dot badge pinned to a button's corner. */
export function CornerBadge({
  value,
  tone = "t1",
  dot = false,
}: {
  value?: number | string | null;
  tone?: "t1" | "warn" | "err" | "ok" | "info";
  dot?: boolean;
}) {
  if (!dot && (value === null || value === undefined || value === 0 || value === "")) return null;
  const bg =
    tone === "warn" ? "var(--warn)" : tone === "err" ? "var(--err)" : tone === "ok" ? "var(--ok)" : tone === "info" ? "var(--chg)" : "var(--t1)";
  const fg = tone === "t1" ? "var(--bg)" : "#000";
  if (dot) {
    return (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-[2px] -top-[2px] size-[6px] rounded-full"
        style={{ background: bg }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -right-[4px] -top-[4px] inline-flex h-[13px] min-w-[13px] items-center justify-center rounded-full px-[3px] font-mono text-[9.5px] font-bold leading-none"
      style={{ background: bg, color: fg }}
    >
      {value}
    </span>
  );
}

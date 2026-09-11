"use client";

import type { Tag } from "@/app/lib/api";

/* Tags are the cross-platform overlay on top of platform folders: chips and
   filters, never a second tree (rippit-docs/product/tags.md). Colour is optional and
   only ever a tint — text stays on the text-role tokens for contrast. */

export function tagAccent(tag: Pick<Tag, "color">): string {
  return tag.color || "var(--t3)";
}

export function TagChip({
  tag,
  onRemove,
  active,
  onClick,
  size = "sm",
}: {
  tag: Tag;
  onRemove?: () => void;
  active?: boolean;
  onClick?: () => void;
  size?: "sm" | "xs";
}) {
  const accent = tagAccent(tag);
  const inner = (
    <>
      <span aria-hidden="true" className="size-[6px] flex-none rounded-full" style={{ background: accent }} />
      <span className="min-w-0 text-left [overflow-wrap:anywhere]">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove tag ${tag.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 text-t3 hover:text-t1"
        >
          ×
        </button>
      )}
    </>
  );
  const cls = `inline-flex max-w-[160px] items-center gap-1.5 rounded-full border px-2 ${
    size === "xs" ? "py-[1px] text-[10.5px]" : "py-[2px] text-[11px]"
  } font-semibold ${active ? "text-t1" : "text-t2"}`;
  const style = {
    borderColor: active ? accent : `color-mix(in srgb, ${accent} 45%, transparent)`,
    background: `color-mix(in srgb, ${accent} ${active ? "18%" : "8%"}, transparent)`,
  };
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className={cls} style={style}>
        {inner}
      </button>
    );
  }
  return (
    <span className={cls} style={style}>
      {inner}
    </span>
  );
}

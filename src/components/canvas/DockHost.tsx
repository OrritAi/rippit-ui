"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useEscape } from "@/components/shell/shell-context";

/*
 * The one right dock of a canvas view. Exactly one occupant at a time
 * (node inspector · info · changes · comments · runs · notes); the page
 * decides who. Non-modal dialog: the canvas stays interactive, focus moves
 * in on open and returns to the previously focused element on close; Esc
 * closes via the shell's escape layers (so dialogs/palette win first).
 * Under 720px it becomes a bottom sheet.
 *
 * `inline` renders the same dialog as a plain full-height column instead of
 * a floating card — for hosts that reserve a right slot for it (the workflow
 * map's 322px sidebar slot), where the slot itself animates open and closed.
 */
export function DockHost({
  label,
  width = 340,
  header,
  children,
  onClose,
  footer,
  dockKey,
  inline = false,
}: {
  label: string;
  width?: number;
  header: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  /** Changing the key re-runs the focus-in (new occupant). */
  dockKey: string;
  /** Fill a host-provided slot instead of floating over the canvas. */
  inline?: boolean;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      const el = restoreRef.current;
      if (el && document.contains(el)) el.focus({ preventScroll: true });
    };
  }, [dockKey]);

  useEscape(true, onClose);

  return (
    <aside
      role="dialog"
      aria-label={label}
      aria-describedby={titleId}
      className={
        inline
          ? "wm-slidein flex h-full flex-col overflow-hidden"
          : "anim-pop-in absolute bottom-[10px] right-[10px] top-[10px] z-[6] flex max-w-[calc(100%-20px)] flex-col overflow-hidden rounded-card border border-line bg-pill shadow-[var(--shadow-float)] max-[720px]:left-[10px] max-[720px]:top-auto max-[720px]:max-h-[62%] max-[720px]:w-auto"
      }
      style={{ width }}
    >
      <div id={titleId} className="flex flex-none items-center gap-2.5 border-b border-line2 px-3.5 pb-2.5 pt-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">{header}</div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={`Close ${label}`}
          className="flex size-[26px] flex-none cursor-pointer items-center justify-center rounded-control border border-line-strong text-t3 transition-colors duration-[var(--dur-fast)] hover:border-t1 hover:text-t1"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      <div className="thin-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      {footer && <div className="flex-none border-t border-line2 px-3.5 py-1.5 text-[11px] text-t3">{footer}</div>}
    </aside>
  );
}

/** Standard text header for tool docks. */
export function DockTitle({ title, subtitle, icon }: { title: string; subtitle?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <>
      {icon && <span className="flex-none text-t3">{icon}</span>}
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold leading-tight [overflow-wrap:anywhere]">{title}</span>
        {subtitle && <span className="tabular block font-mono text-[9.5px] text-t3 [overflow-wrap:anywhere]">{subtitle}</span>}
      </span>
    </>
  );
}

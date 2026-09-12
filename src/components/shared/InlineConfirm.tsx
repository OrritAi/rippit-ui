"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/*
 * The one way to confirm a destructive action: an inline strip in place of
 * the control that started it — mono question in the error tone, a
 * destructive confirm, a ghost cancel. Never a modal. Esc cancels while the
 * strip has focus; focus lands on Cancel so a stray Enter does nothing.
 */
export function InlineConfirm({
  question,
  confirmLabel,
  onConfirm,
  onCancel,
  size = "xs",
  busy = false,
  className = "",
}: {
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  size?: "xs" | "sm";
  busy?: boolean;
  className?: string;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };
  return (
    <div role="group" aria-label={question} className={`flex flex-none items-center gap-2 ${className}`}>
      <span className="font-mono text-[11px] text-err-text">{question}</span>
      <Button
        type="button"
        variant="destructive"
        size={size}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={onConfirm}
        onKeyDown={onKey}
        className="cursor-pointer rounded-control text-[12px] font-semibold dark:bg-destructive"
      >
        {confirmLabel}
      </Button>
      <Button
        ref={cancelRef}
        type="button"
        variant="ghost"
        size={size}
        disabled={busy}
        onClick={onCancel}
        onKeyDown={onKey}
        className="cursor-pointer rounded-control text-[12px] text-t2 hover:text-t1"
      >
        Cancel
      </Button>
    </div>
  );
}

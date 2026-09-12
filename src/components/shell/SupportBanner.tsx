"use client";

import { exitSupport } from "@/app/lib/api";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { Button } from "@/components/ui/button";

/** Shown above every view while platform staff view an organization read-only. */
export function SupportBanner() {
  const { support, current } = useWorkspace();
  if (!support) return null;
  const name = current?.name || support.name || "organization";
  return (
    <div
      role="status"
      className="flex flex-none items-center gap-3 border-b border-[color-mix(in_srgb,var(--warn)_32%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-4 py-1.5 text-[12.5px] text-warn-text"
    >
      <span className="min-w-0 truncate">
        Viewing as <span className="font-semibold">{name}</span> — read-only
      </span>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={exitSupport}
        className="ml-auto cursor-pointer rounded-control border-line-strong bg-transparent text-[11.5px] font-semibold text-t1 hover:bg-hover dark:bg-transparent dark:hover:bg-hover"
      >
        Exit
      </Button>
    </div>
  );
}

"use client";

import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { ST, WFS } from "./data";

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-px">
      <div className="text-[11px] text-t3">{label}</div>
      <div
        className="tabular text-[14px] font-semibold"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

export function MonitorHeader({
  incident,
  clientView,
  ops,
  errors,
  paused,
}: {
  incident: boolean;
  clientView: boolean;
  ops: number;
  errors: number;
  paused: boolean;
}) {
  const liveColor = paused ? "var(--warn)" : "var(--ok)";
  return (
    <header className="z-[5] flex items-center gap-3.5 border-b border-line bg-panel px-4 backdrop-blur-[14px]">
      {/* logo */}
      <div className="flex items-center gap-2.5">
        <div
          aria-hidden="true"
          className="flex size-5 rotate-45 items-center justify-center rounded-[6px] bg-t1"
        >
          <div className="size-1.5 rounded-full bg-bg" />
        </div>
        <div className="text-[17px] font-bold tracking-[-0.3px]">orrit</div>
        <div className="mt-px text-[12px] text-t3">Monitor</div>
      </div>

      <div className="h-[18px] w-px bg-line" aria-hidden="true" />

      {/* workflow switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Switch workflow — current: Lead Capture → Nurture (Production)"
          className="group flex cursor-pointer items-center gap-2"
        >
          <span className="text-[13.5px] font-semibold">
            Lead Capture → Nurture
          </span>
          <ChevronDown className="size-3 text-t3 transition-transform group-data-[state=open]:rotate-180" />
          <span className="rounded-[5px] border border-line bg-hover px-[7px] py-[2px] text-[11px] text-t2">
            Production
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="border-line bg-pill min-w-[220px]"
        >
          {WFS.map((w) => (
            <DropdownMenuItem key={w.name} className="gap-2 text-[13px]">
              <span
                aria-hidden="true"
                className="size-[7px] rounded-full"
                style={{
                  background: ST[w.st].dot,
                  boxShadow: `0 0 6px ${ST[w.st].dot}`,
                }}
              />
              <span className="sr-only">{ST[w.st].label} —</span>
              <span className="flex-1 font-medium">{w.name}</span>
              <span className="font-mono text-[10.5px] text-t3">{w.ops}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />

      {incident && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-[7px] rounded-full border border-[color-mix(in_srgb,var(--err)_35%,transparent)] bg-[color-mix(in_srgb,var(--err)_10%,transparent)] px-3 py-[5px]"
        >
          <div
            aria-hidden="true"
            className="size-1.5 rounded-full bg-err"
            style={{ animation: "blinkdot 1.2s infinite" }}
          />
          <div className="text-[12px] font-medium text-err-text">
            Incident — SMS Welcome failing · 47 errors / 30m
          </div>
        </motion.div>
      )}

      {clientView && (
        <div className="rounded-full border border-line bg-hover px-2.5 py-1 text-[11.5px] font-semibold">
          Client view
        </div>
      )}

      {/* stat chips */}
      <div className="flex items-center gap-4 px-1">
        <Stat label="Ops today" value={ops.toLocaleString("en-US")} />
        <div className="h-[22px] w-px bg-line2" />
        <Stat
          label="Errors"
          value={String(errors)}
          color={errors > 20 ? "var(--err-text)" : "var(--warn-text)"}
        />
        <div className="h-[22px] w-px bg-line2" />
        <Stat label="Avg run" value="6.4s" />
      </div>

      {/* live badge */}
      <div
        role="status"
        className="flex items-center gap-[7px] rounded-full border border-line bg-hover px-3 py-[5px]"
      >
        <div
          aria-hidden="true"
          className="size-[7px] rounded-full"
          style={{
            background: liveColor,
            boxShadow: `0 0 8px ${liveColor}`,
            animation: "blinkdot 1.6s infinite",
          }}
        />
        <div className="text-[12px] font-semibold text-t2">
          {paused ? "Paused" : "Live"}
        </div>
      </div>

      <ThemeToggle />

      <Button
        size="sm"
        className="h-auto cursor-pointer rounded-control px-3.5 py-[7px] text-[13px] font-semibold hover:opacity-85"
      >
        Share view
      </Button>
    </header>
  );
}

"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapTip } from "@/components/workflowMap/MapTip";
import { onColorGradient } from "@/lib/apps";
import { getConnector } from "@/lib/connectors";
import {
  flattenJson,
  fmtMs,
  ST,
  type MonitorNode,
  type NodeStatus,
} from "./data";

const EASE = [0.22, 1, 0.36, 1] as const;

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-panel px-4 py-2.5">
      <div className="text-[11px] text-t3">{label}</div>
      <div
        className="tabular mt-[3px] text-[16px] font-semibold"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

export function Inspector({
  node,
  status,
  incident,
  clientView,
  tab,
  onTab,
  ring,
}: {
  node: MonitorNode;
  status: NodeStatus;
  incident: boolean;
  clientView: boolean;
  tab: string;
  onTab: (t: string) => void;
  ring: string;
}) {
  const sc = ST[status];
  const [copied, setCopied] = useState(false);

  let payload = node.payload;
  if (node.id === "sms" && incident) {
    payload = {
      ...payload,
      status: "failed",
      retry: { attempt: 5, max: 5, next_in: "exhausted" },
    };
  }
  const payloadRows = flattenJson(payload);

  const runRows =
    node.runs ||
    [1, 2, 3, 4, 5].map((i) => ({
      c: "#22c55e",
      t: `#${(4392 - i * 3).toLocaleString("en-US")} · success`,
      dur: fmtMs(Math.round(node.ms * (0.85 + ((i * 37) % 10) / 30)) || 18),
      ago: ["1m", "5m", "11m", "18m", "24m"][i - 1],
    }));

  const thruBars = Array.from({ length: 20 }, (_, i) =>
    Math.round(8 + 24 * Math.abs(Math.sin(i * 1.1 + 2)))
  );

  const activeTab = clientView && tab === "config" ? "output" : tab;

  const copyPayload = () => {
    navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <motion.aside
      aria-label={`Inspector — ${node.name}`}
      initial={{ opacity: 0, x: 26 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.55, ease: EASE, delay: 0.12 }}
      className="absolute bottom-3 right-3 top-3 z-[3] flex w-[332px] flex-col overflow-hidden rounded-card border border-line bg-panel shadow-[0_12px_34px_var(--shade)] backdrop-blur-[14px]"
    >
      {/* header */}
      <div className="flex items-center gap-[11px] px-4 pb-3 pt-3.5">
        <div
          aria-hidden="true"
          className="flex size-[38px] flex-none items-center justify-center rounded-[11px] border border-white/25 font-mono text-[13px] font-bold text-white shadow-[0_4px_12px_var(--shade)]"
          style={{ background: onColorGradient(node.col) }}
        >
          {node.icon}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <h2 className="[overflow-wrap:anywhere] text-[15.5px] font-semibold">{node.name}</h2>
          <div className="text-[11.5px] text-t3">{node.sub}</div>
        </div>
        <div
          className="flex-none rounded-full border px-[9px] py-[3px] text-[11px] font-semibold"
          style={{ color: sc.color, background: sc.bg, borderColor: sc.border }}
        >
          {sc.label}
        </div>
      </div>

      {/* unhealthy banner */}
      <AnimatePresence initial={false}>
        {status !== "ok" && status !== "off" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className="mx-4 mb-3 rounded-control border px-3 py-[9px] text-[12px] leading-normal"
              style={{ background: sc.bg, borderColor: sc.border, color: sc.color }}
            >
              {status === "err"
                ? "✕ Failing — Twilio 429 rate limit · retries exhausted · 47 errors in last 30m"
                : "⟳ Rate limited by provider — retrying · attempt 3/5 · next in 42s"}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* metrics */}
      <div className="grid grid-cols-2 gap-px border-y border-line2 bg-line2">
        <Metric label="Avg run" value={node.m.avg} />
        <Metric label="p95" value={node.m.p95} />
        <Metric label="Ops today" value={node.m.ops} />
        <Metric
          label={clientView ? "Error rate" : "Est. cost"}
          value={clientView ? node.m.err : node.m.cost}
          color={clientView && status !== "ok" ? sc.color : undefined}
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={onTab}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList className="h-auto w-full justify-start rounded-none border-b border-line2 bg-transparent p-0 px-4">
          {(clientView
            ? ["output", "runs"]
            : ["output", "config", "runs"]
          ).map((id) => (
            <TabsTrigger
              key={id}
              value={id}
              className="flex-none cursor-pointer rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 py-2.5 text-[12.5px] font-semibold text-t3 capitalize shadow-none transition-colors hover:text-t1 data-[state=active]:bg-transparent data-[state=active]:text-t1 data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
              style={activeTab === id ? { borderBottomColor: ring } : undefined}
            >
              {id}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
          <TabsContent value="output" className="m-0">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11.5px] font-semibold text-t3">
                Output · run #4,391
              </div>
              <button
                onClick={copyPayload}
                aria-label={
                  copied ? "Copied to clipboard" : "Copy payload to clipboard"
                }
                className="flex cursor-pointer items-center gap-1 text-[11px] text-t3 transition-colors hover:text-t1"
              >
                <span aria-hidden="true">{copied ? "copied" : "copy"}</span>
                {copied ? (
                  <Check aria-hidden="true" className="size-2.5" />
                ) : (
                  <Copy aria-hidden="true" className="size-2.5" />
                )}
              </button>
            </div>
            <div className="rounded-code border border-line2 bg-code px-3.5 py-3 font-mono text-[12px] leading-[1.75]">
              <div style={{ color: "var(--jpunc)" }}>{"{"}</div>
              {payloadRows.map((r, i) => (
                <div
                  key={i}
                  className="[overflow-wrap:anywhere]"
                  style={{ paddingLeft: r.pad }}
                >
                  <span style={{ color: "var(--jkey)" }}>{r.k}</span>
                  <span style={{ color: "var(--jpunc)" }}>{r.sep}</span>
                  <span style={{ color: r.c }}>{r.v}</span>
                </div>
              ))}
              <div style={{ color: "var(--jpunc)" }}>{"}"}</div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="text-[11.5px] font-semibold text-t3">
                Throughput · 1h
              </div>
              <div className="h-px flex-1 bg-line2" />
            </div>
            <div
              role="img"
              aria-label={`Throughput over the last hour: ${node.m.ops} operations, steady`}
              className="mt-2.5 flex h-[34px] items-end gap-[3px]"
            >
              {thruBars.map((h, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className="flex-1 rounded-t-[2px] transition-[filter] hover:brightness-150"
                  style={{ height: h, background: "var(--barc)" }}
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="config" className="m-0">
            <div className="mb-2 text-[11.5px] font-semibold text-t3">
              Module config
            </div>
            <div className="flex flex-col">
              {node.config.map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-3 border-b border-line2 px-0.5 py-[9px]"
                >
                  <div className="text-[12px] text-t3">{k}</div>
                  <div className="text-right font-mono text-[11.5px]">{v}</div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="runs" className="m-0">
            <div className="mb-1.5 text-[11.5px] font-semibold text-t3">
              Recent runs
            </div>
            <div className="flex flex-col">
              {runRows.map((run, i) => (
                <div
                  key={i}
                  className="flex items-center gap-[9px] border-b border-line2 px-0.5 py-2 transition-colors hover:bg-hover"
                >
                  <div
                    className="size-1.5 flex-none rounded-full"
                    style={{ background: run.c, boxShadow: `0 0 6px ${run.c}` }}
                  />
                  <div className="flex-1 font-mono text-[11.5px] text-t2">
                    {run.t}
                  </div>
                  <div className="font-mono text-[11px] text-t3">{run.dur}</div>
                  <div className="w-11 text-right text-[11px] text-t3">
                    {run.ago}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </div>
      </Tabs>

      {/* footer — this surface is fixture data: the replay control is
          disabled and says so, so it can never read as an action on a real
          run (replay lives on a workflow's Runs tool and only ever reads). */}
      <div className="flex gap-2 border-t border-line2 px-4 py-3">
        <MapTip label="Sample data — replay works on real Make runs from a workflow's Runs tool">
          <Button
            aria-disabled="true"
            aria-label="Replay on map (preview) — sample data, not available here"
            onClick={(e) => e.preventDefault()}
            className="h-auto flex-1 cursor-not-allowed rounded-control py-[9px] text-[13px] font-semibold opacity-55 hover:opacity-55"
          >
            Replay on map (preview)
          </Button>
        </MapTip>
        <Button
          variant="outline"
          className="h-auto flex-1 cursor-pointer rounded-control border-line bg-transparent py-[9px] text-[13px] font-semibold text-t2 hover:border-t1 hover:bg-transparent hover:text-t1"
        >
          Open in {getConnector(node.provider ?? "make").label}
          <ArrowUpRight aria-hidden="true" className="size-3" />
        </Button>
      </div>
    </motion.aside>
  );
}

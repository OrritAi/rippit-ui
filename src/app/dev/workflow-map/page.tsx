import { readFile } from "node:fs/promises";
import { notFound } from "next/navigation";
import type { MapSnapshot } from "@/components/workflowMap/WorkflowMapPreview";
import { ShellProvider } from "@/components/shell/shell-context";
import { WorkflowMapPreview } from "@/components/workflowMap/WorkflowMapPreview";

/*
 * /dev/workflow-map — the same fixture render as /w/preview, but outside the
 * signed-in app shell so a headless browser can drive it for geometry and
 * screenshot checks without a session. 404 in production. `?big=1` renders
 * 300 callers; `?run=1` replays the fixture trace (run overlay).
 */
export default async function WorkflowMapDevPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const big = params.big === "1" || params.big === "true";
  const tall = Math.min(60, Math.max(0, Number(params.tall) || 0));
  const run = params.run === "1" || params.run === "true";
  // `?snapshot=<name>` loads a real workflow exported from the local DB into
  // the scratchpad (see the session notes) — dev only, never a network read.
  let snapshot: MapSnapshot | null = null;
  const name = typeof params.snapshot === "string" ? params.snapshot.replace(/[^a-z0-9-]/gi, "") : "";
  if (name) {
    const dir = process.env.RIPPIT_MAP_SNAPSHOT_DIR || "/private/tmp/claude-501/-Users-stevens34-Desktop-Rippit/72e68cc0-5a88-43a7-820c-71276bd7c1d8/scratchpad/snapshots";
    try {
      snapshot = JSON.parse(await readFile(`${dir}/${name}.json`, "utf8")) as MapSnapshot;
    } catch {
      notFound();
    }
  }
  return (
    <ShellProvider>
      <div className="h-screen w-screen overflow-hidden bg-bg text-t1">
        <WorkflowMapPreview big={big} tall={tall} snapshot={snapshot} run={run} />
      </div>
    </ShellProvider>
  );
}

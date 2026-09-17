import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { notFound } from "next/navigation";
import type { MapSnapshot } from "@/components/workflowMap/WorkflowMapPreview";
import { ShellProvider } from "@/components/shell/shell-context";
import { WorkflowMapPreview } from "@/components/workflowMap/WorkflowMapPreview";

/*
 * /dev/workflow-map — the same fixture render as /w/preview, but outside the
 * signed-in app shell so a headless browser can drive it for geometry and
 * screenshot checks without a session. 404 in production. `?big=1` renders
 * 300 callers; `?run=1` replays the fixture trace (run overlay); `?shapes=1`
 * renders the 119-step GoHighLevel workflow with its repetition collapsed.
 */
export default async function WorkflowMapDevPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const big = params.big === "1" || params.big === "true";
  const tall = Math.min(60, Math.max(0, Number(params.tall) || 0));
  const run = params.run === "1" || params.run === "true";
  const shapes = params.shapes === "1" || params.shapes === "true";
  // `?snapshot=<name>` loads a real workflow exported from the local DB into
  // the scratchpad (see the session notes) — dev only, never a network read.
  let snapshot: MapSnapshot | null = null;
  const name = typeof params.snapshot === "string" ? params.snapshot.replace(/[^a-z0-9-]/gi, "") : "";
  if (name) {
    /* Default to a stable location rather than a session scratchpad: the old
       default pointed at a directory from a long-finished session, so every
       snapshot 404'd and the geometry sweep was silently fixture-only. */
    const dir = process.env.RIPPIT_MAP_SNAPSHOT_DIR || `${homedir()}/.orrit/snapshots`;
    try {
      snapshot = JSON.parse(await readFile(`${dir}/${name}.json`, "utf8")) as MapSnapshot;
    } catch {
      notFound();
    }
    /* A sibling `<name>.shapes.json` is the exported `GET …/shapes` body, so
       a snapshot can exercise the served fold plan without re-exporting the
       snapshot itself. Absent is fine and means the graph fallback. */
    if (snapshot && !snapshot.shapes) {
      try {
        snapshot = { ...snapshot, shapes: JSON.parse(await readFile(`${dir}/${name}.shapes.json`, "utf8")) };
      } catch {
        /* no shapes exported for this snapshot */
      }
    }
  }
  return (
    <ShellProvider>
      <div className="h-screen w-screen overflow-hidden bg-bg text-t1">
        <WorkflowMapPreview big={big} tall={tall} snapshot={snapshot} run={run} shapes={shapes} />
      </div>
    </ShellProvider>
  );
}

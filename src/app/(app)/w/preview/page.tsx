import { notFound } from "next/navigation";
import { WorkflowMapPreview } from "@/components/workflowMap/WorkflowMapPreview";

/*
 * /w/preview — development-only render of the design handoff's demo data
 * ("Workflow Map v7.dc.html") through the real WorkflowMap, so it can be
 * A/B'd against the prototype at the same viewport. `?big=1` renders 300
 * callers to exercise LITE and root windowing; `?shapes=1` renders the
 * 119-step GoHighLevel workflow whose nine-outcome router is what repetition
 * collapse is for. 404 in production.
 */
export default async function WorkflowMapPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const big = params.big === "1" || params.big === "true";
  const shapes = params.shapes === "1" || params.shapes === "true";
  return <WorkflowMapPreview big={big} shapes={shapes} />;
}

import { notFound } from "next/navigation";
import { WorkflowMapPreview } from "@/components/workflowMap/WorkflowMapPreview";

/*
 * /w/preview — development-only render of the design handoff's demo data
 * ("Workflow Map v7.dc.html") through the real WorkflowMap, so it can be
 * A/B'd against the prototype at the same viewport. `?big=1` renders 300
 * callers to exercise LITE and root windowing. 404 in production.
 */
export default async function WorkflowMapPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const big = params.big === "1" || params.big === "true";
  return <WorkflowMapPreview big={big} />;
}

"use client";

import type { DetailSectionsProps, NodeDescription } from "@/lib/connectors/types";
import { CopyJsonButton, JsonBlock, KvRow, Section } from "@/components/shared/DetailPanelKit";
import type { AssetRef } from "@/app/lib/api";

/* ClickFunnels 2.0 node detail (from GET /workflows/clickfunnels/{id}/nodes/{nodeId}):
   steps    {id, nodeId, kind: "step", type: step_type, name, state, attributes, labels}
   triggers {id, nodeId, kind: "trigger", type: event_type_key, name, active, attributes, filters, labels}
   `labels` is {settings key: {id: resolved name}} — names the connector looked
   up in the workspace catalog at capture time. */
export type CfNode = Record<string, unknown>;

function isTrigger(node: CfNode): boolean {
  return node.kind === "trigger";
}

function humanType(type: string): string {
  return type.replace(/^\$/, "").replace(/_step$/, "").replace(/[._]/g, " ");
}

export function describeCfNode(data: unknown): NodeDescription {
  const node = data as CfNode;
  const type = String(node.type ?? "step");
  return {
    title: String(node.name || humanType(type)),
    app: "clickfunnels",
    kindLabel: isTrigger(node) ? "trigger" : humanType(type),
    summary: (node.summary as string | undefined) ?? null,
    ordinal: (node.ordinal as string | null | undefined) ?? null,
    waitText: (node.waitFor as { text: string } | null | undefined)?.text ?? null,
    assets: node.assets as AssetRef[] | undefined,
    filterName: (node.filterName as string | null | undefined) ?? null,
  };
}

function LabelChips({ labels }: { labels: Record<string, Record<string, string>> }) {
  const entries = Object.entries(labels).flatMap(([key, table]) =>
    Object.entries(table).map(([id, name]) => ({ key, id, name }))
  );
  if (entries.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {entries.map((e) => (
        <span
          key={`${e.key}:${e.id}`}
          title={`${e.key.replace(/_/g, " ")} #${e.id}`}
          className="rounded-full border border-line bg-pill px-2.5 py-[3px] text-[11px] font-semibold text-t2"
        >
          {e.name}
        </span>
      ))}
    </div>
  );
}

export default function CfStepDetailSections({ data }: DetailSectionsProps) {
  const node = data as CfNode | null;
  if (!node) return null;
  const type = String(node.type ?? "step");
  const attributes = (node.attributes as Record<string, unknown> | undefined) ?? {};
  const labels = (node.labels as Record<string, Record<string, string>> | undefined) ?? {};
  const filters = node.filters as Record<string, unknown> | undefined;
  const webhookUrl = type === "deliver_webhook_step" ? (attributes.url as string | undefined) : undefined;
  const branches = attributes.branches as { name: string; steps: number }[] | undefined;
  const variants = attributes.variants as { name: string; weight?: number; steps: number }[] | undefined;

  return (
    <>
      <Section title={isTrigger(node) ? "Trigger identity" : "Step identity"}>
        <div className="flex flex-col">
          <KvRow k="ID" v={<span className="break-all">{String(node.id)}</span>} />
          <KvRow k="Type" v={<span className="break-all">{type}</span>} />
          {"state" in node && node.state != null && <KvRow k="State" v={String(node.state)} />}
          {"active" in node && node.active != null && <KvRow k="Active" v={String(node.active)} />}
        </div>
      </Section>

      {webhookUrl && (
        <Section title="Webhook target">
          <div className="break-all rounded-code border border-line2 bg-code px-3.5 py-3 font-mono text-[12px] leading-[1.6] text-t1">
            <span className="mr-2 inline-flex rounded-full border border-[color-mix(in_srgb,var(--warn)_32%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-[7px] py-[1px] text-[10.5px] font-semibold text-warn-text">
              POST
            </span>
            {webhookUrl}
          </div>
          {typeof attributes.endpoint_name === "string" && (
            <p className="mt-1.5 text-[11.5px] text-t3">Endpoint “{attributes.endpoint_name}” in ClickFunnels</p>
          )}
        </Section>
      )}

      {Array.isArray(branches) && branches.length > 0 && (
        <Section title="Branches">
          <div className="flex flex-wrap gap-1.5">
            {branches.map((b, i) => (
              <span key={i} className="rounded-full border border-line bg-pill px-2.5 py-[3px] text-[11px] font-semibold text-t2">
                {b.name} · {b.steps} step{b.steps === 1 ? "" : "s"}
              </span>
            ))}
          </div>
        </Section>
      )}

      {Array.isArray(variants) && variants.length > 0 && (
        <Section title="Variants">
          <div className="flex flex-wrap gap-1.5">
            {variants.map((v, i) => (
              <span key={i} className="rounded-full border border-line bg-pill px-2.5 py-[3px] text-[11px] font-semibold text-t2">
                {v.name} · {v.steps} step{v.steps === 1 ? "" : "s"}
              </span>
            ))}
          </div>
        </Section>
      )}

      {Object.keys(labels).length > 0 && (
        <Section title="References">
          <LabelChips labels={labels} />
        </Section>
      )}

      {filters && Object.keys(filters).length > 0 && (
        <Section title="Trigger scope">
          <JsonBlock data={filters} />
        </Section>
      )}

      {Object.keys(attributes).length > 0 && (
        <Section title="Settings" action={<CopyJsonButton data={node} />}>
          <JsonBlock data={attributes} />
        </Section>
      )}
    </>
  );
}

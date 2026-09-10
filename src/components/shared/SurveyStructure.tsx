"use client";

import { Section } from "@/components/shared/DetailPanelKit";
import type { SurveyStructure } from "@/app/lib/api";

/*
 * Survey structure — the slides, questions and per-option branching pulled in
 * from GHL. The disqualify / skip logic is the "why" behind a funnel's
 * qualified/disqualified split; here it reads in plain language rather than as
 * builder config.
 */
export function SurveyStructureView({ structure }: { structure: SurveyStructure }) {
  const title = structure.name ? `Survey · ${structure.name}` : "Survey structure";

  if (!structure.parsed) {
    return (
      <Section title={title}>
        <p className="text-[12px] leading-[1.5] text-t3">
          This survey’s structure was captured but isn’t readable yet — the raw definition is
          stored and will render once its shape is confirmed on the next sync.
        </p>
      </Section>
    );
  }

  const disq = structure.slides.reduce((n, s) => n + s.questions.filter((q) => q.disqualifies).length, 0);
  const plural = (n: number, w: string) => `${n} ${w}${n !== 1 ? "s" : ""}`;

  return (
    <Section title={title}>
      <p className="mb-2 text-[11px] text-t3">
        {plural(structure.slides.length, "slide")} · {plural(structure.questionCount, "question")}
        {disq > 0 ? ` · ${plural(disq, "disqualifying answer")}` : ""}
      </p>
      <ol className="flex flex-col gap-2">
        {structure.slides.map((slide) => (
          <li key={slide.id} className="rounded-control border border-line2 p-2.5">
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-t3">{slide.title}</p>
            <ul className="flex flex-col gap-2">
              {slide.questions.map((q) => (
                <li key={q.id}>
                  <p className="text-[12.5px] font-medium leading-snug text-t1">
                    {q.label}
                    {q.required && <span className="ml-1 align-middle text-[10px] font-normal text-t3">required</span>}
                  </p>
                  {q.options.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-1">
                      {q.options.map((opt, i) => (
                        <li key={i} className="flex items-center gap-2 text-[12px] text-t2">
                          <span aria-hidden="true" className="size-1 flex-none rounded-full bg-t3" />
                          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{opt.label}</span>
                          {opt.logic && <LogicBadge action={opt.logic.action} target={opt.logic.target} />}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function LogicBadge({ action, target }: { action: string; target?: string }) {
  const disqualify = action === "disqualify";
  return (
    <span
      className="flex-none rounded-full border px-1.5 py-[1px] text-[10px] font-semibold"
      style={
        disqualify
          ? {
              color: "var(--err-text)",
              borderColor: "color-mix(in srgb, var(--err) 40%, transparent)",
              background: "color-mix(in srgb, var(--err) 8%, transparent)",
            }
          : { color: "var(--t2)", borderColor: "var(--line)" }
      }
    >
      {disqualify ? "Disqualifies" : target ? `→ ${target}` : "Skips ahead"}
    </span>
  );
}

import { notFound } from "next/navigation";
import { MartechPreview } from "@/components/martech/MartechPreview";

/*
 * /martech/preview — development-only render of the Creator Protocol
 * fixture, so the canvas, inspector and every thumbnail state can be
 * reviewed without an account. `?big=1` multiplies the automations past
 * LITE_AT to exercise the lite rendering path. 404 in production.
 */
export default async function MartechPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const big = params.big === "1" || params.big === "true";
  return <MartechPreview big={big} />;
}

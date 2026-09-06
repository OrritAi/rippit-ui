"use client";

import { useState } from "react";
import { appGlyph } from "@/lib/apps";

const LOGOS: Record<string, string> = {
  make: "make", meta: "meta", facebook: "meta", "facebook-conversions-api": "meta",
  "google-sheets": "googlesheets", "googleads": "googleads", "google-ads": "googleads",
  "google-calendar": "googlecalendar", "google-forms": "googleforms", gmail: "gmail", "google-email": "gmail",
};

/**
 * Local brand mark, with a monogram fallback that survives a missing file.
 *
 * `<img>` + onError, not a CSS mask: a mask silently no-ops when its SVG 404s
 * and paints a solid square, so a mark that failed to load looked worse than
 * no mark at all. The image also keeps each brand's own colours rather than
 * flattening them to a single fill. Unknown apps go straight to the monogram.
 */
export function SoftwareLogo({ app, fallback, size = 22 }: { app: string; fallback?: string; size?: number }) {
  const key = app.toLowerCase().split(":")[0].replace(/\d+$/, "");
  const name = LOGOS[key];
  const [broken, setBroken] = useState(false);
  if (!name || broken) return <>{fallback ?? appGlyph(app)}</>;
  return (
    <img  // eslint-disable-line @next/next/no-img-element -- local static SVG
      src={`/software/${name}.svg`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className="inline-block flex-none object-contain"
      onError={() => setBroken(true)}
    />
  );
}

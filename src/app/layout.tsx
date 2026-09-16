import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/app/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Orrit",
    template: "%s — Orrit",
  },
  description: "Real-time monitoring for cross-tool automation workflows",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:border focus:border-line-strong focus:bg-panel focus:px-3 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-t1"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

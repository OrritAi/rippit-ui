"use client";

import { ThemeProvider, useTheme } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MotionConfig } from "framer-motion";
import { AuthProvider } from "./AuthProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      value={{ light: "light", dark: "dark" }}
      disableTransitionOnChange
    >
      <AuthProvider>
        <TooltipProvider delayDuration={250} skipDelayDuration={400}>
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </TooltipProvider>
        <ThemedToaster />
      </AuthProvider>
    </ThemeProvider>
  );
}

/*
 * One toaster for the app, following the active theme. Sync progress uses
 * `toast.promise` (loading → done / failed) so feedback never needs a row of
 * chrome on the page itself. Styled with the shell's tokens, not sonner's.
 */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-center"
      offset={20}
      gap={8}
      duration={3200}
      closeButton={false}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[340px] items-center gap-2.5 rounded-card border border-line bg-panel px-3.5 py-3 text-[12.5px] text-t1 shadow-[var(--shadow-float)] backdrop-blur-[14px]",
          title: "font-semibold leading-tight",
          description: "font-mono text-[10.5px] text-t3",
          icon: "flex-none text-t2 [&_svg]:size-4",
          loader: "flex-none text-t2",
          success: "[&_[data-icon]]:text-ok-text",
          error: "[&_[data-icon]]:text-err-text",
          warning: "[&_[data-icon]]:text-warn-text",
          actionButton: "ml-auto rounded-control border border-line px-2 py-1 text-[11px] font-semibold text-t1 hover:bg-hover",
        },
      }}
    />
  );
}

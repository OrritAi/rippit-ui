"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/app/AuthProvider";
import { BOOT_HOME_PATH, BOOT_LINES, BootProvider, useBoot } from "@/components/app/BootProvider";
import { ConnectionsProvider } from "@/components/app/ConnectionsProvider";
import { WorkspaceProvider, useWorkspace } from "@/components/app/WorkspaceProvider";
import { PaletteProvider } from "@/components/palette/palette-context";
import { TagsProvider } from "@/components/tags/tags-context";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { ShellProvider } from "@/components/shell/shell-context";
import { Shell } from "@/components/shell/Shell";

/*
 * Auth gate (UX only — enforcement lives in the API): signed out → /login.
 * Once signed in, the app is fully enterable; pages render their own
 * "connect a platform" empty states pointing at Settings → Connections.
 *
 * The boot screen covers every stage of a landing — session, workspace and,
 * on the home page, the globe's estate — so no stage renders a spinner.
 * BootProvider says who lifts it and when.
 */
export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <BootProvider>
      <SessionGate>{children}</SessionGate>
    </BootProvider>
  );
}

function SessionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  // Resolving, or on the way to /login: the boot screen is all there is.
  if (loading || !session || !user) return null;

  return (
    <WorkspaceProvider key={user.id}>
      <WorkspaceScopedShell>{children}</WorkspaceScopedShell>
    </WorkspaceProvider>
  );
}

/* Everything that holds workspace-scoped data remounts when the active
   workspace changes (key on its id). */
function WorkspaceScopedShell({ children }: { children: React.ReactNode }) {
  const { current, loading, error } = useWorkspace();
  const pathname = usePathname();
  const { setLine, release } = useBoot();
  const pending = loading && !current;
  const failed = !current && !!error;
  const ready = !!current;

  useEffect(() => {
    if (pending) setLine(BOOT_LINES.workspace);
  }, [pending, setLine]);
  // The home page hands the cover to the globe, which lifts it once the
  // estate is drawn; everywhere else it lifts as soon as the shell is up —
  // and on failure, or the message would never be seen.
  useEffect(() => {
    if (failed || (ready && pathname !== BOOT_HOME_PATH)) release();
  }, [failed, ready, pathname, release]);

  if (pending) return null;
  if (failed) {
    return (
      <div className="flex h-svh items-center justify-center bg-bg p-4 text-[13px] text-t2">
        Could not load your workspace: {error}
      </div>
    );
  }

  return (
    <ConnectionsProvider key={current?.id ?? "none"}>
      <TagsProvider>
        <PaletteProvider>
          <ShellProvider>
            <Shell>{children}</Shell>
            <CommandPalette />
          </ShellProvider>
        </PaletteProvider>
      </TagsProvider>
    </ConnectionsProvider>
  );
}

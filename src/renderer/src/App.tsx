/**
 * The auth gate and the window shell: sidebar, topbar and the routed page
 * (docs/ux/overview.md#window-layout). Signed-out sessions get the sign-in
 * steps (docs/ux/sign-in.md), which stay up after the code checks until they
 * have opened the last used network (else the first), then hand over to the
 * dashboard. The shell also hosts the write kit's toasts and confirm dialog
 * (app/useWrite.ts) and the floating theme editor.
 */
import { useEffect, useState } from "react";

import { LiveCollector } from "~/app/LiveCollector";
import { RouterOutlet, useNavigationShortcuts } from "~/app/router";
import { followHostEvents, onSessionEnded, useQuery } from "~/app/useCommand";
import { ConfirmHost } from "~/components/ui/confirm";
import { Toaster } from "~/components/ui/toast";
import { DevToolsPanel } from "~/features/devtools/DevToolsPanel";
import { useDevToolsOpen, useDevToolsShortcut } from "~/features/devtools/devtools";
import { CommandPalette } from "~/features/palette/CommandPalette";
import { errorCode } from "~/features/sign-in/errorCode";
import { SignInView } from "~/features/sign-in/SignInView";
import { Sidebar } from "~/features/shell/Sidebar";
import { TopBar, TopBarProvider } from "~/features/shell/TopBar";
import { ThemeEditorHost } from "~/features/themeEditor/ThemeEditorHost";
import type { AuthStatus } from "../../core/model";

/**
 * The whole window: the app (sign-in or the shell) above, and the F12 dev
 * tools panel docked across the bottom while it is open
 * (docs/architecture/devtools.md).
 */
export function App() {
  useDevToolsShortcut();
  const devtools = useDevToolsOpen();
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <AppContent />
      </div>
      {devtools && <DevToolsPanel />}
    </div>
  );
}

function AppContent() {
  const auth = useQuery<AuthStatus>("auth.status");
  /** Set when the session ends in this run; `expired` is false for the user's own sign-out. */
  const [sessionEnded, setSessionEnded] = useState<{ expired: boolean; code: string | null } | null>(null);
  /** Set while the sign-in steps are up; `expired` when the session ended in this run. */
  const [signIn, setSignIn] = useState<{ expired: boolean } | null>(null);

  useEffect(() => {
    // The host's signed_out event can land before the failed command's answer, so a later code fills in.
    const offSession = onSessionEnded((expired, error) => {
      const code = error ? errorCode(error) : null;
      setSessionEnded((s) => (s ? (s.code || !code ? s : { ...s, code }) : { expired, code }));
    });
    const offHost = followHostEvents();
    return () => {
      offSession();
      offHost();
    };
  }, []);

  const signedOut = sessionEnded !== null || auth.data?.signedIn === false;
  useEffect(() => {
    if (signedOut) setSignIn((s) => s ?? { expired: sessionEnded?.expired ?? false });
  }, [signedOut, sessionEnded]);

  // Wait for the first answer so a signed-out start does not flash the shell.
  if (auth.data === undefined && auth.error === null) {
    return <div className="drag-region h-full bg-background" />;
  }
  // If auth.status itself fails (no engine), the shell shows with its missing states.
  if (signIn || signedOut) {
    return (
      <SignInView
        expired={signIn?.expired ?? sessionEnded?.expired ?? false}
        endedCode={sessionEnded?.code ?? null}
        onDone={() => {
          // Wait for a fresh auth.status, so a stale "signed out" cannot reopen sign-in.
          void auth.refetch().then(() => {
            setSessionEnded(null);
            setSignIn(null);
          });
        }}
      />
    );
  }
  return <Shell />;
}

function Shell() {
  useNavigationShortcuts();
  return (
    <div className="flex h-full">
      <Sidebar />
      <TopBarProvider>
        {/* The flat canvas, as T3 Code's page columns paint over its SidebarInset (index.css, Surface grain). */}
        <main className="flex min-w-0 flex-1 flex-col bg-background">
          <TopBar />
          <RouterOutlet />
          {/* Live rates on every page while Live is on. */}
          <LiveCollector />
        </main>
      </TopBarProvider>
      <CommandPalette />
      <ThemeEditorHost />
      <Toaster />
      <ConfirmHost />
    </div>
  );
}

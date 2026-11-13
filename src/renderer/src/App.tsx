/**
 * The auth gate and the window shell: sidebar, topbar and the routed page
 * (docs/ux/overview.md#window-layout). Signed-out sessions get the sign-in
 * steps (docs/ux/sign-in.md), which stay up after the code checks until they
 * have opened the last used network (else the first), then hand over to the
 * dashboard.
 */
import { useEffect, useState } from "react";

import { RouterOutlet, useNavigationShortcuts } from "~/app/router";
import { followHostEvents, onSessionEnded, useQuery } from "~/app/useCommand";
import { CommandPalette } from "~/features/palette/CommandPalette";
import { SignInView } from "~/features/sign-in/SignInView";
import { Sidebar } from "~/features/shell/Sidebar";
import { TopBar, TopBarProvider } from "~/features/shell/TopBar";
import type { AuthStatus } from "../../core/model";

export function App() {
  const auth = useQuery<AuthStatus>("auth.status");
  /** Set when the session ends in this run; `expired` is false for the user's own sign-out. */
  const [sessionEnded, setSessionEnded] = useState<{ expired: boolean } | null>(null);
  /** Set while the sign-in steps are up; `expired` when the session ended in this run. */
  const [signIn, setSignIn] = useState<{ expired: boolean } | null>(null);

  useEffect(() => {
    const offSession = onSessionEnded((expired) => setSessionEnded((s) => s ?? { expired }));
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
        <main className="flex min-w-0 flex-1 flex-col bg-background">
          <TopBar />
          <RouterOutlet />
        </main>
      </TopBarProvider>
      <CommandPalette />
    </div>
  );
}

/**
 * The auth gate and the window shell: sidebar, topbar and the routed page
 * (docs/ux/overview.md#window-layout). Signed-out sessions get the sign-in
 * screen; it is a placeholder until the sign-in story (M1.9) lands.
 */
import { LogIn } from "lucide-react";
import { useEffect, useState } from "react";

import { RouterOutlet, useNavigationShortcuts } from "~/app/router";
import { followHostEvents, invalidate, onSessionEnded, useQuery } from "~/app/useCommand";
import { Card, Empty } from "~/components/ui/card";
import { PageHeader } from "~/components/ui/hero";
import { Status } from "~/components/ui/status";
import { Sidebar } from "~/features/shell/Sidebar";
import { TopBar, TopBarProvider } from "~/features/shell/TopBar";
import type { AuthStatus } from "../../core/model";

export function App() {
  const auth = useQuery<AuthStatus>("auth.status");
  const [sessionEnded, setSessionEnded] = useState(false);

  useEffect(() => {
    const offSession = onSessionEnded(() => setSessionEnded(true));
    const offHost = followHostEvents();
    return () => {
      offSession();
      offHost();
    };
  }, []);

  // A fresh auth.status that says signed in clears an ended session.
  useEffect(() => {
    if (auth.data?.signedIn) setSessionEnded(false);
  }, [auth.data]);

  // Wait for the first answer so a signed-out start does not flash the shell.
  if (auth.data === undefined && auth.error === null) {
    return <div className="drag-region h-full bg-background" />;
  }
  // Before the engine has auth commands (or while the stub answers), auth.status
  // fails and the shell shows with its missing states.
  if (sessionEnded || auth.data?.signedIn === false) {
    return <SignedOut />;
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
    </div>
  );
}

/** Stands in for the sign-in screen (mockup 18) until M1.9. */
function SignedOut() {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="drag-region h-(--titlebar-height) shrink-0" />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-7 px-7 pt-10">
        <PageHeader
          icon={LogIn}
          title="Sign in"
          status={
            <>
              <Status tone="muted">Signed out</Status>
              <span>Your session ended. Sign in again.</span>
            </>
          }
        />
        <Card>
          <Empty>
            Signing in from the window arrives with the sign-in page. Until then, run Mesh UI with MESH_UI_DEMO=1.
            <div className="mt-3">
              <button
                type="button"
                onClick={() => invalidate(["auth."])}
                className="cursor-pointer text-foreground text-xs underline-offset-4 hover:underline"
              >
                Check again
              </button>
            </div>
          </Empty>
        </Card>
      </div>
    </div>
  );
}

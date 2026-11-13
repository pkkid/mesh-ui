import { useCallback, useEffect, useState } from "react";
import type { Network } from "@shared/types";

import { Spinner } from "~/components/ui/spinner";
import { DevicesView } from "~/features/devices/DevicesView";
import { LoginView } from "~/features/login/LoginView";
import { SettingsView } from "~/features/settings/SettingsView";
import { Sidebar, type View } from "~/features/shell/Sidebar";

type State =
  | { status: "loading" }
  | { status: "signed-out"; error?: string }
  | { status: "ready"; networks: Network[]; refreshing: boolean; error?: string };

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [view, setView] = useState<View>({ kind: "devices", networkId: null });
  // Remembered so returning from Settings lands on the same network.
  const [lastNetworkId, setLastNetworkId] = useState<string | null>(null);
  const navigate = (next: View) => {
    if (next.kind === "devices") setLastNetworkId(next.networkId);
    setView(next);
  };

  const load = useCallback(async () => {
    setState((s) => (s.status === "ready" ? { ...s, refreshing: true, error: undefined } : s));
    try {
      const networks = await window.mesh.load();
      setState(networks ? { status: "ready", networks, refreshing: false } : { status: "signed-out" });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      setState((s) =>
        s.status === "ready" ? { ...s, refreshing: false, error } : { status: "signed-out", error },
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async () => {
    await window.mesh.logout();
    setState({ status: "signed-out" });
    setView({ kind: "devices", networkId: null });
  };

  if (state.status === "loading") {
    return (
      <div className="drag-region grid h-full place-items-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (state.status === "signed-out") {
    return <LoginView initialError={state.error} onSignedIn={load} />;
  }

  const selectedId = view.kind === "devices" ? view.networkId : lastNetworkId;
  const network = state.networks.find((n) => n.id === selectedId) ?? state.networks[0] ?? null;

  return (
    <div className="flex h-full">
      <Sidebar networks={state.networks} activeNetworkId={network?.id ?? null} view={view} onNavigate={navigate} />
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        {view.kind === "settings" ? (
          <SettingsView onSignOut={signOut} />
        ) : (
          <DevicesView
            network={network}
            refreshing={state.refreshing}
            error={state.error}
            onRefresh={load}
          />
        )}
      </main>
    </div>
  );
}

/**
 * The danger zone on Advanced networking (M5.3): Restart network (the shared
 * row from `useRestartNetworkRow` on the eeros page, confirm dialog and the restart
 * watcher) and Delete network (`network.delete`, destructive, owner only):
 * the app's confirm dialog with core's message and type-the-name; core moves
 * the session to another network, and the page goes to Overview.
 * docs/ux/pages/advanced-networking.md (Danger zone).
 */
import { Trash2 } from "lucide-react";

import { navigate, pathFor } from "~/app/router";
import { useWrite } from "~/app/useWrite";
import { GatedButton, useGate } from "~/components/ui/page";
import { useRestartNetworkRow } from "~/features/eeros/NetworkActions";

import { Group, OFFLINE, Row, useOffline } from "./SettingsGroups";

/** `owner` is kept for AdvancedPage; the owner-only rule comes from `useGate("network.delete")` (core `ownerOnly`). */
export function DangerZone({ networkName }: { owner: boolean; networkName: string | null }) {
  const offline = useOffline();
  const restart = useRestartNetworkRow();
  const name = networkName ?? "this network";
  const remove = useWrite<{ networkName: string }, { name: string }>("network.delete", {
    confirm: { title: `Delete ${name}?`, confirmLabel: "Delete network", typeToConfirm: networkName ?? undefined },
    success: (r) => `${r.name} deleted`,
    failure: `Couldn't delete ${name}`,
  });
  const base = useGate("network.delete");
  // The gate already refuses a known admin ("Owner only"), as the palette and core do.
  const gate = !base.allowed ? base : offline ? { allowed: false, reason: OFFLINE } : networkName ? base : { allowed: false, reason: null };
  const runDelete = async () => {
    if (!networkName) return;
    const r = await remove.run({ networkName });
    if (r?.ok) navigate(pathFor("overview", {}));
  };

  return (
    <Group title="Danger zone" description={`Restart or delete ${name}`}>
      <Row title="Restart network" {...restart} />
      <Row
        title="Delete network"
        description={`Factory-resets every eero and removes ${name}, its profiles, history and admins. Cannot be undone. Owner only.`}
        control={
          <GatedButton variant="destructive" gate={gate} disabled={remove.running} onClick={() => void runDelete()}>
            <Trash2 />
            Delete network{"\u2026"}
          </GatedButton>
        }
      />
    </Group>
  );
}

/**
 * The danger zone on Advanced networking (M5.3): Restart network (the same
 * `network.restart` hook as the eeros page, inline confirm and the restart
 * watcher) and Delete network (`network.delete`, destructive, owner only):
 * the app's confirm dialog with core's message and type-the-name; core moves
 * the session to another network, and the page goes to Overview.
 * docs/ux/pages/advanced-networking.md (Danger zone).
 */
import { RotateCcw, Trash2 } from "lucide-react";

import { navigate, pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Badge } from "~/components/ui/badge";
import { WriteConfirm } from "~/components/ui/confirm";
import { GatedButton, useGate } from "~/components/ui/page";
import { useRestartNetwork } from "~/features/eeros/NetworkActions";
import { RESTART_ESTIMATE } from "../../../../core/commands/network";
import type { Network } from "../../../../core/model";

import { Group, OFFLINE, Row, useOffline } from "./SettingsGroups";

/** `owner` is the page's `role === "owner"`; a real network often reports no role, so only a known admin is refused (as core does). */
export function DangerZone({ networkName }: { owner: boolean; networkName: string | null }) {
  const offline = useOffline();
  const admin = useQuery<Network>("network.get").data?.role === "admin";
  const restart = useRestartNetwork();
  const name = networkName ?? "this network";
  const remove = useWrite<{ networkName: string }, { name: string }>("network.delete", {
    confirmIn: "dialog",
    confirm: { title: `Delete ${name}?`, confirmLabel: "Delete network", typeToConfirm: networkName ?? undefined },
    success: (r) => `${r.name} deleted`,
    failure: `Couldn't delete ${name}`,
  });
  const base = useGate("network.delete");
  // Admins may hold the network permission on a real network; deleting stays owner only.
  const gate = !base.allowed ? base : admin ? { allowed: false, reason: "Owner only" } : offline ? { allowed: false, reason: OFFLINE } : networkName ? base : { allowed: false, reason: null };
  const runDelete = async () => {
    if (!networkName) return;
    const r = await remove.run({ networkName });
    if (r?.ok) navigate(pathFor("overview", {}));
  };

  return (
    <Group title="Danger zone" subtitle="Cannot be undone from here">
      <Row
        title="Restart network"
        badge={<Badge variant="warning">Disruptive</Badge>}
        description={`Restarts every eero. Every device loses internet for ${RESTART_ESTIMATE.network}.`}
        control={
          <WriteConfirm write={restart.write}>
            <GatedButton size="sm" variant="outline" gate={restart.gate} disabled={restart.write.running} onClick={() => void restart.run()}>
              <RotateCcw />
              Restart network
            </GatedButton>
          </WriteConfirm>
        }
      />
      <Row
        title="Delete network"
        badge={<Badge variant="error">Destructive · owner</Badge>}
        description={`Factory-resets every eero and removes ${name}, its profiles, history and admins. Cannot be undone.`}
        control={
          <GatedButton size="sm" variant="destructive" gate={gate} disabled={remove.running} onClick={() => void runDelete()}>
            <Trash2 />
            Delete network
          </GatedButton>
        }
      />
    </Group>
  );
}

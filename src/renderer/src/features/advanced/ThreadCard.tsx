/**
 * The Thread row on Advanced networking (M5.3): the border router switch
 * (`settings.thread.set {enabled}`, turning it off asks first), the details
 * without secrets from `settings.get`, the phone keychain switch, and the
 * secret actions. Reveal and Copy read `settings.thread.credentials` (a
 * sensitive query, never cached) on each click; the key lives only in this
 * component's state and is dropped on Hide, unmount or regenerate.
 * Regenerate (`settings.thread.reset`, destructive) confirms in the dialog
 * with type-the-name. docs/ux/pages/advanced-networking.md (Wireless).
 */
import { Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { execute, useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { GatedButton } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { toast } from "~/components/ui/toast";
import { copyText } from "~/lib/clipboard";
import type { Network, NetworkSettings, ThreadCredentials } from "../../../../core/model";

import { Fields, OFFLINE, Row, SubPanel, useSettingsWrite, WriteSwitch } from "./SettingsGroups";

type Thread = NonNullable<NetworkSettings["thread"]>;

/** What Copy puts on the clipboard: eero's dataset when it sends one, else the fields a Thread app asks for. */
export function threadClipboard(t: Pick<Thread, "name" | "channel" | "panId" | "xpanId">, c: ThreadCredentials): string {
  if (c.dataset) return c.dataset;
  return [
    ["Network name", t.name],
    ["Channel", t.channel === null ? null : String(t.channel)],
    ["PAN ID", t.panId],
    ["Extended PAN ID", t.xpanId],
    ["Network key", c.networkKey],
    ["PSKc", c.pskc],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

export function ThreadCard({ settings, offline }: { settings: NetworkSettings | undefined; offline: boolean }) {
  const t = settings?.thread ?? null;
  const network = useQuery<Network>("network.get");
  const toggle = useSettingsWrite<{ enabled: boolean }>("settings.thread.set", "Thread", offline);
  const sync = useSettingsWrite<{ credentialSync: boolean }>("settings.thread.set", "credential sharing", offline);
  const [revealed, setRevealed] = useState<ThreadCredentials | null>(null);
  const [reading, setReading] = useState(false);
  const typeName = t?.name ?? network.data?.name ?? "Thread";
  const reset = useWrite<Record<string, never>>("settings.thread.reset", {
    confirm: { title: `Regenerate credentials for ${typeName}?`, confirmLabel: "Regenerate credentials", typeToConfirm: typeName },
    success: "New Thread credentials made. Pair each Thread accessory again.",
    failure: "Couldn't regenerate the Thread credentials",
  });
  const resetGate = offline && toggle.gate.allowed ? { allowed: false, reason: OFFLINE } : toggle.gate;

  // A network switch or a reset drops anything revealed.
  useEffect(() => setRevealed(null), [network.data?.id]);

  // No Thread border router on this network: the row is left out (unsupported rows are hidden on this page).
  if (settings && !t) return null;

  const read = async (): Promise<ThreadCredentials | null> => {
    setReading(true);
    const res = await execute<ThreadCredentials>("settings.thread.credentials");
    setReading(false);
    if (res.ok) return res.result;
    toast.error("Couldn't read the Thread credentials", { detail: res.error.message });
    return null;
  };
  const reveal = async () => {
    if (revealed) return setRevealed(null);
    setRevealed(await read());
  };
  const copy = async () => {
    const c = revealed ?? (await read());
    if (c && t) await copyText(threadClipboard(t, c), { toast: c.dataset ? "Copied the Thread dataset" : "Copied the Thread credentials" });
  };
  const turn = (enabled: boolean) =>
    void toggle.write.run(
      { enabled },
      // settings.thread.set is disruptive: the engine asks both ways, with core's message.
      enabled
        ? {
            confirm: { title: "Turn on Thread?", confirmLabel: "Turn on Thread" },
            success: "Thread turned on",
            undo: { id: "settings.thread.set", params: { enabled: false }, confirm: { title: "Turn off Thread?", confirmLabel: "Turn off Thread" }, success: "Thread turned off" },
          }
        : { confirm: { title: "Turn off Thread?", confirmLabel: "Turn off Thread" }, success: "Thread turned off" },
    );
  const regenerate = async () => {
    const r = await reset.run({});
    if (r?.ok) setRevealed(null);
  };

  return (
    <Row
      title="Thread" when="thread"
      badge={t?.enabled ? <Status tone="success">Border router</Status> : undefined}
      description="Low-power mesh for Matter and smart home accessories"
      control={<WriteSwitch on={t?.enabled} label="Thread" gate={toggle.gate} busy={toggle.write.running} onToggle={turn} />}
    >
      {t && (
        <SubPanel className="flex flex-col gap-3.5">
          <Fields
            items={[
              { label: "Network name", value: t.name, mono: false },
              { label: "Channel", value: t.channel === null ? null : String(t.channel) },
              { label: "PAN ID", value: t.panId },
              { label: "Extended PAN ID", value: t.xpanId },
              {
                label: "Network key",
                value: (
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={revealed ? "truncate select-all" : "tracking-[0.18em]"}>{revealed ? revealed.networkKey : "••••••••••••••••"}</span>
                    <Button size="xs" variant="outline" disabled={reading} onClick={() => void reveal()} aria-label={revealed ? "Hide network key" : "Reveal network key"}>
                      {revealed ? <EyeOff /> : <Eye />}
                      {revealed ? "Hide" : "Reveal"}
                    </Button>
                  </span>
                ),
              },
              { label: "Border agent", value: t.borderAgent },
            ]}
          />
          <div className="flex items-center gap-3 border-t pt-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium text-xs">Share credentials with phone keychain</span>
              <span className="text-2xs text-muted-foreground">Lets iOS and Android add Thread devices to this network</span>
            </div>
            <WriteSwitch
              on={t.credentialSync}
              label="Share credentials with phone keychain"
              gate={sync.gate}
              busy={sync.write.running}
              onToggle={(on) =>
                void sync.write.run(
                  { credentialSync: on },
                  { success: `Credential sharing turned ${on ? "on" : "off"}`, undo: { id: "settings.thread.set", params: { credentialSync: !on }, success: `Credential sharing turned ${on ? "off" : "on"}` } },
                )
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button size="xs" variant="outline" disabled={reading} onClick={() => void copy()}>
              <Copy />
              {revealed && !revealed.dataset ? "Copy credentials" : "Copy dataset"}
            </Button>
            <GatedButton size="xs" variant="outline" className="text-destructive-foreground" gate={resetGate} disabled={reset.running} onClick={() => void regenerate()}>
              <KeyRound />
              Regenerate credentials
            </GatedButton>
            <span className="text-2xs text-muted-foreground">Regenerating disconnects every Thread device</span>
          </div>
        </SubPanel>
      )}
    </Row>
  );
}

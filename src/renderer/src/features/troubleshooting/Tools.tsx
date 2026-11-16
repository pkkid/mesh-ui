/**
 * Tools and Fixes on Troubleshooting.
 * - Tools: Run speed test (the shared runner from the Internet hero) and
 *   Find an eero (an eero select and `eero.find`, counting down while it
 *   blinks).
 * - Fixes: Connect 2.4 GHz only devices (`wifi.hide5g.set`, confirm dialog,
 *   countdown to eero's expiry), Legacy mode (state from `settings.get`; the
 *   switch lives on Advanced networking), Status light colours (static
 *   reference), Restart a single eero (`eero.restart`) and Restart network
 *   (`network.restart`), both with the engine's confirm in the dialog and the
 *   shared restart watcher.
 * docs/ux/pages/troubleshooting.md (Tools, Fixes).
 */
import { useState, type ReactNode } from "react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Badge } from "~/components/ui/badge";
import { Card, Section } from "~/components/ui/card";
import { GatedButton, HeaderLink, useGate, useNow } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { restartLine } from "~/features/eero/helpers";
import { BlinkLightButton } from "~/features/eeros/EeroCards";
import { useRestartNetwork, watchRestart } from "~/features/eeros/NetworkActions";
import { useSpeedTest } from "~/features/internet/InternetHero";
import type { RestartResult } from "../../../../core/commands/network";
import type { Eero, NetworkSettings, WifiSettings } from "../../../../core/model";

function ToolRow({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[58px] items-center gap-3.5 px-[18px] py-[13px]">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm">{title}</div>
        <div className="text-muted-foreground text-xs">{detail}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

const selectClass =
  "h-6 max-w-40 cursor-pointer truncate rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32";

export function Tools({ eeros }: { eeros: Eero[] | undefined }) {
  const speedTest = useSpeedTest();
  const [picked, setPicked] = useState<string | null>(null);
  const target = eeros?.find((e) => e.id === picked) ?? eeros?.[0] ?? null;
  return (
    <Section title="Tools" subtitle="Speed test and find an eero">
      <Card className="divide-y">
        <ToolRow title="Run speed test" detail="Uses the WAN for about 30 s">
          <HeaderLink to={pathFor("internet")}>History</HeaderLink>
          <GatedButton gate={speedTest.gate} size="xs" variant="outline" onClick={() => void speedTest.run()}>
            {speedTest.testing ? "Testing..." : "Run"}
          </GatedButton>
        </ToolRow>
        <ToolRow title="Find an eero" detail="Blinks its light blue and white for 30 s">
          <select aria-label="eero to find" className={selectClass} value={target?.id ?? ""} onChange={(e) => setPicked(e.target.value)} disabled={!eeros?.length}>
            {(eeros ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.location}
              </option>
            ))}
          </select>
          {target ? (
            <BlinkLightButton key={target.id} eero={target} />
          ) : (
            <GatedButton gate={{ allowed: false, reason: "No eeros yet" }} size="xs" variant="outline">
              Blink light
            </GatedButton>
          )}
        </ToolRow>
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Fixes

function FixCard({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <Card padded className="flex flex-col gap-3 text-[13px]">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 font-medium text-sm">{title}</h3>
        {badge}
      </div>
      {children}
    </Card>
  );
}

const disruptive = <Badge variant="warning">Disruptive</Badge>;

/** "12:04" or "1 h 05 min" until `iso`. */
function countdown(iso: string, now: number): string | null {
  const left = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  if (!Number.isFinite(left)) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m}:${String(left % 60).padStart(2, "0")}`;
}

function TwoFourOnly({ offline }: { offline: boolean }) {
  const wifi = useQuery<WifiSettings>("wifi.get", undefined, { poll: true });
  const active = wifi.data?.hide5g.active ?? false;
  const expiresAt = wifi.data?.hide5g.expiresAt ?? null;
  const gate = useGate("wifi.hide5g.set");
  const write = useWrite<{ enabled: boolean }, WifiSettings>("wifi.hide5g.set", {
    success: (r) => (r.hide5g.active ? "5 and 6 GHz paused" : "5 and 6 GHz are back"),
    progress: active ? "Bringing back 5 and 6 GHz..." : "Pausing 5 and 6 GHz...",
    confirm: active ? { title: "Bring back 5 and 6 GHz now?", confirmLabel: "Restore now" } : { confirmLabel: "Pause 5 and 6 GHz" },
  });
  const now = useNow(active ? 1000 : 60_000);
  const left = active && expiresAt ? countdown(expiresAt, now) : null;
  return (
    <FixCard title="Connect 2.4 GHz only devices" badge={disruptive}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-muted-foreground text-xs">
          {active ? "5 and 6 GHz are paused so older devices can join." : "eero brings 5 and 6 GHz back on its own when the window ends."}
        </div>
        {left && <span className="font-mono font-semibold text-lg tabular-nums tracking-tighter">{left}</span>}
      </div>
      <div className="flex items-center gap-2">
        {active ? <Status tone="warning">5 and 6 GHz paused</Status> : <Status tone="muted">Off</Status>}
        <span className="ms-auto" />
        <GatedButton
          gate={offline ? { allowed: false, reason: "The network is offline" } : gate}
          size="xs"
          variant="outline"
          disabled={!wifi.data || write.running}
          onClick={() => void write.run({ enabled: !active })}
        >
          {active ? "Restore now" : "Start"}
        </GatedButton>
      </div>
    </FixCard>
  );
}

function LegacyMode() {
  const settings = useQuery<NetworkSettings>("settings.get", undefined, { poll: true });
  const on = settings.data?.legacyMode ?? null;
  return (
    <FixCard title="Connect devices that can't detect Wi-Fi 6" badge={disruptive}>
      <p className="text-muted-foreground text-xs">Legacy mode helps older devices see the network. It may reduce speeds, and turning it on or off restarts the network for about 2 to 3 minutes.</p>
      <div className="flex items-center gap-2">
        {on === null ? <Status tone="muted">-</Status> : on ? <Status tone="warning">Legacy mode on</Status> : <Status tone="muted">Off</Status>}
        <span className="ms-auto">
          <HeaderLink to={pathFor("advanced")} arrow>
            Advanced networking
          </HeaderLink>
        </span>
      </div>
    </FixCard>
  );
}

const LIGHTS: [string, string][] = [
  ["Solid white", "Online and working"],
  ["Blinking white", "Starting up or connecting"],
  ["Blinking blue", "Ready for setup over Bluetooth"],
  ["Solid blue", "Connected to the app during setup"],
  ["Solid green", "Power saving schedule is on"],
  ["Solid red", "No internet, check modem and cable"],
  ["Off", "Light turned off in settings, or no power"],
];

function StatusLights() {
  return (
    <FixCard title="Status light colors">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {LIGHTS.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium">{k}</dt>
            <dd className="text-muted-foreground">{v}</dd>
          </div>
        ))}
      </dl>
    </FixCard>
  );
}

function RestartRow({ eero, eeros, networkName }: { eero: Eero; eeros: Eero[]; networkName: string }) {
  const gate = useGate("eero.restart");
  const write = useWrite<{ eero: string }, RestartResult>("eero.restart", {
    confirm: { title: `Restart ${eero.location}?`, confirmLabel: `Yes, restart ${eero.location}` },
  });
  const blocked = eero.status === "offline" ? `${eero.location} is offline` : eero.status === "updating" ? `${eero.location} is restarting` : null;
  const run = async () => {
    const r = await write.run({ eero: eero.id });
    if (r?.ok) watchRestart(r.result, eero.isGateway ? networkName : eero.location);
  };
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-xs">{eero.location}</div>
        <div className={eero.isGateway ? "text-2xs text-warning-foreground" : "text-2xs text-muted-foreground"}>
          {eero.isGateway ? "Gateway: takes the network offline" : restartLine(eero, eeros, networkName)}
        </div>
      </div>
      <GatedButton gate={blocked ? { allowed: false, reason: blocked } : gate} size="xs" variant="outline" disabled={write.running} onClick={() => void run()}>
        Restart
      </GatedButton>
    </div>
  );
}

function RestartNetwork() {
  const restart = useRestartNetwork();
  return (
    <FixCard title="Restart network" badge={disruptive}>
      <p className="text-muted-foreground text-xs">Every eero restarts at once. Everyone loses internet for about 2 to 3 minutes.</p>
      <div>
        <GatedButton gate={restart.gate} size="xs" variant="outline" className="text-destructive-foreground" disabled={restart.write.running} onClick={() => void restart.run()}>
          Restart network
        </GatedButton>
      </div>
    </FixCard>
  );
}

export function Fixes({ eeros, networkName, offline }: { eeros: Eero[] | undefined; networkName: string; offline: boolean }) {
  return (
    <Section title="Fixes" subtitle="Temporary modes and restarts">
      <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
        <TwoFourOnly offline={offline} />
        <LegacyMode />
        <StatusLights />
        <FixCard title="Restart a single eero">
          <div className="flex flex-col divide-y">
            {(eeros ?? []).map((e) => (
              <RestartRow key={e.id} eero={e} eeros={eeros ?? []} networkName={networkName} />
            ))}
          </div>
        </FixCard>
        <RestartNetwork />
      </div>
    </Section>
  );
}

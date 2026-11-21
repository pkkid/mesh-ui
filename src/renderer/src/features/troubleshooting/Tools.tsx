/**
 * Tools, Status light colors and Restart on Troubleshooting, as settings
 * rows in section cards.
 * - Tools: Run speed test (the shared runner from the Internet hero) with a
 *   link to the history, Find an eero (an eero dropdown and `eero.find`,
 *   counting down while it blinks), 2.4 GHz only (the same row as the Wi-Fi
 *   network page, `wifi.hide5g.set`) and Legacy mode (state from
 *   `settings.get`; the switch lives on Advanced networking).
 * - Status light colors: static reference.
 * - Restart: one row per eero (`eero.restart`) and Restart network
 *   (`network.restart`), both asking first, with the shared restart watcher.
 *   Disruptive, so it is its own section near the foot of the page.
 * docs/ux/pages/troubleshooting.md (Tools, Fixes, Status light colors, Restart).
 */
import { Gauge, LoaderCircle, RotateCcw } from "lucide-react";
import { useState } from "react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Card, Section } from "~/components/ui/card";
import { GatedButton, SectionLink, useGate, useNow } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Status } from "~/components/ui/status";
import { Row as SettingsRow } from "~/features/advanced/SettingsGroups";
import { restartLine } from "~/features/eero/helpers";
import { BlinkLightButton } from "~/features/eeros/EeroCards";
import { useRestartNetwork, watchRestart } from "~/features/eeros/NetworkActions";
import { useSpeedTest } from "~/features/internet/InternetHero";
import { Hide5gRow } from "~/features/wifi/WifiBands";
import { hue } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import type { RestartResult } from "../../../../core/commands/network";
import { formatCount, formatMbps, formatRelative } from "../../../../core/format";
import type { Eero, Internet, NetworkSettings, WifiSettings } from "../../../../core/model";

const DIM_ICON = "[&_svg]:text-muted-foreground";

export function Tools({ eeros, offline }: { eeros: Eero[] | undefined; offline: boolean }) {
  const speedTest = useSpeedTest();
  const wifi = useQuery<WifiSettings>("wifi.get", undefined, { poll: true });
  const settings = useQuery<NetworkSettings>("settings.get", undefined, { poll: true });
  const legacy = settings.data?.legacyMode ?? null;
  // Modes that are on lead the subtitle: they change how the network behaves right now.
  const on = [wifi.data?.hide5g.active && "2.4 GHz only on", legacy && "Legacy mode on"].filter(Boolean);
  const last = useQuery<Internet>("internet.get").data?.lastSpeedTest ?? null;
  const now = useNow();
  const [picked, setPicked] = useState<string | null>(null);
  const target = eeros?.find((e) => e.id === picked) ?? eeros?.[0] ?? null;
  const description = [...on, last ? `Last speed test ${formatMbps(last.downMbps)} down, ${formatRelative(last.at, now)}` : "No speed test yet"].join(", ");
  return (
    <Section title="Tools" description={description} className="gap-[15px]">
      <Card className="divide-y divide-border/50">
        <SettingsRow
          title="Speed test"
          description="Measures your internet download and upload. Uses the connection for about 30 seconds."
          control={
            <>
              <GatedButton gate={speedTest.gate} variant="outline" className={DIM_ICON} onClick={() => void speedTest.run()}>
                {speedTest.testing ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Gauge />}
                {speedTest.label}
              </GatedButton>
              <SectionLink to={pathFor("internet")}>View history</SectionLink>
            </>
          }
        />
        <SettingsRow
          title="Find an eero"
          description="Blinks the eero's light blue and white for 30 seconds, so you can tell which one it is."
          control={
            <>
              <Select items={(eeros ?? []).map((e) => ({ value: e.id, label: e.location }))} value={target?.id ?? null} onValueChange={(v) => v && setPicked(v)} disabled={!eeros?.length}>
                <SelectTrigger className="w-44" aria-label="eero to find">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {(eeros ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.location}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {target ? (
                <BlinkLightButton key={target.id} eero={target} size="context" />
              ) : (
                <GatedButton gate={{ allowed: false, reason: "No eeros yet" }} variant="outline">
                  Blink light
                </GatedButton>
              )}
            </>
          }
        />
        {wifi.data && wifi.data.bands.some((b) => b.band === "2.4") && <Hide5gRow wifi={wifi.data} offline={offline} />}
        <SettingsRow
          title={
            <>
              Legacy mode
              {legacy && <Status tone="warning">On</Status>}
            </>
          }
          description="Helps older devices that can't detect Wi-Fi 6 see the network. It may reduce speeds, and turning it on or off restarts the network for about 2 to 3 minutes."
          control={<SectionLink to={pathFor("advanced")}>View advanced networking</SectionLink>}
        />
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Status light colors

/**
 * Each light with its dot: the colour from the theme (white is the text
 * colour, so it shows on light themes too; blue, green and red the theme's
 * series hues), blinking when the light blinks. Off is a dim dot, not a gap.
 */
const LIGHTS: { light: string; meaning: string; color: string; blink?: boolean }[] = [
  { light: "Solid white", meaning: "Online and working", color: "var(--color-foreground)" },
  { light: "Blinking white", meaning: "Starting up or connecting", color: "var(--color-foreground)", blink: true },
  { light: "Blinking blue", meaning: "Ready for setup over Bluetooth", color: hue("blue"), blink: true },
  { light: "Solid blue", meaning: "Connected to the app during setup", color: hue("blue") },
  { light: "Solid green", meaning: "Power saving schedule is on", color: hue("green") },
  { light: "Solid red", meaning: "No internet, check modem and cable", color: hue("red") },
  { light: "Off", meaning: "Light turned off in settings, or no power", color: "color-mix(in srgb, var(--color-muted-foreground) 35%, transparent)" },
];

export function StatusLights() {
  return (
    <Section title="Status light colors" className="gap-[15px]">
      <Card padded>
        <dl className="flex flex-col gap-1 text-[13px]">
          {LIGHTS.map((l) => (
            // 28px rows, the height of Get help's rows beside it, so the two cards line up.
            <div key={l.light} className="grid min-h-7 grid-cols-[8rem_minmax(0,1fr)] items-center gap-3">
              <dt className="flex items-center gap-2 font-medium">
                {/* The network switcher's dot size (size-2). A blink is an opacity fade, and stops for reduced motion. */}
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-full", l.blink && "animate-[light-blink_1.2s_ease-in-out_infinite] motion-reduce:animate-none")}
                  style={{ background: l.color }}
                />
                {l.light}
              </dt>
              <dd className="text-muted-foreground">{l.meaning}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Restart

function RestartEero({ eero, eeros, networkName }: { eero: Eero; eeros: Eero[]; networkName: string }) {
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
    <SettingsRow
      title={
        <>
          {eero.location}
          {eero.isGateway && <Status tone="muted">Gateway</Status>}
        </>
      }
      description={eero.isGateway ? <span className="text-warning-foreground">Restarting the gateway takes the whole network offline.</span> : restartLine(eero, eeros, networkName)}
      control={
        <GatedButton gate={blocked ? { allowed: false, reason: blocked } : gate} variant="outline" className={DIM_ICON} disabled={write.running} onClick={() => void run()}>
          <RotateCcw />
          Restart {eero.location}…
        </GatedButton>
      }
    />
  );
}

export function Restarts({ eeros, networkName }: { eeros: Eero[] | undefined; networkName: string }) {
  const restart = useRestartNetwork();
  const n = eeros?.length ?? 0;
  const online = eeros?.filter((e) => e.status !== "offline").length ?? 0;
  const description = !eeros ? "-" : `${plural(n, "eero")}${online < n ? `, ${formatCount(n - online)} offline` : ""}`;
  return (
    <Section title="Restart" description={description} className="gap-[15px]">
      <Card className="divide-y divide-border/50">
        {(eeros ?? []).map((e) => (
          <RestartEero key={e.id} eero={e} eeros={eeros ?? []} networkName={networkName} />
        ))}
        <SettingsRow
          title="Restart network"
          description="Every eero restarts at once. Everyone loses internet for about 2 to 3 minutes."
          control={
            <GatedButton gate={restart.gate} variant="outline" className="text-destructive-foreground [&_svg]:text-destructive-foreground/70" disabled={restart.write.running} onClick={() => void restart.run()}>
              <RotateCcw />
              Restart network…
            </GatedButton>
          }
        />
      </Card>
    </Section>
  );
}

const plural = (n: number, one: string) => `${formatCount(n)} ${n === 1 ? one : `${one}s`}`;

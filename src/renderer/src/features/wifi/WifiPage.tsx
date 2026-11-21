/**
 * Wi-Fi: the main network's name, password (revealed only on request), QR
 * block, security per band, bands and their devices, nickname and time zone.
 * Name, password, security and 2.4 GHz only change through the write kit
 * (M4.7); the nickname changes in NicknameSheet (`network.nickname.set`,
 * M6.9) and the time zone in TimezoneSheet (`settings.timezone.set`, M5).
 * The live eero backend cannot change the time zone (M6.9: eero keeps the old
 * zone), so on it the time zone Edit dims with that reason; demo applies it.
 * Layout, data and
 * states: docs/ux/pages/wifi.md and docs/mockups/12-wifi-settings.html.
 *
 * The password comes from `wifi.password.get` (reveal or copy), run only
 * when asked. The QR payload comes from `wifi.share`, read in the background
 * when the page opens so "Show code" is instant (as Guest network's hero
 * does). Both are held only in this page's state and dropped on a network switch or
 * when the page unmounts. They never enter the query
 * store, so nothing polls them. A name or password change drops them too, so
 * the next reveal reads the new ones (with M4.2's credential bypass).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { PageProps } from "~/app/routes";
import { bridge, execute, useQuery } from "~/app/useCommand";
import { fieldErrors, type Gate, useWrite } from "~/app/useWrite";
import { Card, Section } from "~/components/ui/card";
import { Row as SettingsRow } from "~/features/advanced/SettingsGroups";
import { Input } from "~/components/ui/input";
import { GatedButton, SectionError, useGate, useNow } from "~/components/ui/page";
import { useTopBarUpdated } from "~/features/shell/TopBar";
import { formatCount, MISSING, networkClock } from "../../../../core/format";
import { NICKNAME_MAX } from "../../../../core/commands/network";
import type { WifiPassword } from "../../../../core/commands/wifi";
import type { AppInfo, DeviceList, Network, NetworkHealth, NetworkSummary, WifiSettings, WifiShare } from "../../../../core/model";

import { WifiBands } from "./WifiBands";
import { TimezoneSheet } from "./TimezoneSheet";
import { WifiHero } from "./WifiHero";
import { EditNamePasswordButton, NamePasswordRows, SecurityFootnote, SecurityRows } from "./WifiSecurity";

/** A credential read on demand: `wifi.password.get` for the password field, `wifi.share` for the QR block. */
export type Secret<R> = {
  value: R | null;
  loading: boolean;
  error: string | null;
  /** Reads once for this network; later calls reuse it. Returns null on failure or after a network switch. */
  load: () => Promise<R | null>;
  clear: () => void;
};

type SecretState<R> = { value: R | null; loading: boolean; error: string | null };
const NONE = { value: null, loading: false, error: null };

/**
 * Runs a sensitive command only when asked, for an explicit network, and keeps
 * the answer in this component only. A network switch (the host's
 * `network.selected`, or a new `networkId`) drops it, and an answer that
 * arrives after a switch is discarded.
 */
function useSecret<R>(id: string, networkId: string | null): Secret<R> {
  const [state, setState] = useState<SecretState<R>>(NONE);
  const generation = useRef(0);
  const clear = useCallback(() => {
    generation.current += 1;
    setState(NONE);
  }, []);
  useEffect(() => clear, [networkId, clear]);
  // The network the host switched to; until network.get catches up, `networkId` is still the old one.
  const selected = useRef<string | null>(null);
  useEffect(
    () =>
      bridge().on?.((e) => {
        if (e.type !== "network.selected") return;
        selected.current = e.networkId;
        clear();
      }),
    [clear],
  );
  const load = async (): Promise<R | null> => {
    if (state.value) return state.value;
    if (!networkId || (selected.current !== null && selected.current !== networkId)) return null;
    const gen = generation.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const res = await execute<R>(id, { networkId });
    if (gen !== generation.current) return null;
    setState(res.ok ? { value: res.result, loading: false, error: null } : { value: null, loading: false, error: res.error.message });
    return res.ok ? res.result : null;
  };
  return { ...state, load, clear };
}

export function WifiPage(_props: PageProps) {
  const wifi = useQuery<WifiSettings>("wifi.get", undefined, { poll: true });
  useTopBarUpdated(wifi.fetchedAt);
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const health = useQuery<NetworkHealth>("network.health", undefined, { poll: true });
  const devices = useQuery<DeviceList>("device.list", {}, { poll: true });
  const networkId = network.data?.id ?? null;
  const password = useSecret<WifiPassword>("wifi.password.get", networkId);
  const share = useSecret<WifiShare>("wifi.share", networkId);
  // Read the QR payload in the background once the Wi-Fi settings have loaded, so Show code only reveals it. The
  // live backend answers it from wifi.get's own GET {net} (src/core/eero/backend/wifi.ts), so it costs no request.
  // It lives only in this page's state and is never polled; read again after a network switch or a name or password
  // change clears it; not again after a failure, until asked.
  const shareLoad = share.load;
  const ready = wifi.data !== undefined;
  useEffect(() => {
    if (ready && networkId && !share.value && !share.loading && !share.error) void shareLoad();
  }, [ready, networkId, share.value, share.loading, share.error]);

  const offline = health.data?.status === "offline" || network.data?.status === "offline";
  const data = wifi.data ?? null;
  const [editing, setEditing] = useState(false);
  // "27 devices rejoin after a name or password change, 3 on WPA2 only": what a change costs, then who WPA3 would drop.
  const wpa2 = data?.wpa2OnlyDevices.length ?? 0;
  const settingsLine = !data
    ? "-"
    : [
        data.hasPassword
          ? `${formatCount(data.wirelessClients)} ${data.wirelessClients === 1 ? "device rejoins" : "devices rejoin"} after a name or password change`
          : "Open network, anyone nearby can join",
        wpa2 > 0 && `${formatCount(wpa2)} on WPA2 only`,
      ]
        .filter(Boolean)
        .join(", ");

  return (
    <>
      <WifiHero wifi={data} network={network.data ?? null} offline={offline} share={share} password={password} fading={wifi.fading} />

      <div className="flex flex-col gap-14">
        {wifi.error && !data ? (
          <SectionError what="Wi-Fi settings" error={wifi.error} onRetry={() => void wifi.refetch()} />
        ) : (
          <>
            <WifiBands wifi={data} offline={offline} fading={wifi.fading} />
            <Section
              title="Wi-Fi network settings"
              description={settingsLine}
              className="gap-[15px]"
              tools={<EditNamePasswordButton wifi={data} offline={offline} onClick={() => setEditing(true)} />}
            >
              <Card className="divide-y divide-border/50">
                <NamePasswordRows
                  wifi={data}
                  password={password}
                  editing={editing}
                  onEditDone={() => setEditing(false)}
                  onSaved={() => {
                    password.clear();
                    share.clear();
                  }}
                />
                <SecurityRows wifi={data} devices={devices.data?.devices ?? null} offline={offline} />
                <NicknameRows network={network.data ?? null} offline={offline} />
              </Card>
              <SecurityFootnote wifi={data} />
            </Section>
          </>
        )}
      </div>
    </>
  );
}

/** Why the time zone cannot change on the live eero backend (M6.9; docs/ux/pages/wifi.md). */
export const TIMEZONE_LIVE_REASON = "Change the time zone in the eero app: eero keeps the old zone when Mesh UI sends it";

const OFFLINE: Gate = { allowed: false, reason: "The network is offline" };

/** What the nickname is for, under the field and in the sheet (#270). */
export const NICKNAME_HINT = "A name for this network in Mesh UI and the eero app, handy if you manage more than one. Your Wi-Fi name doesn't change.";

/**
 * The nickname and time zone rows of the Wi-Fi settings: the network nickname (Change…
 * opens NicknameSheet) and the time zone with the local time there (Change…
 * opens TimezoneSheet). The nickname comes from `network.list`, which reads
 * the account's network refs as well as `GET {net}`, so it matches the
 * network switcher (#270).
 */
function NicknameRows({ network, offline }: { network: Network | null; offline: boolean }) {
  const now = useNow(30_000);
  const networks = useQuery<NetworkSummary[]>("network.list", undefined, { poll: 60 });
  const summary = networks.data?.find((n) => n.id === network?.id) ?? null;
  const nickname = summary ? summary.nickname : (network?.nickname ?? null);
  const [editing, setEditing] = useState<"timezone" | null>(null);
  const nicknameGate = useGate("network.nickname.set");
  const tzGate = useGate("settings.timezone.set");
  const app = useQuery<AppInfo>("app.info");
  const live = app.data?.backend === "eero";
  const tz = network?.timezone ?? null;
  const local = tz ? networkClock(tz).time(now) : null;
  const change = (what: "timezone", gate: Gate, label: string) => (
    <GatedButton variant="outline" size="sm" aria-label={label} gate={offline ? OFFLINE : gate} disabled={!network} onClick={() => setEditing(what)}>
      Change{"\u2026"}
    </GatedButton>
  );
  return (
    <>
      <SettingsRow
        title="Network nickname"
        description={NICKNAME_HINT}
        control={<NicknameInput current={nickname} gate={offline ? OFFLINE : nicknameGate} disabled={!network} />}
      />
      <SettingsRow
        title="Time zone"
        description={`${local ? `Local time ${local}. ` : ""}Profile schedules, power saving and updates follow this time zone.${live ? " Change it in the eero app." : ""}`}
        control={
          <span className="flex items-center gap-3">
            <span className="max-w-56 truncate text-sm">{tz ?? MISSING}</span>
            {change("timezone", live ? { allowed: false, reason: TIMEZONE_LIVE_REASON } : tzGate, "Change time zone")}
          </span>
        }
      />
      <TimezoneSheet open={editing === "timezone"} onClose={() => setEditing(null)} current={tz} />
    </>
  );
}

const NICKNAME_ID = "network.nickname.set";

/**
 * The nickname as an inline input in its settings row. It saves on Enter or
 * when the field loses focus, only if the value changed (empty clears it):
 * `network.nickname.set`, a `write` with no confirm, then a toast with Undo
 * that sets the old one back. Esc puts the saved nickname back. A failed save
 * keeps the typed value and shows the reason under the field.
 */
function NicknameInput({ current, gate, disabled }: { current: string | null; gate: Gate; disabled: boolean }) {
  const [value, setValue] = useState(current ?? "");
  const [focused, setFocused] = useState(false);
  // Follow the saved nickname (a poll, an Undo, a network switch) while the field is not being edited.
  useEffect(() => {
    if (!focused) setValue(current ?? "");
  }, [current, focused]);
  const save = useWrite<{ nickname: string }, { nickname: string | null }>(NICKNAME_ID, {
    success: (r) => (r.nickname ? `Nickname set to ${r.nickname}` : "Nickname cleared"),
    undo: { id: NICKNAME_ID, params: { nickname: current ?? "" }, success: current ? `Nickname set back to ${current}` : "Nickname cleared" },
    form: true,
  });
  const error = fieldErrors(save.error).nickname ?? fieldErrors(save.error)._form;
  const commit = () => {
    const next = value.trim();
    if (next !== (current ?? "")) void save.run({ nickname: next });
  };
  return (
    <span className="flex flex-col items-end gap-1" title={gate.allowed ? undefined : (gate.reason ?? undefined)}>
      <Input
        className="w-56"
        aria-label="Network nickname"
        value={value}
        maxLength={NICKNAME_MAX}
        placeholder="Add a nickname"
        disabled={disabled || !gate.allowed || save.running}
        aria-invalid={error ? true : undefined}
        onFocus={() => setFocused(true)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(current ?? "");
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
      {error && <span className="max-w-56 text-destructive-foreground text-xs">{error}</span>}
    </span>
  );
}

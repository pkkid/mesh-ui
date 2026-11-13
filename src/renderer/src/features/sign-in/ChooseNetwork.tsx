/**
 * Sign in, step 3: pick the network to open (docs/ux/sign-in.md, Choose
 * network). With one network it is selected without asking; with none the
 * step says so and offers Sign out. `network.select` saves the choice, so
 * the app and the CLI start on it next time.
 */
import { ArrowRight, House } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useCommand, useQuery } from "~/app/useCommand";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { networkStatus, Status } from "~/components/ui/status";
import { hue } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatRelative } from "../../../../core/format";
import type { Account, NetworkSummary } from "../../../../core/model";
import { BigButton, ErrorLine, errorText, initials, Lead, Title } from "./SignInView";

type ChooseNetworkProps = {
  /** The network chosen, or null when this build cannot list networks yet. */
  onContinue: (network: NetworkSummary | null) => void;
};

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

function detail(n: NetworkSummary, now: number): string {
  const parts: string[] = [];
  if (n.eeroCount !== null) parts.push(plural(n.eeroCount, "eero"));
  if (n.status === "offline") {
    parts.push(n.lastSeen ? `last seen ${formatRelative(n.lastSeen, now)}` : "offline");
  } else {
    if (n.devicesOnline !== null) parts.push(`${n.devicesOnline} devices online`);
    if (n.updateAvailable) parts.push("update available");
    else if (n.isp) parts.push(n.isp);
  }
  return parts.join(" · ") || "-";
}

export function ChooseNetwork({ onContinue }: ChooseNetworkProps) {
  const account = useQuery<Account>("account.get");
  const networks = useQuery<NetworkSummary[]>("network.list");
  const select = useCommand<{ network: string }>("network.select");
  const logout = useCommand("auth.logout");
  const [chosen, setChosen] = useState<string | null>(null);
  const auto = useRef(false);
  const now = Date.now();

  const list = networks.data ?? null;
  const current = list?.find((n) => n.id === chosen) ?? list?.find((n) => n.selected) ?? list?.[0] ?? null;

  const choose = async (network: NetworkSummary) => {
    const res = await select.run({ network: network.id });
    // Builds without network.select fall back to the engine's choice.
    if (res.ok || res.error.code === "unknown_command") onContinue(network);
  };

  // One network: no question to ask. A build without network.list: skip ahead.
  useEffect(() => {
    if (auto.current) return;
    if (networks.error?.code === "unknown_command") {
      auto.current = true;
      onContinue(null);
    } else if (list?.length === 1 && list[0]) {
      auto.current = true;
      void choose(list[0]);
    }
  }, [list, networks.error]);

  const name = account.data?.name ?? null;
  const contact = account.data?.email?.value ?? account.data?.phone?.value ?? null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full font-semibold text-background text-xs"
          style={{ background: name ? hue("orange") : "var(--color-muted-foreground)" }}
        >
          {initials(name)}
        </div>
        <div className="min-w-0">
          <div className="truncate font-medium text-[13px]">{name ?? "-"}</div>
          <div className="truncate text-2xs text-muted-foreground">{contact ?? "-"}</div>
        </div>
        <Status tone="success" className="ms-auto">
          Signed in
        </Status>
      </div>

      {list && list.length === 0 ? (
        <>
          <Title className="mt-[22px]">No networks yet</Title>
          <Lead>This account has no eero networks yet. Set one up in the eero mobile app, then come back.</Lead>
          <Button variant="outline" className="mt-5 self-start" disabled={logout.running} onClick={() => void logout.run({})}>
            Sign out
          </Button>
          {logout.error && <ErrorLine>{errorText(logout.error)}</ErrorLine>}
        </>
      ) : (
        <>
          <Title className="mt-[22px]">Choose a network</Title>
          <Lead>
            {list ? `Your account has ${plural(list.length, "network")}. ` : ""}You can switch any time from the sidebar.
          </Lead>

          <div role="radiogroup" aria-label="Networks" className={cn("mt-[18px] flex flex-col gap-2 transition-opacity", networks.fading && "opacity-40")}>
            {list?.map((n) => {
              const selected = n.id === current?.id;
              const status = networkStatus(n.status);
              return (
                <button
                  key={n.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setChosen(n.id)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-start outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
                    selected && "border-muted-foreground/60 bg-muted/60",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-4 shrink-0 rounded-full border-[1.5px] border-input", selected && "border-[5px] border-foreground")}
                  />
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground">
                    <House className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-[13px]">
                      {n.name}
                      {n.nickname && n.nickname !== n.name && <span className="font-normal text-2xs text-muted-foreground"> · {n.nickname}</span>}
                    </span>
                    <span className="block truncate text-2xs text-muted-foreground tabular-nums">{detail(n, now)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Status tone={status.tone}>{status.label}</Status>
                    {n.role && <Badge variant="outline">{n.role === "owner" ? "Owner" : "Admin"}</Badge>}
                  </span>
                </button>
              );
            })}
            {!list && !networks.error && (
              <div aria-hidden className="h-[62px] rounded-xl border bg-card opacity-40" />
            )}
          </div>
          {networks.error && networks.error.code !== "unknown_command" && <ErrorLine>{errorText(networks.error)}</ErrorLine>}
          {select.error && <ErrorLine>{errorText(select.error)}</ErrorLine>}

          <div className="min-h-5 flex-1" />
          <BigButton busy={select.running} disabled={!current} onClick={() => current && void choose(current)}>
            {current ? `Continue to ${current.name}` : "Continue"}
            <ArrowRight />
          </BigButton>
        </>
      )}
    </div>
  );
}

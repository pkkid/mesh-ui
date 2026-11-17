/**
 * Account side panel, Sign out and delete (docs/ux/pages/account.md,
 * Side panel 2).
 *
 * - **Sign out** (`auth.logout`): the text says where the session is kept,
 *   from `auth.status` (keychain or memory) and `app.info` (keychain name).
 *   In demo mode the panel says so and offers **Leave demo mode**
 *   (`app.demo.set {enabled: false}`, which relaunches Mesh UI without
 *   `--demo`).
 * - **Delete account and data** (`account.delete`, destructive): a quiet
 *   collapsed row with a chevron, so reaching it takes a deliberate click. It
 *   always starts collapsed (view state, not remembered) and collapses again
 *   after a cancelled confirm. Expanded: the checkbox, then the app's confirm dialog with core's message and type the
 *   account's email (or name), sending `acknowledge: true` and, after the
 *   dialog, `confirm: true`. Disabled with the reason while the account owns
 *   a network; a network with no known role counts as owned, as core's
 *   refusal does. Core signs out afterwards, so the app returns to sign in.
 */
import { ChevronDown, ChevronRight, FlaskConical, LogOut, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { useCommand, useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { GatedButton } from "~/components/ui/page";
import type { Account, AppInfo, AuthStatus, NetworkSummary } from "../../../../core/model";
import { deletePlan, sessionText } from "./sessionAndNetworks";

export function SignOutDelete({ id }: { id?: string }) {
  const auth = useQuery<AuthStatus>("auth.status");
  const info = useQuery<AppInfo>("app.info", undefined, { poll: true });
  const account = useQuery<Account>("account.get", undefined, { poll: true });
  const networks = useQuery<NetworkSummary[]>("network.list", undefined, { poll: 60 });
  const logout = useCommand("auth.logout");
  const leaveDemo = useCommand<{ enabled: boolean }, { demo: boolean; restarting: boolean }>("app.demo.set");
  const demo = auth.data?.backend === "demo";

  return (
    <Card padded id={id} className="flex flex-col gap-4">
      <div className="flex items-center gap-2 font-medium text-sm">
        <LogOut className="size-4 text-muted-foreground" />
        Sign out and delete
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">{sessionText(auth.data, info.data) ?? "-"}</p>
        <div className="flex flex-wrap gap-2">
          {demo && (
            <Button size="sm" variant="outline" disabled={leaveDemo.running || leaveDemo.result?.restarting} onClick={() => void leaveDemo.run({ enabled: false })}>
              <FlaskConical />
              {leaveDemo.result?.restarting ? "Restarting..." : "Leave demo mode"}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={logout.running || !auth.data} onClick={() => void logout.run({})}>
            <LogOut />
            Sign out
          </Button>
        </div>
        {(logout.error ?? leaveDemo.error) && <div className="text-destructive-foreground text-xs">{(logout.error ?? leaveDemo.error)?.message}</div>}
      </div>

      <div className="border-t" />

      <DeleteAccount account={account.data} networks={networks.data} />
    </Card>
  );
}

function DeleteAccount({ account, networks }: { account: Account | undefined; networks: NetworkSummary[] | undefined }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const checkId = useId();
  const bodyId = useId();
  const plan = deletePlan(networks);
  const typeToConfirm = account?.email?.value ?? account?.name ?? undefined;
  const remove = useWrite<{ acknowledge: true }, { deleted: true }>("account.delete", {
    confirm: { title: "Delete your eero account?", confirmLabel: "Delete account", ...(typeToConfirm ? { typeToConfirm } : {}) },
    failure: "Couldn't delete your account",
  });

  const owns = plan.owned.length > 0;
  const reason = owns ? `You own ${plan.owned.length === 1 ? "a network" : `${plan.owned.length} networks`}. Transfer or delete ${plan.owned.length === 1 ? "it" : "them"} first` : null;
  const gate = { allowed: Boolean(networks) && !owns && checked, reason: reason ?? (checked ? null : "Tick the box first") };

  const Chevron = open ? ChevronDown : ChevronRight;
  const toggle = () => {
    setOpen(!open);
    setChecked(false);
  };
  const del = async () => {
    // A cancelled confirm puts the row back to its quiet, collapsed state.
    if ((await remove.run({ acknowledge: true })) === null) {
      setOpen(false);
      setChecked(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        className="-mx-1 flex cursor-pointer items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-start text-foreground/80 text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Chevron className="size-3.5 text-muted-foreground" />
        Delete account and data
      </button>
      {open && (
        <div id={bodyId} className="flex flex-col gap-2 ps-5">
          <p className="text-muted-foreground text-xs">{networks ? plan.text : "Closes your eero account and deletes your personal data."}</p>
          <label htmlFor={checkId} className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              id={checkId}
              type="checkbox"
              checked={checked}
              disabled={owns}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-px size-3.5 shrink-0 cursor-pointer rounded-[4px] border accent-primary disabled:cursor-not-allowed disabled:opacity-60"
            />
            I want to permanently close my account and delete my data
          </label>
          <div>
            <GatedButton size="sm" variant="destructive" gate={gate} disabled={remove.running} onClick={() => void del()}>
              <Trash2 />
              Delete account
            </GatedButton>
          </div>
          {reason && <div className="text-muted-foreground text-xs">{reason}.</div>}
        </div>
      )}
    </div>
  );
}

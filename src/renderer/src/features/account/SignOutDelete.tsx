/**
 * Account settings (docs/ux/pages/account.md, Layout 3): a full-width
 * section at the foot of the page, settings rows in one card: Stay up to
 * date (when eero reports it) and Notifications (AccountHero.tsx EmailRows),
 * then Sign out and Delete account and data, last since they end the session
 * or the account.
 *
 * - **Sign out** (`auth.logout`): the text says where the session is kept,
 *   from `auth.status` (keychain or memory) and `app.info` (keychain name).
 *   In demo mode the panel says so and offers **Leave demo mode**
 *   (`app.demo.set {enabled: false}`, which relaunches Mesh UI without
 *   `--demo`).
 * - **Delete account and data** (`account.delete`, destructive): a row whose
 *   **Delete account…** button only opens the steps under it, so reaching the
 *   delete takes a deliberate click. It always starts closed (view state, not
 *   remembered) and closes again after a cancelled confirm. Expanded: the checkbox, then the app's confirm dialog with core's message and type the
 *   account's email (or name), sending `acknowledge: true` and, after the
 *   dialog, `confirm: true`. Disabled with the reason while the account owns
 *   a network; a network with no known role counts as owned, as core's
 *   refusal does. Core signs out afterwards, so the app returns to sign in.
 */
import { FlaskConical, LogOut, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { useCommand, useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { Row as SettingsRow } from "~/features/advanced/SettingsGroups";
import { GatedButton } from "~/components/ui/page";
import type { Account, AppInfo, AuthStatus, NetworkSummary } from "../../../../core/model";
import { EmailRows } from "./AccountHero";
import { deletePlan, sessionText } from "./sessionAndNetworks";

export function SignOutDelete({ id, emailId, notificationsId }: { id?: string; emailId?: string; notificationsId?: string }) {
  const auth = useQuery<AuthStatus>("auth.status");
  const info = useQuery<AppInfo>("app.info", undefined, { poll: true });
  const account = useQuery<Account>("account.get", undefined, { poll: true });
  const networks = useQuery<NetworkSummary[]>("network.list", undefined, { poll: 60 });
  const logout = useCommand("auth.logout");
  const leaveDemo = useCommand<{ enabled: boolean }, { demo: boolean; restarting: boolean }>("app.demo.set");
  const demo = auth.data?.backend === "demo";

  const description = !auth.data ? "-" : demo ? "Demo mode" : account.data?.email?.value ? `Signed in as ${account.data.email.value}` : "Signed in";

  return (
    <Section id={id} title="Account settings" description={description} className="gap-[15px]">
      <Card className="divide-y divide-border/50">
        <EmailRows emailId={emailId} notificationsId={notificationsId} />
        <SettingsRow
          title={demo ? "Leave demo mode or sign out" : "Sign out"}
          description={
            <>
              {sessionText(auth.data, info.data) ?? "-"}
              {(logout.error ?? leaveDemo.error) && <span className="block text-destructive-foreground">{(logout.error ?? leaveDemo.error)?.message}</span>}
            </>
          }
          control={
            <>
              {demo && (
                <Button variant="outline" className={DIM_ICON} disabled={leaveDemo.running || leaveDemo.result?.restarting} onClick={() => void leaveDemo.run({ enabled: false })}>
                  <FlaskConical />
                  {leaveDemo.result?.restarting ? "Restarting..." : "Leave demo mode"}
                </Button>
              )}
              <Button variant="outline" className={DIM_ICON} disabled={logout.running || !auth.data} onClick={() => void logout.run({})}>
                <LogOut />
                Sign out
              </Button>
            </>
          }
        />
        <DeleteAccount account={account.data} networks={networks.data} />
      </Card>
    </Section>
  );
}

const DIM_ICON = "[&_svg]:text-muted-foreground";

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
    <SettingsRow
      title="Delete account and data"
      description="Closes your eero account and deletes your personal data. It cannot be undone."
      control={
        <Button variant="outline" className={DIM_ICON} aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          {open ? "Cancel" : "Delete account\u2026"}
        </Button>
      }
    >
      {open && (
        <div id={bodyId} className="flex flex-col gap-2">
          {networks && (plan.owned.length > 0 || plan.shared.length > 0) && <p className="text-muted-foreground text-xs">{plan.text.replace(/^Closes your eero account and deletes your personal data\. /, "")}</p>}
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
    </SettingsRow>
  );
}

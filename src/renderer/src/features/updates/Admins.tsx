/**
 * "User permissions": owner, admins and pending invites from `admin.list`,
 * seats used of 10, then "Invite an admin" and "What each role can do".
 * eero sends no email for members, so rows show the name and role only;
 * invites show their nickname. The owner can remove an admin
 * (`admin.remove`, destructive: type the name), cancel or resend an invite
 * (`admin.invite.cancel`, `admin.invite.create`) and create one in the
 * invite sheet, which shows its QR code and link. eero has no endpoint to
 * rename a member, so there is no nickname action. An admin sees the list
 * read only, without invites or the invite card.
 * docs/ux/pages/updates-admins.md (Layout 4 and 5).
 */
import { Crown, Mail, RefreshCw, UserMinus, UserPlus } from "lucide-react";
import { useId, useState } from "react";

import type { QueryState } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { IconTile } from "~/components/ui/hero";
import { Input } from "~/components/ui/input";
import { GatedButton, PlaceholderRows, Row, RowList, SectionError, useGate } from "~/components/ui/page";
import { QrBlock } from "~/components/ui/qr";
import { SheetField } from "~/components/ui/sheet";
import { Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import type { InviteCreated } from "../../../../core/backend";
import { networkClock } from "../../../../core/format";
import type { Admin, AdminList, Invite, Role } from "../../../../core/model";

const initials = (name: string | null): string =>
  (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

function Avatar({ name, pending = false }: { name: string | null; pending?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full font-medium text-muted-foreground text-xs",
        pending ? "border-[1.5px] border-muted-foreground/50 border-dashed" : "bg-muted shadow-[inset_0_0_0_1px_var(--color-border)]",
      )}
    >
      {pending ? <Mail className="size-3.5" /> : initials(name)}
    </div>
  );
}

/** Invite nicknames, as core checks them. */
const NICKNAME_MAX = 32;

export function Admins({ list, timezone, myRole }: { list: QueryState<AdminList>; timezone: string | null; myRole: Role | null }) {
  const d = list.data;
  const owner = myRole === "owner";
  const clock = networkClock(timezone);
  const full = d !== undefined && d.seatsUsed + d.invites.length >= d.seatsMax;
  const inviteGate = useGate("admin.invite.create");
  const cancelGate = useGate("admin.invite.cancel");
  const removeGate = useGate("admin.remove");
  const cancel = useWrite<{ invite: string }>("admin.invite.cancel");
  const remove = useWrite<{ admin: string }>("admin.remove");
  const create = useWrite<{ nickname?: string }, InviteCreated>("admin.invite.create");
  // The invite sheet: open with a nickname to fill in, or with a fresh invite to share.
  const [sheet, setSheet] = useState<{ created: InviteCreated | null; nickname: string } | null>(null);

  const removeAdmin = (a: Admin) => {
    const name = a.name ?? "this admin";
    void remove.run(
      { admin: a.id },
      {
        confirm: { title: `Remove ${name}?`, confirmLabel: "Remove admin", ...(a.name ? { typeToConfirm: a.name } : {}) },
        success: `Removed ${name}`,
        failure: `Couldn't remove ${name}`,
      },
    );
  };

  const cancelInvite = (i: Invite) =>
    cancel.run({ invite: i.id }, { success: `Cancelled the invite${i.nickname ? ` for ${i.nickname}` : ""}`, failure: "Couldn't cancel the invite" });

  // Resend: the old link stops working first (so a full network still has its seat), then a new one with the same nickname.
  const resend = async (i: Invite) => {
    const old = await cancel.run({ invite: i.id }, { failure: "Couldn't cancel the old invite" });
    if (!old?.ok) return;
    const r = await create.run(i.nickname ? { nickname: i.nickname } : {}, { failure: "Couldn't make a new invite" });
    if (r?.ok) setSheet({ created: r.result, nickname: i.nickname ?? "" });
  };

  return (
    <>
      <Section title="User permissions" subtitle={d ? `${d.seatsUsed} of ${d.seatsMax} admin seats used` : null}>
        {list.error && !d ? (
          <SectionError what="admins" error={list.error} onRetry={() => void list.refetch()} />
        ) : !d ? (
          <PlaceholderRows count={2} />
        ) : (
          <RowList className={cn("transition-opacity", list.fading && "opacity-40")}>
            {d.admins.map((a) => (
              <Row key={a.id}>
                <Avatar name={a.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5 truncate font-medium text-sm">
                    {a.name ?? "Unnamed"}
                    {a.isYou && <span className="font-normal text-2xs text-muted-foreground">(you)</span>}
                  </div>
                  <div className="truncate text-muted-foreground text-xs">{a.role === "owner" ? "Owner of this network" : "Can manage the network"}</div>
                </div>
                <Badge variant="secondary">
                  {a.role === "owner" && <Crown />}
                  {a.role === "owner" ? "Owner" : "Admin"}
                </Badge>
                {owner && a.role !== "owner" && (
                  <GatedButton gate={removeGate} size="xs" variant="ghost" disabled={remove.running} onClick={() => removeAdmin(a)} aria-label={`Remove ${a.name ?? "admin"}`}>
                    <UserMinus />
                    Remove
                  </GatedButton>
                )}
              </Row>
            ))}
            {d.invites.map((i) => (
              <Row key={i.id} className="bg-muted/30">
                <Avatar name={null} pending />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-sm">{i.nickname ?? "Admin invite"}</div>
                  <div className="truncate text-muted-foreground text-xs">Invite pending{i.expiresAt ? ` · expires ${clock.dateTime(i.expiresAt)}` : ""}</div>
                </div>
                <Status tone="warning">Pending</Status>
                {owner && (
                  <>
                    <GatedButton gate={inviteGate} size="xs" variant="ghost" disabled={create.running || cancel.running} onClick={() => void resend(i)}>
                      <RefreshCw />
                      Resend
                    </GatedButton>
                    <GatedButton gate={cancelGate} size="xs" variant="outline" disabled={cancel.running} onClick={() => void cancelInvite(i)}>
                      Cancel
                    </GatedButton>
                  </>
                )}
              </Row>
            ))}
          </RowList>
        )}
      </Section>

      <div className={cn("grid items-start gap-4", owner && "lg:grid-cols-2")}>
        {owner && (
          <Card padded className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <IconTile icon={UserPlus} size="sm" />
              <span className="font-medium text-sm">Invite an admin</span>
            </div>
            <p className="text-muted-foreground text-xs">
              {full
                ? "All admin seats are in use."
                : "Make a single-use invite with a nickname, then share its QR code or link. The invitee accepts it in the eero app within 48 hours."}
            </p>
            <div>
              <GatedButton gate={full ? { allowed: false, reason: "All admin seats are in use" } : inviteGate} size="sm" onClick={() => setSheet({ created: null, nickname: "" })}>
                <UserPlus />
                Create invite
              </GatedButton>
            </div>
          </Card>
        )}
        <RolesTable />
      </div>

      {sheet && <InviteSheet initial={sheet} onClose={() => setSheet(null)} />}
    </>
  );
}

/**
 * The invite sheet: a nickname, then Create invite; once made it shows the
 * QR code with Copy link and New code (another single-use link). eero sends
 * no email, so the link is shared by hand.
 */
function InviteSheet({ initial, onClose }: { initial: { created: InviteCreated | null; nickname: string }; onClose: () => void }) {
  const create = useWrite<{ nickname?: string }, InviteCreated>("admin.invite.create");
  const cancel = useWrite<{ invite: string }>("admin.invite.cancel");
  const [nickname, setNickname] = useState(initial.nickname);
  const [created, setCreated] = useState<InviteCreated | null>(initial.created);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const n = nickname.trim();
  const invalid = n.length > NICKNAME_MAX ? `Use at most ${NICKNAME_MAX} characters.` : null;

  const make = async () => {
    setError(null);
    // New code replaces the link on screen: the old one stops working first, so it frees its seat.
    if (created) {
      const old = await cancel.run({ invite: created.invite.id }, { failure: "Couldn't cancel the old invite" });
      if (!old?.ok) return;
      setCreated(null);
    }
    const r = await create.run(n ? { nickname: n } : {}, { form: true, success: n ? `Invite ready for ${n}` : "Invite ready", failure: "Couldn't create the invite" });
    if (r?.ok) setCreated(r.result);
    else if (r) setError(r.error.message);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup align="top" className="w-full max-w-[460px] rounded-[18px]" data-slot="sheet">
        <div className="flex flex-col gap-1 px-5 pt-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4 text-muted-foreground" />
            Invite an admin
          </DialogTitle>
          <DialogDescription className="text-xs">Single use, about 48 hours. The invitee accepts it in the eero app.</DialogDescription>
        </div>
        <form
          className="flex flex-col gap-4 px-5 pt-4 pb-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid && !create.running) void make();
          }}
        >
          <SheetField label="Invitee nickname" htmlFor={inputId} error={invalid ?? error ?? undefined} helper={`${n.length} / ${NICKNAME_MAX}`}>
            <Input id={inputId} value={nickname} placeholder="Jamie" autoComplete="off" onChange={(e) => setNickname(e.target.value)} disabled={created !== null} />
          </SheetField>
          {created ? (
            <QrBlock
              value={created.inviteUrl}
              ariaLabel={`QR code for the admin invite${created.invite.nickname ? ` for ${created.invite.nickname}` : ""}`}
              caption={created.invite.nickname ?? "Admin invite"}
              copyLabel="Copy link"
              copyText={created.inviteUrl}
              actions={
                <Button type="button" size="xs" variant="outline" disabled={create.running} onClick={() => void make()}>
                  <RefreshCw />
                  New code
                </Button>
              }
            />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              {created ? "Done" : "Cancel"}
            </Button>
            {!created && (
              <Button type="submit" size="sm" disabled={!!invalid || create.running}>
                Create invite
              </Button>
            )}
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

const ROLES: [string, boolean, boolean][] = [
  ["See the network, devices and usage", true, true],
  ["Change Wi-Fi and advanced networking", true, true],
  ["Install updates and restart eeros", true, false],
  ["Invite or remove admins", true, false],
  ["Amazon, transfer or delete the network", true, false],
];

function RolesTable() {
  return (
    <Card>
      <table className="w-full text-sm">
        <caption className="px-5 pt-4 pb-2 text-start font-medium text-sm">What each role can do</caption>
        <thead>
          <tr className="border-border/50 border-b text-muted-foreground text-xs">
            <th className="px-5 py-2 text-start font-normal">Capability</th>
            <th className="w-20 py-2 text-center font-normal">Owner</th>
            <th className="w-20 py-2 pe-3 text-center font-normal">Admin</th>
          </tr>
        </thead>
        <tbody>
          {ROLES.map(([label, o, a]) => (
            <tr key={label} className="border-border/50 border-b last:border-0">
              <td className="px-5 py-2 text-foreground/80 text-xs">{label}</td>
              <td className="py-2 text-center text-xs">{o ? "Yes" : "No"}</td>
              <td className="py-2 pe-3 text-center text-muted-foreground text-xs">{a ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

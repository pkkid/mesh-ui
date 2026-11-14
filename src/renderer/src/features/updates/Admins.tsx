/**
 * "User permissions": owner, admins and pending invites from `admin.list`,
 * seats used of 10, then "Invite an admin" and "What each role can do".
 * eero sends no email for members, so rows show the name and role only;
 * invites show their nickname. Invite, resend, cancel, nickname and remove
 * are disabled "Coming soon" until their commands land (M5). An admin sees
 * the list read only, without invites or the invite card.
 * docs/ux/pages/updates-admins.md (Layout 4 and 5).
 */
import { Crown, Ellipsis, Mail, UserPlus } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Card, Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { ComingSoonButton, PlaceholderRows, Row, RowList, SectionError } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { networkClock } from "../../../../core/format";
import type { AdminList, Role } from "../../../../core/model";
import type { QueryState } from "~/app/useCommand";

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

export function Admins({ list, timezone, myRole }: { list: QueryState<AdminList>; timezone: string | null; myRole: Role | null }) {
  const d = list.data;
  const owner = myRole === "owner";
  const clock = networkClock(timezone);
  const full = d !== undefined && d.seatsUsed >= d.seatsMax;

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
                  <ComingSoonButton size="icon-xs" variant="ghost" aria-label={`${a.name ?? "Admin"} menu`}>
                    <Ellipsis />
                  </ComingSoonButton>
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
                    <ComingSoonButton size="xs" variant="ghost">
                      Resend
                    </ComingSoonButton>
                    <ComingSoonButton size="xs" variant="outline">
                      Cancel
                    </ComingSoonButton>
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
                : "Make a single-use invite with a nickname, then share its QR code or link. The invitee accepts it in the eero app or Mesh UI within 48 hours."}
            </p>
            <div>
              <ComingSoonButton size="sm">
                <UserPlus />
                Create invite
              </ComingSoonButton>
            </div>
          </Card>
        )}
        <RolesTable />
      </div>
    </>
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

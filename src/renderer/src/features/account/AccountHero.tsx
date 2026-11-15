/**
 * App & account hero and Account section (docs/ux/pages/app-account.md,
 * Layout 1 and 2). Skeleton from M6.1: name, contact lines and the signed-in
 * state from `account.get`. M6.7 adds the account writes (name, email,
 * mobile, Stay up to date).
 */
import { useQuery } from "~/app/useCommand";
import { Avatar } from "~/components/ui/avatar";
import { Card, Section } from "~/components/ui/card";
import { Status } from "~/components/ui/status";
import type { Account } from "../../../../core/model";

export function AccountHero({ id }: { id?: string }) {
  const account = useQuery<Account>("account.get", undefined, { poll: true });
  const a = account.data;
  const contact = (c: Account["email"]) => (c ? `${c.value} · ${c.verified ? "Verified" : "Unverified"}` : "-");
  return (
    <section id={id} className="flex items-center gap-4">
      <Avatar name={a?.name} size="lg" />
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="truncate font-semibold text-xl tracking-tight">{a?.name ?? "-"}</h1>
          {a && <Status tone="success">Signed in</Status>}
        </div>
        <div className="mt-1 truncate text-muted-foreground text-xs">{contact(a?.email ?? null)}</div>
        <div className="truncate text-muted-foreground text-xs">{contact(a?.phone ?? null)}</div>
      </div>
    </section>
  );
}

export function EmailPreferences({ id }: { id?: string }) {
  return (
    <Section id={id} title="Account" subtitle="Email preferences">
      <Card padded className="text-muted-foreground text-xs">
        Product news by email.
      </Card>
    </Section>
  );
}

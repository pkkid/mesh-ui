/**
 * Account & Settings hero and Account section (docs/ux/pages/account-settings.md,
 * Layout 1 and 2): the shared Avatar, the name with `Signed in`, email and
 * mobile with Verified or Unverified, and the account writes. Edit name and
 * Change email or mobile open CodeDialog (the value, then eero's code); an
 * unverified address or number opens it at the code step. Stay up to date
 * is `account.consents.set` with Undo; the Notifications row under it opens
 * the notification settings sheet. Against the real eero API the writes
 * answer "not available yet" until a live-tested request is known
 * (docs/eero-api/endpoints.md section 20); the toast says so.
 */
import { Mail, Megaphone, Pencil, Smartphone } from "lucide-react";
import { useState } from "react";

import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { useGate } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { SwitchRow } from "~/features/notifications/NotificationSettings";
import { cn } from "~/lib/utils";
import type { Account } from "../../../../core/model";
import { CodeDialog } from "./CodeDialog";
import { NotificationsRow } from "./NotificationsRow";

type Open = "name" | "email" | "email-code" | "phone" | "phone-code" | null;

export function AccountHero({ id }: { id?: string }) {
  const account = useQuery<Account>("account.get", undefined, { poll: true });
  const gate = useGate("account.name.set");
  const [open, setOpen] = useState<Open>(null);
  const a = account.data;
  const close = () => setOpen(null);
  const usable = !!a && gate.allowed;

  const phoneAction = !a?.phone ? "Add mobile" : a.phone.verified ? "Change mobile" : "Verify mobile";
  const emailAction = a?.email && !a.email.verified ? "Verify email" : "Change email";

  return (
    <section id={id} className={cn("flex items-start gap-4", account.fading && "opacity-40")}>
      <Avatar name={a?.name} size="lg" />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="truncate font-semibold text-xl tracking-tight">{a?.name ?? "-"}</h1>
          {a && <Status tone="success">Signed in</Status>}
        </div>
        <Contact contact={a?.email ?? null} />
        <Contact contact={a?.phone ?? null} />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!usable} title={gate.reason ?? undefined} onClick={() => setOpen("name")}>
            <Pencil />
            Edit name
          </Button>
          <Button size="sm" variant="outline" disabled={!usable} title={gate.reason ?? undefined} onClick={() => setOpen(emailAction === "Verify email" ? "email-code" : "email")}>
            <Mail />
            {emailAction}
          </Button>
          <Button size="sm" variant="outline" disabled={!usable} title={gate.reason ?? undefined} onClick={() => setOpen(phoneAction === "Verify mobile" ? "phone-code" : "phone")}>
            <Smartphone />
            {phoneAction}
          </Button>
        </div>
      </div>
      {open === "name" && (
        <CodeDialog
          title="Edit name"
          description="The name on your eero account, shown in the eero app and to people you share networks with."
          field={{
            command: "account.name.set",
            param: "name",
            label: "Name",
            type: "text",
            initial: a?.name ?? "",
            submitLabel: "Save",
            success: (v) => `Renamed to ${v}`,
            ...(a?.name ? { undo: { id: "account.name.set", params: { name: a.name } } } : {}),
          }}
          onClose={close}
        />
      )}
      {(open === "email" || open === "email-code") && (
        <CodeDialog
          title="Change email"
          description="eero sends a 6 digit code to the new address. It stays unverified until you enter the code; you sign in with it afterwards."
          field={
            open === "email"
              ? { command: "account.email.set", param: "email", label: "New email", type: "email", placeholder: "name@example.com", submitLabel: "Send code" }
              : undefined
          }
          verify={{ command: "account.email.verify", via: "email", sentTo: open === "email-code" ? a?.email?.value : undefined, success: "Email verified" }}
          onClose={close}
        />
      )}
      {(open === "phone" || open === "phone-code") && (
        <CodeDialog
          title={a?.phone ? "Change mobile" : "Add mobile"}
          description="eero texts a 6 digit code to the number. Use the international form with the country code."
          field={
            open === "phone"
              ? { command: "account.phone.set", param: "phone", label: "Mobile number", type: "tel", placeholder: "+15550100142", submitLabel: "Send code" }
              : undefined
          }
          verify={{ command: "account.phone.verify", via: "text", sentTo: open === "phone-code" ? a?.phone?.value : undefined, success: "Mobile verified" }}
          onClose={close}
        />
      )}
    </section>
  );
}

function Contact({ contact }: { contact: Account["email"] }) {
  if (!contact) return <div className="text-muted-foreground text-xs">-</div>;
  return (
    <div className="flex min-w-0 items-center gap-3 text-xs">
      <span className="truncate text-foreground/90 tabular-nums">{contact.value}</span>
      <Status tone={contact.verified ? "success" : "warning"}>{contact.verified ? "Verified" : "Unverified"}</Status>
    </div>
  );
}

export function EmailPreferences({ id, notificationsId }: { id?: string; notificationsId?: string }) {
  const account = useQuery<Account>("account.get", undefined, { poll: true });
  const gate = useGate("account.consents.set");
  const write = useWrite<{ marketingEmails: boolean }, Account>("account.consents.set", { failure: "Couldn't change email preferences" });
  const on = account.data?.marketingEmails;
  return (
    <Section id={id} title="Account" subtitle="Email preferences and alerts">
      <Card className="divide-y divide-border/50 px-4">
        <SwitchRow
          className={cn(account.fading && "opacity-40")}
          icon={<Megaphone />}
          label="Stay up to date"
          detail="Product news and tips by email"
          on={on}
          disabled={!gate.allowed || write.running}
          title={gate.reason ?? undefined}
          onChange={(next) =>
            void write.run(
              { marketingEmails: next },
              { success: next ? "Product news emails on" : "Product news emails off", undo: { id: "account.consents.set", params: { marketingEmails: !next } } },
            )
          }
        />
        <NotificationsRow id={notificationsId} />
      </Card>
    </Section>
  );
}

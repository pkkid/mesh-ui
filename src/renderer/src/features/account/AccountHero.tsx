/**
 * Account hero and the email and alert rows of Account settings
 * (docs/ux/pages/account.md, Layout 1 and 3). The hero is the flat page header with no avatar: the name, `Signed
 * in` with how (email, mobile, Amazon), the email and mobile as facts with
 * Verified or Unverified, and the account writes. Edit name and
 * Change email or mobile open CodeDialog (the value, then eero's code); an
 * unverified address or number opens it at the code step. Stay up to date
 * is `account.consents.set` with Undo; the Notifications row under it opens
 * the notification settings sheet. Against the real eero API the writes
 * answer "not available yet" until a live-tested request is known
 * (docs/eero-api/endpoints.md section 20); the toast says so.
 */
import { Mail, Pencil, Smartphone } from "lucide-react";
import { useState } from "react";

import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Metric, PageHeader } from "~/components/ui/hero";
import { useGate } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { Row as SettingsRow, WriteSwitch } from "~/features/advanced/SettingsGroups";
import { notificationSummary, useSelectedNetwork } from "~/features/notifications/NotificationSettings";
import { cn } from "~/lib/utils";
import type { Account, NotificationSettings } from "../../../../core/model";
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
    <>
      <PageHeader
        flat
        id={id}
        data-slot="account-hero"
        className={cn("transition-opacity", account.fading && !a && "opacity-40")}
        title={a?.name ?? "Account"}
        status={
          a ? (
            <>
              <Status tone="success">Signed in</Status>
              {a.authType && <span>With {AUTH_WORD[a.authType]}</span>}
            </>
          ) : null
        }
        facts={
          <>
            <Metric label="Email" value={a ? <Contact contact={a.email} /> : null} />
            <Metric label="Mobile" value={a ? <Contact contact={a.phone} /> : null} />
          </>
        }
        actions={
          <>
            <Button variant="outline" className={DIM_ICON} disabled={!usable} title={gate.reason ?? undefined} onClick={() => setOpen("name")}>
              <Pencil />
              Edit name{"\u2026"}
            </Button>
            <Button variant="outline" className={DIM_ICON} disabled={!usable} title={gate.reason ?? undefined} onClick={() => setOpen(emailAction === "Verify email" ? "email-code" : "email")}>
              <Mail />
              {emailAction}
              {"\u2026"}
            </Button>
            <Button variant="outline" className={DIM_ICON} disabled={!usable} title={gate.reason ?? undefined} onClick={() => setOpen(phoneAction === "Verify mobile" ? "phone-code" : "phone")}>
              <Smartphone />
              {phoneAction}
              {"\u2026"}
            </Button>
          </>
        }
      />
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
    </>
  );
}

const DIM_ICON = "[&_svg]:text-muted-foreground";
const AUTH_WORD: Record<NonNullable<Account["authType"]>, string> = { email: "email", phone: "mobile", amazon: "Amazon" };

/** An address or number as a hero fact: the value, then Verified or Unverified muted after it. */
function Contact({ contact }: { contact: Account["email"] }) {
  if (!contact) return <>-</>;
  return (
    <>
      {contact.value}
      <span className={cn("font-normal text-xs", contact.verified ? "text-muted-foreground" : "text-warning-foreground")}> · {contact.verified ? "Verified" : "Unverified"}</span>
    </>
  );
}

/**
 * The email and alert rows at the top of Account settings: Stay up to date
 * (product news emails, a switch) and Notifications (a sheet). eero's real
 * API sends no `consents.marketing_emails` (read-only check 2026-11-21) and
 * has no known write for it, so Stay up to date shows only when eero reports
 * the setting (the demo does).
 */
export function EmailRows({ emailId, notificationsId }: { emailId?: string; notificationsId?: string }) {
  const account = useQuery<Account>("account.get", undefined, { poll: true });
  const gate = useGate("account.consents.set");
  const write = useWrite<{ marketingEmails: boolean }, Account>("account.consents.set", { failure: "Couldn't change email preferences" });
  const on = account.data?.marketingEmails;
  const networkId = useSelectedNetwork()?.id ?? null;
  const alerts = useQuery<NotificationSettings>("notifications.settings.get", networkId ? { networkId } : undefined, { enabled: networkId !== null });
  const summary = alerts.data ? notificationSummary(alerts.data) : null;
  return (
    <>
      {typeof on === "boolean" && (
        <div id={emailId}>
          <SettingsRow
            title="Stay up to date" when="marketingEmails"
            description="Product news and tips from eero by email."
            control={
              <WriteSwitch
                on={on}
                label="Stay up to date"
                gate={gate}
                busy={write.running}
                onToggle={(next) =>
                  void write.run(
                    { marketingEmails: next },
                    { success: next ? "Product news emails on" : "Product news emails off", undo: { id: "account.consents.set", params: { marketingEmails: !next } } },
                  )
                }
              />
            }
          />
        </div>
      )}
      <NotificationsRow id={notificationsId} summary={summary} error={alerts.error !== null && !alerts.data} />
    </>
  );
}

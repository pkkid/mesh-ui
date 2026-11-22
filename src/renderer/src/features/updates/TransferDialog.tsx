/**
 * "Transfer network" (owner only): the four steps, the danger note and
 * Start transfer, which opens the transfer sheet: the warning, the recipient's name, an
 * email or a phone number (eero sends the transfer there; the clients send
 * exactly one), and the network name typed to confirm. The typed name is
 * the confirm, sent with `confirm: true`, so there is no second ask. After
 * it runs the section says it is waiting for the recipient. The sheet's
 * Start transfer is red, as `network.transfer` is `destructive`.
 * Unavailable networks (no `ownership_transfer` capability, or no
 * permission) show the reason and no button.
 * docs/ux/pages/updates-admins.md (Layout 6).
 */
import { ArrowRightLeft } from "lucide-react";
import { useId, useState } from "react";

import { defaultDeps, fieldErrors, performWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { GatedButton, useGate } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { Status } from "~/components/ui/status";
import type { Network } from "../../../../core/model";

type Sent = { recipient: string; sentTo: string };

const VIA = [
  { value: "email", label: "By email" },
  { value: "phone", label: "By text message" },
] as const;

const STEPS: [string, string][] = [
  ["Review", "Admins and settings move with the network; subscriptions do not."],
  ["Confirm", "Type the network name."],
  ["eero sends it", "To the recipient's email or phone."],
  ["Recipient accepts", "They become the owner; you stay on as an admin."],
];

export function TransferNetwork({ network }: { network: Network }) {
  const gate = useGate("network.transfer");
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const name = network.nickname ?? network.name;

  return (
    <Section
      title="Transfer network" when="owner"
      description={`Hand ${name} to someone else; owner only`}
      className="gap-[15px]"
    >
      <Card padded className="flex flex-col gap-4">
        <ol className="grid gap-3 sm:grid-cols-4">
          {STEPS.map(([title, detail], i) => (
            <li key={title} className="flex gap-2.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted font-medium text-2xs tabular-nums">{i + 1}</span>
              <div className="min-w-0">
                <div className="font-medium text-xs">{title}</div>
                <div className="text-2xs text-muted-foreground">{detail}</div>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-foreground/80 text-xs">This cannot be undone. Not available on ISP or installer managed networks.</p>
        {sent ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Status tone="info">Waiting for the recipient</Status>
            <span className="text-muted-foreground">
              Sent to {sent.recipient} at {sent.sentTo}
            </span>
          </div>
        ) : gate.allowed ? (
          <div>
            <Button variant="destructive" onClick={() => setOpen(true)}>
              <ArrowRightLeft />
              Start transfer{"\u2026"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <GatedButton gate={gate} variant="destructive">
              <ArrowRightLeft />
              Start transfer{"\u2026"}
            </GatedButton>
            <span className="text-muted-foreground text-xs">{gate.reason}</span>
          </div>
        )}
      </Card>
      {open && (
        <TransferSheet
          networkName={name}
          onClose={() => setOpen(false)}
          onSent={(s) => {
            setSent(s);
            setOpen(false);
          }}
        />
      )}
    </Section>
  );
}

function TransferSheet({ networkName, onClose, onSent }: { networkName: string; onClose: () => void; onSent: (s: Sent) => void }) {
  const [recipient, setRecipient] = useState("");
  const [via, setVia] = useState<"email" | "phone">("email");
  const [contact, setContact] = useState("");
  const [typed, setTyped] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ids = { name: useId(), contact: useId(), confirm: useId() };
  const matches = typed.trim() === networkName.trim();
  const ready = recipient.trim() !== "" && contact.trim() !== "" && matches;

  const start = async () => {
    setErrors({});
    const r = await performWrite<Record<string, unknown>, Sent>(
      {
        id: "network.transfer",
        params: { name: recipient.trim(), [via]: contact.trim(), networkName: typed, confirm: true },
        form: true,
        success: (s) => `Transfer sent to ${s.recipient}`,
        failure: "Couldn't start the transfer",
      },
      // The typed name was the confirm.
      { ...defaultDeps, ask: async () => true },
    );
    if (r?.ok) onSent(r.result);
    else if (r) setErrors(fieldErrors(r.error));
    return r;
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Transfer network"
      subtitle={`Hand ${networkName} to someone else`}
      onSave={start}
      dirty={ready}
      saveLabel="Start transfer"
      saves={["network.transfer"]}
    >
      <p className="text-foreground/80 text-sm">
        The recipient becomes the owner once they accept. Admins and settings move; subscriptions do not. You stay on as an admin. This cannot be undone.
      </p>
      <SheetField label="Recipient's name" htmlFor={ids.name} error={errors.name}>
        <Input id={ids.name} value={recipient} autoComplete="off" onChange={(e) => setRecipient(e.target.value)} />
      </SheetField>
      <SheetField
        label={via === "email" ? "Recipient's email" : "Recipient's phone"}
        htmlFor={ids.contact}
        error={errors[via]}
        aside={
          <Select
            items={VIA}
            value={via}
            onValueChange={(v) => {
              if (v !== "email" && v !== "phone") return;
              setVia(v);
              setContact("");
            }}
          >
            <SelectTrigger size="tool" aria-label="Send the transfer by">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {VIA.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      >
        <Input
          id={ids.contact}
          type={via === "email" ? "email" : "tel"}
          value={contact}
          placeholder={via === "email" ? "name@example.com" : "+1 555 010 0199"}
          autoComplete="off"
          onChange={(e) => setContact(e.target.value)}
        />
      </SheetField>
      <SheetField label={`Type "${networkName}" to continue`} htmlFor={ids.confirm} error={errors.networkName ?? errors._form}>
        <Input id={ids.confirm} value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
      </SheetField>
    </Sheet>
  );
}

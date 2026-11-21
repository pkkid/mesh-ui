/**
 * Get help, from `support.info`, at the foot of Troubleshooting beside
 * Status light colors: one plain card of label and value lines, no row
 * dividers. The support center (its address, opened in the browser), eero's
 * support email with Copy and eero's phone number, all from eero's
 * `{net}/support`, each left out when eero sends nothing; no ISP contact
 * (eero gives only the ISP's name). Then the Support ID and Network ID (from
 * `network.get`) with Copy, and Copy diagnostics report (`support.report`,
 * redacted in core), with a footnote on the redaction.
 * docs/ux/pages/troubleshooting.md (Get help).
 */
import { Check, ClipboardCopy, Copy, ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { execute, type QueryState, useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { copyText } from "~/lib/clipboard";
import { Footnote, SectionError } from "~/components/ui/page";
import { CopyCommandButton } from "~/features/internet/Connection";
import { cn } from "~/lib/utils";
import type { Network, SupportInfo } from "../../../../core/model";

/** "+18775550123" as "(877) 555-0123"; other numbers as sent. */
export function formatPhone(phone: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone.replace(/[\s()-]/g, ""));
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

/** A link that leaves the app: dim like a section link, with the external-link icon (design-system.md, Buttons and links). */
function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <ExternalLink className="size-3.5" />
    </a>
  );
}

/** "https://support.eero.com/hc/en-us/" as "support.eero.com/hc/en-us": the address without its scheme or trailing slash. */
const bareUrl = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

const value = (text: ReactNode, mono = false) => <span className={cn("text-[13px] tabular-nums", mono && "font-mono")}>{text}</span>;

async function loadReport(): Promise<string | null> {
  const r = await execute<string>("support.report");
  return r.ok ? r.result : null;
}

/** A plain grey copy icon right after a value, no label or outline; a check for a moment once copied. */
function InlineCopy({ text, what }: { text: string; what: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <Button size="icon-xs" variant="ghost-muted" aria-label={`Copy ${what}`} title={`Copy ${what}`} onClick={() => void copyText(text).then((ok) => setDone(ok))}>
      {done ? <Check /> : <Copy />}
    </Button>
  );
}

/** One line of the Get help card: the label on the left, the value and its button on the right. 28px, like the light rows beside it. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-3">
      <span className="flex-1 font-medium text-[13px]">{label}</span>
      {/* The value and its copy icon sit close, so the icon reads as part of the value. */}
      <span className="flex items-center gap-1">{children}</span>
    </div>
  );
}

export function GetHelp({ query }: { query: QueryState<SupportInfo> }) {
  const s = query.data;
  // The selected network's id, for support to find it.
  const networkId = useQuery<Network>("network.get").data?.id ?? null;
  const help = s?.eero.helpUrl ?? null;
  const email = s?.eero.email ?? null;
  const phone = s?.eero.phone ?? null;
  const who = s?.eero.name && s.eero.name.toLowerCase() !== "eero" ? s.eero.name : "eero";
  return (
    <Section title="Get help" className="gap-[15px]">
      {query.error && !s ? (
        <SectionError what="support contacts" error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {/* One plain card, no row dividers; a row eero sends nothing for is left out. */}
          <Card padded className={cn("flex flex-col gap-1 transition-opacity", query.fading && "opacity-40")}>
            <Line label="Support center">{help ? <OutLink href={help}>{bareUrl(help)}</OutLink> : value("-")}</Line>
            {email && (
              <Line label="Email support">
                {value(email)}
                <InlineCopy text={email} what="email address" />
              </Line>
            )}
            {phone && (
              <Line label={`Call ${who}`}>
                {value(formatPhone(phone))}
                <InlineCopy text={formatPhone(phone)} what="phone number" />
              </Line>
            )}
            <Line label="Support ID">
              {value(s?.supportId ?? "-", true)}
              {s?.supportId && <InlineCopy text={s.supportId} what="Support ID" />}
            </Line>
            <Line label="Network ID">
              {value(networkId ?? "-", true)}
              {networkId && <InlineCopy text={networkId} what="Network ID" />}
            </Line>
            <Line label="Diagnostics report">
              <CopyCommandButton load={loadReport} idle="Copy report" done="Report copied" icon={<ClipboardCopy />} className="[&_svg]:text-muted-foreground" />
            </Line>
          </Card>
          <Footnote>
            The support center, email and phone number come from eero's API for your network. The diagnostics report shows only the last four characters of names, serials, MAC and IP
            addresses.
          </Footnote>
        </>
      )}
    </Section>
  );
}

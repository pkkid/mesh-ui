/**
 * Get help, from `support.info`: support center and email links (opened in
 * the browser), eero and ISP phone numbers, the Support ID with Copy, and
 * Copy diagnostics report (`support.report`, redacted in core).
 * docs/ux/pages/troubleshooting.md (Get help), mockup 16.
 */
import { ClipboardCopy, Copy, ExternalLink, Mail, Phone } from "lucide-react";
import type { ReactNode } from "react";

import { execute, type QueryState } from "~/app/useCommand";
import { Card } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { CopyCommandButton } from "~/features/internet/Connection";
import { cn } from "~/lib/utils";
import type { SupportInfo } from "../../../../core/model";

/** "+18775550123" as "(877) 555-0123"; other numbers as sent. */
export function formatPhone(phone: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone.replace(/[\s()-]/g, ""));
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

function LinkRow({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted/50 [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      <span className="flex-1">{children}</span>
      <ExternalLink className="size-3.5!" />
    </a>
  );
}

function PhoneRow({ label, phone }: { label: string; phone: string }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
      <Phone />
      <span className="flex-1">{label}</span>
      <span className="text-muted-foreground text-xs tabular-nums">{formatPhone(phone)}</span>
    </div>
  );
}

async function loadReport(): Promise<string | null> {
  const r = await execute<string>("support.report");
  return r.ok ? r.result : null;
}

export function SupportCard({ query }: { query: QueryState<SupportInfo> }) {
  const s = query.data;
  if (query.error && !s) return <SectionError what="support contacts" error={query.error} onRetry={() => void query.refetch()} />;
  const help = s?.eero.helpUrl;
  const mail = s?.eero.emailFormUrl ?? s?.eero.contactUrl;
  const who = s?.eero.name && s.eero.name.toLowerCase() !== "eero" ? s.eero.name : "eero";
  return (
    <Card className={cn("flex flex-col transition-opacity", query.fading && "opacity-40")}>
      <div className="px-4 pt-3.5 pb-2">
        <div className="font-medium text-sm">Get help</div>
        <div className="text-muted-foreground text-xs">{who} support and your ISP</div>
      </div>
      <div className="flex flex-col divide-y border-t">
        {help && (
          <LinkRow href={help} icon={<ExternalLink />}>
            Support center
          </LinkRow>
        )}
        {mail && (
          <LinkRow href={mail} icon={<Mail />}>
            Email support
          </LinkRow>
        )}
        {s?.eero.phone && <PhoneRow label={`Call ${who}`} phone={s.eero.phone} />}
        {s?.isp && (s.isp.phone ? <PhoneRow label={`${s.isp.name ?? "ISP"} support`} phone={s.isp.phone} /> : s.isp.url ? (
          <LinkRow href={s.isp.url} icon={<ExternalLink />}>{`${s.isp.name ?? "ISP"} support`}</LinkRow>
        ) : (
          <div className="flex items-center gap-2.5 px-4 py-2.5 text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
            <Phone />
            <span className="flex-1">{s.isp.name ?? "ISP"} support</span>
            <span className="text-muted-foreground text-xs">Number on your bill</span>
          </div>
        ))}
        <div className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
          <span className="flex-1">Support ID</span>
          <span className="font-mono text-xs tabular-nums">{s?.supportId ?? "-"}</span>
          {s?.supportId && <CopyCommandButton load={async () => s.supportId} idle="Copy" done="Copied" icon={<Copy />} />}
        </div>
        <div className="px-4 py-3">
          <CopyCommandButton load={loadReport} idle="Copy diagnostics report" done="Report copied" icon={<ClipboardCopy />} />
          <p className="mt-1.5 text-2xs text-muted-foreground">Names, serials, MAC and IP addresses show only their last four characters.</p>
        </div>
      </div>
    </Card>
  );
}

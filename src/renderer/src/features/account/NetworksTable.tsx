/**
 * App & account, Networks on this account (docs/ux/pages/app-account.md,
 * Layout 4). Skeleton from M6.1; M6.8 adds the table and switching.
 */
import { Card, Section } from "~/components/ui/card";

export function NetworksTable({ id }: { id?: string }) {
  return (
    <Section id={id} title="Networks on this account">
      <Card padded className="text-muted-foreground text-xs">
        Every network you own or help run.
      </Card>
    </Section>
  );
}

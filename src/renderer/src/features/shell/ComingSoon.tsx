/**
 * The placeholder every route renders until its page is built: the page
 * header with the route's icon and title, and one muted sentence. Detail
 * routes say which item was asked for.
 */
import type { ReactNode } from "react";

import type { RouteDef } from "~/app/routes";
import { Card, Empty, Section } from "~/components/ui/card";
import { PageHeader } from "~/components/ui/hero";
import { Status } from "~/components/ui/status";

type ComingSoonProps = {
  route: RouteDef;
  params?: Readonly<Record<string, string>>;
  /** Anything a placeholder page already offers (App & account keeps Appearance). */
  children?: ReactNode;
};

export function ComingSoon({ route, params = {}, children }: ComingSoonProps) {
  const ids = Object.values(params);
  return (
    <>
      <PageHeader
        icon={route.icon}
        title={route.title}
        status={
          <>
            <Status tone="muted">Coming soon</Status>
            <span>{ids.length > 0 ? `Item ${ids.join(", ")}` : "This page is not built yet."}</span>
          </>
        }
      />
      {children ?? (
        <Section title="Nothing here yet">
          <Card>
            <Empty>
              {route.title} arrives in a later milestone. Its design is in docs/ux/pages/{route.doc}.
            </Empty>
          </Card>
        </Section>
      )}
    </>
  );
}

/**
 * App & account side panel, Sign out and delete (docs/ux/pages/app-account.md,
 * Side panel 2). Skeleton from M6.1; M6.8 adds Sign out and Delete account.
 */
import { Card } from "~/components/ui/card";

export function SignOutDelete({ id }: { id?: string }) {
  return (
    <Card padded id={id}>
      <div className="font-medium text-sm">Sign out and delete</div>
      <p className="mt-1 text-muted-foreground text-xs">Where your session is kept, and closing your eero account.</p>
    </Card>
  );
}

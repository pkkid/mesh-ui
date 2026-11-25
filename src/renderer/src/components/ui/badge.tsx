// Adapted from T3 Code's components/ui/badge.tsx (MIT).
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";
import type { Eero } from "../../../../core/model";

const badgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm px-1.5 font-medium text-xs [&_svg]:size-3 [&_svg]:shrink-0",
  {
    defaultVariants: { variant: "secondary" },
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border border-input bg-background text-foreground dark:bg-input/32",
        success: "bg-success/8 text-success-foreground dark:bg-success/16",
        warning: "bg-warning/8 text-warning-foreground dark:bg-warning/16",
        error: "bg-destructive/8 text-destructive-foreground dark:bg-destructive/16",
        info: "bg-info/8 text-info-foreground dark:bg-info/16",
      },
    },
  },
);

type BadgeProps = React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

/**
 * "Gateway" beside an eero's name: plain dim text, no pill or outline
 * (design-system.md, Components). Every place that marks the gateway uses it.
 */
function GatewayLabel() {
  return <span className="shrink-0 font-normal text-muted-foreground text-xs">Gateway</span>;
}

/**
 * The eero's role beside its name, in the same dim text: "Gateway", or
 * "eero Built-in" for an Echo extending the mesh; nothing for other eeros.
 */
function EeroRoleLabel({ eero }: { eero: Pick<Eero, "isGateway" | "kind"> }) {
  if (eero.isGateway) return <GatewayLabel />;
  if (eero.kind !== "builtin") return null;
  return <span className="shrink-0 font-normal text-muted-foreground text-xs">eero Built-in</span>;
}

export { EeroRoleLabel, GatewayLabel };

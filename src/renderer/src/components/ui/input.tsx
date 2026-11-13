// Adapted from T3 Code's components/ui/input.tsx (MIT).
import type * as React from "react";

import { cn } from "~/lib/utils";

type InputProps = React.ComponentProps<"input"> & { icon?: React.ReactNode };

function Input({ className, icon, ...props }: InputProps) {
  return (
    <span
      data-slot="input-control"
      className={cn(
        "relative inline-flex w-full items-center rounded-lg border border-input bg-background text-sm text-foreground shadow-xs/5 ring-ring/24 transition-shadow has-focus-visible:border-ring has-focus-visible:ring-[3px] has-disabled:opacity-64 has-aria-invalid:border-destructive/36 dark:bg-input/32",
        className,
      )}
    >
      {icon && <span className="pointer-events-none ps-2.5 text-muted-foreground [&_svg]:size-4">{icon}</span>}
      <input
        data-slot="input"
        className={cn(
          "h-8 w-full min-w-0 rounded-[inherit] bg-transparent px-[calc(--spacing(3)-1px)] outline-none placeholder:text-placeholder",
          icon && "ps-2",
          props.type === "search" && "[&::-webkit-search-cancel-button]:appearance-none",
        )}
        {...props}
      />
    </span>
  );
}

export { Input, type InputProps };

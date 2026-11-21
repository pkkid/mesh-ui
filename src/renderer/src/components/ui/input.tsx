// Adapted from T3 Code's components/ui/input.tsx (MIT).
import type * as React from "react";
import { use } from "react";

import { ButtonSizeContext, SECTION_TOOL_SIZE } from "~/components/ui/button";
import { cn } from "~/lib/utils";

type InputProps = React.ComponentProps<"input"> & { icon?: React.ReactNode };

/**
 * In a section header's tools slot (where `Section` sets the `tool` button size) an input is 28px outside (border
 * included) with 12px text and a 14px icon, the same height as the buttons and dropdowns beside it (design-system.md, Header tools are 28px).
 * Elsewhere it is the default 32px.
 */
function Input({ className, icon, ...props }: InputProps) {
  const tool = use(ButtonSizeContext) === SECTION_TOOL_SIZE;
  return (
    <span
      data-slot="input-control"
      className={cn(
        "relative inline-flex w-full items-center rounded-lg border border-input bg-background text-foreground shadow-xs/5 ring-ring/24 transition-shadow has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-inset has-disabled:opacity-64 has-aria-invalid:border-destructive/36 dark:bg-input/32",
        tool ? "text-xs" : "text-sm",
        className,
      )}
    >
      {icon && <span className={cn("pointer-events-none ps-2.5 text-muted-foreground", tool ? "[&_svg]:size-3.5" : "[&_svg]:size-4")}>{icon}</span>}
      <input
        data-slot="input"
        className={cn(
          // The field's 1px border sits around the input, so the input is 2px shorter than the control: 28px outside in
          // a header (like the `tool` buttons), 32px elsewhere (like default buttons and selects), as the Devices filter has it.
          tool ? "h-[26px]" : "h-[30px]",
          "w-full min-w-0 rounded-[inherit] bg-transparent px-[calc(--spacing(3)-1px)] outline-none placeholder:text-placeholder",
          icon && "ps-2",
          props.type === "search" && "[&::-webkit-search-cancel-button]:appearance-none",
        )}
        {...props}
      />
    </span>
  );
}

export { Input, type InputProps };

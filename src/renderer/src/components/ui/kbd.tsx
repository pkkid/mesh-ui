// A key hint ("Ctrl K", "↵", "Esc"): the label centred in its key cap. Monospace fonts sit high in their line box,
// so the cap uses "Mesh Mono Field" metrics (index.css) and a 1:1 line height to centre the glyphs.
import type * as React from "react";

import { cn } from "~/lib/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-input bg-muted px-1.5 font-kbd text-[10.5px] text-muted-foreground leading-none shadow-[0_1px_0_var(--color-input)]",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };

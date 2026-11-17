/**
 * A person's initials in a neutral circle: sign-in and the Account
 * hero (the sidebar footer shows only the name). Neutral on purpose: colour is for chart series and
 * status only (docs/design/design-system.md), so avatars take no hue.
 */
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/** Initials for the avatar: "Alex Kim" becomes "AK"; no name gives "-". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "-";
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const avatar = cva(
  "grid shrink-0 select-none place-items-center rounded-full bg-muted font-semibold text-foreground/80 shadow-[inset_0_0_0_1px_var(--color-border)]",
  {
    variants: {
      size: {
        sm: "size-[26px] text-[11px]",
        md: "size-9 text-xs",
        lg: "size-14 text-lg",
      },
    },
    defaultVariants: { size: "sm" },
  },
);

export function Avatar({ name, size, className }: { name: string | null | undefined; className?: string } & VariantProps<typeof avatar>) {
  return (
    <div aria-hidden className={cn(avatar({ size }), !name && "text-muted-foreground", className)}>
      {initials(name)}
    </div>
  );
}

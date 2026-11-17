// Adapted from T3 Code's components/ui/button.tsx (MIT).
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { createContext, use } from "react";

import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--control-radius)] border font-medium text-sm outline-none transition-[box-shadow,scale,background-color] [&:active:not([aria-haspopup])]:scale-[0.97] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "default", variant: "default" },
    variants: {
      size: {
        default: "h-8 px-[calc(--spacing(3)-1px)]",
        sm: "h-7 gap-1.5 px-[calc(--spacing(2.5)-1px)]",
        hero: "h-7 gap-1.5 px-[calc(--spacing(2.5)-1px)] text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        tool: "h-7 gap-1 px-[calc(--spacing(2.5)-1px)] text-xs [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 gap-1 px-[calc(--spacing(2)-1px)] text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 px-[calc(--spacing(3.5)-1px)]",
        icon: "size-8",
        "icon-sm": "size-7",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        default:
          "not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] border-primary bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] border-destructive bg-destructive text-white shadow-xs hover:bg-destructive/90",
        outline:
          "border-input bg-popover text-foreground shadow-xs/5 hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90",
        ghost: "border-transparent text-foreground hover:bg-accent data-pressed:bg-accent",
        "ghost-muted":
          "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground data-pressed:bg-accent",
        link: "border-transparent underline-offset-4 hover:underline",
      },
    },
  },
);

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * The size a Button takes when it is not given one. A region that owns its
 * button size (the page header actions, the QR block, section header tools) provides it once, so
 * call sites inside it leave `size` off. Dialogs reset it to the default.
 */
const ButtonSizeContext = createContext<ButtonSize | undefined>(undefined);

/** Every button in a page header (hero): see docs/design/design-system.md. */
const HERO_BUTTON_SIZE: ButtonSize = "hero";

/** The buttons stacked beside a QR code: four of them fit the 116px code's height. */
const QR_BUTTON_SIZE: ButtonSize = "xs";

/** Every button in a section header's tools slot, the same 28px as the Segmented beside it. */
const SECTION_TOOL_SIZE: ButtonSize = "tool";

function Button({ className, variant, size: sizeProp, render, ...props }: ButtonProps) {
  const size = sizeProp ?? use(ButtonSizeContext);
  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    "data-slot": "button",
    type: render ? undefined : ("button" as const),
  };
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export { Button, ButtonSizeContext, buttonVariants, HERO_BUTTON_SIZE, QR_BUTTON_SIZE, SECTION_TOOL_SIZE, type ButtonProps };

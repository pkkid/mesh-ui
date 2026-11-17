// Section cards from docs/design/design-system.md (Layout, Sections).
import type * as React from "react";

import { Link, navigate } from "~/app/router";
import { ButtonSizeContext, SECTION_TOOL_SIZE } from "~/components/ui/button";
import { SegmentedSizeContext } from "~/components/ui/segmented";
import { cn } from "~/lib/utils";

/** Clicks on these, inside a clickable card, do their own thing and never open the card's page. */
const CARD_IGNORE = "a,button,input,select,textarea,label,[role=menuitem],[role=checkbox],[data-card-ignore]";

/**
 * A subtle card, styled as T3 Code's settings groups: `bg-card/40`, a 1px
 * `border-border/60`, a faint `shadow-xs/5`, 12px radius. Row dividers inside
 * use `divide-border/50`. Keep it flat
 * inside: no nested cards, faint row dividers only. `padded` gives the
 * standard 18px 20px; tables and settings rows go in an unpadded card.
 *
 * With `to` it is a clickable card (docs/design/design-system.md, Clickable
 * cards): a click anywhere opens `to`, hover brightens the background and
 * border, and there is no chevron button. Put the title in a `CardLink`, the
 * keyboard focus target; focusing it gives the card the hover look plus the
 * focus ring. Buttons, links, inputs and anything under `data-card-ignore`
 * keep their own clicks, and a click that ends a text selection does nothing.
 */
function Card({
  className,
  padded = false,
  to,
  onClick,
  ...props
}: React.ComponentProps<"div"> & { padded?: boolean; to?: string }) {
  const open = (e: React.MouseEvent<HTMLDivElement>) => {
    onClick?.(e);
    if (!to || e.defaultPrevented || e.button !== 0) return;
    const target = e.target as Element;
    // React bubbles clicks out of portals (menus, popovers); only clicks inside the card count.
    if (!e.currentTarget.contains(target) || target.closest(CARD_IGNORE)) return;
    if (window.getSelection()?.type === "Range") return;
    navigate(to);
  };
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-(--card-radius) border border-border/60 bg-card/40 text-card-foreground shadow-xs/5",
        padded ? "px-5 py-[18px]" : "overflow-hidden",
        to &&
          "cursor-pointer transition-colors hover:border-foreground/20 hover:bg-muted/30 has-[[data-card-link]:focus-visible]:border-foreground/20 has-[[data-card-link]:focus-visible]:bg-muted/30 has-[[data-card-link]:focus-visible]:ring-2 has-[[data-card-link]:focus-visible]:ring-ring",
        className,
      )}
      onClick={open}
      {...props}
    />
  );
}

/** The title link of a clickable card: the card's keyboard focus target (Enter opens it). The focus ring goes on the card. */
function CardLink({ className, ...props }: React.ComponentProps<typeof Link>) {
  return <Link data-card-link="" className={cn("truncate outline-none", className)} {...props} />;
}

type SectionProps = Omit<React.ComponentProps<"section">, "title"> & {
  title: React.ReactNode;
  /** Muted line beside the title ("Last 24 hours for all devices"). */
  subtitle?: React.ReactNode;
  /** Controls on the right of the heading: segmented toggle, small buttons, "See all" links. */
  tools?: React.ReactNode;
};

/**
 * A page section: heading row (title, subtitle, tools) over its body, 12px
 * apart. The row aligns on baselines and the title takes the row's 28px line,
 * so a 14px title and a 12px subtitle share one baseline. The title and
 * tools never wrap; a long subtitle truncates with an ellipsis (full text in
 * its tooltip) so the row stays one line. Every tool is 28px, the height of
 * the title's line: buttons take `SECTION_TOOL_SIZE` and Segmented its `tool`
 * size from context, so callers leave `size` off.
 */
function Section({ title, subtitle, tools, className, children, ...props }: SectionProps) {
  return (
    <section data-slot="section" className={cn("flex flex-col gap-3", className)} {...props}>
      <div className="flex min-h-7 min-w-0 items-baseline gap-2.5">
        <h2 className="shrink-0 whitespace-nowrap font-medium text-foreground text-sm leading-7">{title}</h2>
        {subtitle && (
          <span className="min-w-0 truncate text-muted-foreground text-xs" title={typeof subtitle === "string" ? subtitle : undefined}>
            {subtitle}
          </span>
        )}
        {tools && (
          <div className="ms-auto flex shrink-0 items-center gap-2">
            <ButtonSizeContext value={SECTION_TOOL_SIZE}>
              <SegmentedSizeContext value="tool">{tools}</SegmentedSizeContext>
            </ButtonSizeContext>
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/** One centred muted sentence for an empty section body. */
function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-7 py-7 text-center text-[13px] text-muted-foreground", className)} {...props} />;
}

export { Card, CardLink, Empty, Section };

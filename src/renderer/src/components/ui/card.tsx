// Section cards from docs/design/design-system.md (Layout, Sections).
import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A subtle card: solid `bg-card`, 1px border, 14px radius. Keep it flat
 * inside: no nested cards, faint row dividers only. `padded` gives the
 * standard 18px 20px; tables and settings rows go in an unpadded card.
 */
function Card({ className, padded = false, ...props }: React.ComponentProps<"div"> & { padded?: boolean }) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-(--card-radius) border bg-card text-card-foreground",
        padded ? "px-5 py-[18px]" : "overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

type SectionProps = Omit<React.ComponentProps<"section">, "title"> & {
  title: React.ReactNode;
  /** Muted line beside the title ("Per hour, last 24 hours"). */
  subtitle?: React.ReactNode;
  /** Controls on the right of the heading: segmented toggle, small buttons, "See all" links. */
  tools?: React.ReactNode;
};

/** A page section: heading row (title, subtitle, tools) over its body, 12px apart. */
function Section({ title, subtitle, tools, className, children, ...props }: SectionProps) {
  return (
    <section data-slot="section" className={cn("flex flex-col gap-3", className)} {...props}>
      <div className="flex min-h-7 items-center gap-2.5">
        <h2 className="font-medium text-foreground text-sm">{title}</h2>
        {subtitle && <span className="truncate text-muted-foreground text-xs">{subtitle}</span>}
        {tools && <div className="ms-auto flex shrink-0 items-center gap-2">{tools}</div>}
      </div>
      {children}
    </section>
  );
}

/** One centred muted sentence for an empty section body. */
function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-7 py-7 text-center text-[13px] text-muted-foreground", className)} {...props} />;
}

export { Card, Empty, Section };

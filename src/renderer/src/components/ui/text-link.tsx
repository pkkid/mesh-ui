/**
 * An inline text link inside muted copy ("Set your plan", "View history"):
 * foreground text with an always-on underline, so it reads as clickable
 * without hover. With `to` it navigates (an in-app `Link`); otherwise it is a
 * button for an action such as opening a sheet. Neutral colour only.
 */
import type * as React from "react";

import { Link } from "~/app/router";
import { cn } from "~/lib/utils";

const textLinkClass =
  "cursor-pointer rounded-sm text-foreground underline decoration-foreground/40 underline-offset-2 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring";

type TextLinkProps =
  | ({ to: string } & Omit<React.ComponentProps<typeof Link>, "to">)
  | ({ to?: undefined } & Omit<React.ComponentProps<"button">, "type">);

function TextLink({ className, ...props }: TextLinkProps) {
  if (props.to !== undefined) return <Link {...props} className={cn(textLinkClass, className)} />;
  const { to: _to, ...button } = props;
  return <button type="button" {...button} className={cn(textLinkClass, className)} />;
}

export { TextLink, textLinkClass };

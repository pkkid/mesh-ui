/**
 * App & account: the eero account, notification choices, the networks on
 * the account, the CLI and agents, themes, About, sign out and delete.
 * Layout, data and states: docs/ux/pages/app-account.md and
 * docs/mockups/17-account-settings.html.
 *
 * Each section has a stable id for deep links: `#/account/<section>` opens
 * the page scrolled to `account-<section>` (ACCOUNT_SECTIONS), e.g. the
 * update chip opens `#/account/about`. `#/account/notifications` scrolls to
 * the Notifications row and opens the notification settings sheet.
 */
import { useEffect } from "react";

import { scrollToSection } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { openNotificationSettings } from "~/features/notifications/NotificationSettings";
import { TopBarSubtitle, TopBarTitle } from "~/features/shell/TopBar";

import { AboutPanel } from "./AboutPanel";
import { AccountHero, EmailPreferences } from "./AccountHero";
import { CliAgents } from "./CliAgents";
import { NetworksTable } from "./NetworksTable";
import { SignOutDelete } from "./SignOutDelete";
import { ThemePicker } from "./ThemePicker";

/** Deep-link names, in page order. */
export const ACCOUNT_SECTIONS = ["profile", "email", "notifications", "networks", "cli", "theme", "about", "sign-out"] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

const sectionId = (s: AccountSection) => `account-${s}`;

export function AccountPage({ params }: PageProps) {
  const section = params.section;
  useEffect(() => {
    if (!section || !(ACCOUNT_SECTIONS as readonly string[]).includes(section)) return;
    scrollToSection(sectionId(section as AccountSection));
    if (section === "notifications") openNotificationSettings();
  }, [section]);

  return (
    <>
      <TopBarTitle>App &amp; account</TopBarTitle>
      <TopBarSubtitle>This computer and your eero account</TopBarSubtitle>
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <AccountHero id={sectionId("profile")} />
          <EmailPreferences id={sectionId("email")} notificationsId={sectionId("notifications")} />
          <NetworksTable id={sectionId("networks")} />
          <CliAgents id={sectionId("cli")} />
          <ThemePicker id={sectionId("theme")} />
        </div>
        <aside className="flex flex-col gap-4 xl:sticky xl:top-0">
          <AboutPanel id={sectionId("about")} />
          <SignOutDelete id={sectionId("sign-out")} />
        </aside>
      </div>
    </>
  );
}

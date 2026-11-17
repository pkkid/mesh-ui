/**
 * Account: the signed-in eero account, its notification choices, the
 * networks on it, and sign out and account deletion. Opened from the
 * signed-in name in the sidebar footer. Layout, data and states:
 * docs/ux/pages/account.md. App settings (CLI and agents, theme, About) are
 * on the Settings page (SettingsPage.tsx).
 *
 * Each section has a stable id for deep links: `#/account/<section>` opens
 * the page scrolled to `account-<section>` (ACCOUNT_SECTIONS).
 * `#/account/notifications` scrolls to the Notifications row and opens the
 * notification settings sheet. Links saved from before the split
 * (`#/account/cli`, `theme`, `about`) go to the same section on Settings.
 */
import { useEffect } from "react";

import { navigate, pathFor, scrollToSection } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { openNotificationSettings } from "~/features/notifications/NotificationSettings";
import { TopBarTitle } from "~/features/shell/TopBar";

import { AccountHero, EmailPreferences } from "./AccountHero";
import { NetworksTable } from "./NetworksTable";
import { SETTINGS_SECTIONS } from "./SettingsPage";
import { SignOutDelete } from "./SignOutDelete";

/** Deep-link names, in page order. */
export const ACCOUNT_SECTIONS = ["profile", "email", "notifications", "networks", "sign-out"] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

const sectionId = (s: AccountSection) => `account-${s}`;

export function AccountPage({ params }: PageProps) {
  const section = params.section;
  useEffect(() => {
    if (!section) return;
    if ((SETTINGS_SECTIONS as readonly string[]).includes(section)) {
      navigate(pathFor("settings", { section }), { replace: true });
      return;
    }
    if (!(ACCOUNT_SECTIONS as readonly string[]).includes(section)) return;
    scrollToSection(sectionId(section as AccountSection));
    if (section === "notifications") openNotificationSettings();
  }, [section]);

  return (
    <>
      <TopBarTitle>Account</TopBarTitle>
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <AccountHero id={sectionId("profile")} />
          <EmailPreferences id={sectionId("email")} notificationsId={sectionId("notifications")} />
          <NetworksTable id={sectionId("networks")} />
        </div>
        <aside className="flex flex-col gap-4 xl:sticky xl:top-0">
          <SignOutDelete id={sectionId("sign-out")} />
        </aside>
      </div>
    </>
  );
}

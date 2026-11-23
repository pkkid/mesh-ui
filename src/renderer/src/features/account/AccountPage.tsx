/**
 * Account: the signed-in eero account (the flat hero, no avatar), the
 * networks on it, then Account settings (email and alert choices, sign out
 * and account deletion), in one full-width column. Opened from the
 * signed-in name in the sidebar footer. Layout, data and states:
 * docs/ux/pages/account.md. App settings (CLI and agents, theme, About) are
 * on the Application page (SettingsPage.tsx).
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

import { AccountHero } from "./AccountHero";
import { NetworksTable } from "./NetworksTable";
import { SETTINGS_SECTIONS } from "./SettingsPage";
import { SignOutDelete } from "./SignOutDelete";

/** Deep-link names, in page order. */
export const ACCOUNT_SECTIONS = ["profile", "networks", "email", "notifications", "sign-out"] as const;
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
      <AccountHero id={sectionId("profile")} />
      <div className="flex flex-col gap-14">
        <NetworksTable id={sectionId("networks")} />
        <SignOutDelete id={sectionId("sign-out")} emailId={sectionId("email")} notificationsId={sectionId("notifications")} />
      </div>
    </>
  );
}

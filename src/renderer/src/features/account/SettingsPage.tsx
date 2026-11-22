/**
 * Settings: this copy of Mesh UI, as opposed to the eero account (Account
 * page). The flat hero is the app itself (version, updates, links; it was the
 * About side panel), then the application theme, the keyboard shortcuts and
 * the CLI and MCP hookup in one full-width column. Layout, data and states: docs/ux/pages/settings.md.
 *
 * Each section has a stable id for deep links: `#/settings/<section>` opens
 * the page scrolled to `settings-<section>` (SETTINGS_SECTIONS), e.g. the
 * update chip opens `#/settings/about`.
 */
import { useEffect } from "react";

import { scrollToSection } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { TopBarTitle } from "~/features/shell/TopBar";


import { CliAgents } from "./CliAgents";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { SettingsHero } from "./SettingsHero";
import { ThemePicker } from "./ThemePicker";

/** Deep-link names, in page order. */
export const SETTINGS_SECTIONS = ["about", "theme", "shortcuts", "cli"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const sectionId = (s: SettingsSection) => `settings-${s}`;

export function SettingsPage({ params }: PageProps) {
  const section = params.section;
  useEffect(() => {
    if (!section || !(SETTINGS_SECTIONS as readonly string[]).includes(section)) return;
    scrollToSection(sectionId(section as SettingsSection));
  }, [section]);

  return (
    <>
      <TopBarTitle>Settings</TopBarTitle>
      <SettingsHero id={sectionId("about")} />
      <div className="flex flex-col gap-14">
        <ThemePicker id={sectionId("theme")} />
        <KeyboardShortcuts id={sectionId("shortcuts")} />
        <CliAgents id={sectionId("cli")} />
      </div>
    </>
  );
}

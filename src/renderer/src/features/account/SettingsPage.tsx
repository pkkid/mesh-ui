/**
 * Settings: this copy of Mesh UI, as opposed to the eero account (Account
 * page). The CLI and MCP hookup, the application theme, and About (version,
 * updates, links). Layout, data and states: docs/ux/pages/settings.md.
 *
 * Each section has a stable id for deep links: `#/settings/<section>` opens
 * the page scrolled to `settings-<section>` (SETTINGS_SECTIONS), e.g. the
 * update chip opens `#/settings/about`.
 */
import { useEffect } from "react";

import { scrollToSection } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { TopBarTitle } from "~/features/shell/TopBar";

import { AboutPanel } from "./AboutPanel";
import { CliAgents } from "./CliAgents";
import { ThemePicker } from "./ThemePicker";

/** Deep-link names, in page order. */
export const SETTINGS_SECTIONS = ["cli", "theme", "about"] as const;
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
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <CliAgents id={sectionId("cli")} />
          <ThemePicker id={sectionId("theme")} />
        </div>
        <aside className="flex flex-col gap-4 xl:sticky xl:top-0">
          <AboutPanel id={sectionId("about")} />
        </aside>
      </div>
    </>
  );
}

/**
 * Theme previews for the Application Theme picker, ported from T3 Code
 * (apps/web/src/components/settings/ThemePreviewCircles.tsx and
 * ThemeWireframe.tsx, MIT). A circle is a soft blend of a theme's canvas,
 * accent and action colours; a wireframe is a tiny Mesh UI window. Both draw
 * the theme's own colours, which is why they set inline styles.
 */
import type { CSSProperties } from "react";

import {
  getSeriesForAppearance,
  getThemeColorsForAppearance,
  type ThemeAppearance,
  type ThemeDefinition,
} from "~/lib/themePalettes";
import { cn } from "~/lib/utils";

export type PreviewColors = Readonly<{
  canvas: string;
  sidebar: string;
  surface: string;
  border: string;
  accent: string;
  accentSurface: string;
  messageAction: string;
  seriesBlue: string;
  seriesPurple: string;
}>;

export function previewColors(theme: ThemeDefinition, mode: ThemeAppearance): PreviewColors {
  const colors = getThemeColorsForAppearance(theme, mode);
  const series = getSeriesForAppearance(theme, mode);
  return {
    canvas: colors.canvas,
    sidebar: colors.sidebar,
    surface: colors.surface,
    border: colors.border,
    accent: colors.accent,
    accentSurface: colors.accentSurface,
    messageAction: colors.messageAction,
    seriesBlue: series.blue,
    seriesPurple: series.purple,
  };
}

/** T3 Code's THEME_PREVIEW_RENDER_SPECS. */
const SPECS = {
  light: { base: "#ffffff", accentAt: "72% 22%", actionAt: "18% 82%", accentMid: 72 },
  dark: { base: "#09090b", accentAt: "28% 78%", actionAt: "82% 18%", accentMid: 62 },
} as const;

function circleStyle(colors: PreviewColors, mode: ThemeAppearance): CSSProperties {
  const spec = SPECS[mode];
  return {
    backgroundColor: `color-mix(in oklab, ${colors.canvas} 80%, ${spec.base})`,
    backgroundImage: [
      `radial-gradient(circle at ${spec.accentAt} in oklab, ${colors.accent} 0%, color-mix(in oklab, ${colors.accent} ${spec.accentMid}%, transparent) 28%, transparent 58%)`,
      `radial-gradient(circle at ${spec.actionAt} in oklab, color-mix(in oklab, ${colors.messageAction} 45%, transparent) 0%, transparent 55%)`,
    ].join(", "),
    filter: "blur(3px)",
    transform: "scale(1.1)",
  };
}

const EDGE = {
  light: "inset 0 0 0 1px rgb(0 0 0 / 0.10), 0 1px 2px rgb(0 0 0 / 0.08)",
  dark: "inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18)",
} as const;

export function ThemePreviewCircle({
  colors,
  mode,
  className,
}: {
  colors: PreviewColors;
  mode: ThemeAppearance;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("relative block size-14 shrink-0 overflow-hidden rounded-full border-2 border-background", className)}
      style={{ boxShadow: EDGE[mode] }}
    >
      <span className="absolute inset-0 rounded-full" style={circleStyle(colors, mode)} />
    </span>
  );
}

function WireframePane({ colors, clip }: { colors: PreviewColors; clip?: "left" | "right" }) {
  const line = "rgb(127 127 127 / 0.25)";
  return (
    <span
      className="absolute inset-0"
      style={
        clip && {
          clipPath:
            clip === "left"
              ? "polygon(0 0, calc(50% - 1px) 0, calc(50% - 1px) 100%, 0 100%)"
              : "polygon(calc(50% + 1px) 0, 100% 0, 100% 100%, calc(50% + 1px) 100%)",
        }
      }
    >
      <span className="absolute inset-0" style={{ backgroundColor: colors.canvas }} />
      {/* Sidebar with the selected row and two more. */}
      <span
        className="absolute inset-y-0 left-0 w-[22%]"
        style={{ backgroundColor: colors.sidebar, boxShadow: `inset -1px 0 0 ${colors.border}` }}
      />
      <span
        className="absolute left-[3%] top-[10%] h-[7%] w-[16%] rounded-md"
        style={{ backgroundColor: colors.accentSurface }}
      />
      {[22, 32].map((top) => (
        <span
          key={top}
          className="absolute left-[4%] h-[5%] w-[12%] rounded-sm"
          style={{ top: `${top}%`, backgroundColor: line }}
        />
      ))}
      {/* A section card with a chart, and a button. */}
      <span className="absolute left-[27%] top-[9%] h-[5%] w-[22%] rounded-sm" style={{ backgroundColor: line }} />
      <span
        className="absolute left-[27%] right-[5%] top-[20%] bottom-[10%] overflow-hidden rounded-md"
        style={{ backgroundColor: colors.surface, boxShadow: `inset 0 0 0 1px ${colors.border}` }}
      >
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-3/5 w-full">
          <path d="M0 30 C 15 26, 25 12, 40 16 S 70 30, 100 8" fill="none" stroke={colors.seriesBlue} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path d="M0 36 C 20 34, 35 26, 55 30 S 80 22, 100 26" fill="none" stroke={colors.seriesPurple} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <span
          className="absolute right-[6%] top-[12%] h-[16%] w-[20%] rounded-sm"
          style={{ backgroundColor: colors.messageAction }}
        />
      </span>
    </span>
  );
}

/** A tiny window in the theme's colours; two panes split down the middle for "System". */
export function ThemeWireframe({
  panes,
  className,
}: {
  panes: ReadonlyArray<{ colors: PreviewColors; clip?: "left" | "right" }>;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn("relative block w-full overflow-hidden rounded-lg border border-border/60", className)}>
      {panes.map((pane) => (
        <WireframePane key={pane.clip ?? "pane"} colors={pane.colors} clip={pane.clip} />
      ))}
    </span>
  );
}

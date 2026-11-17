# Design system

How Mesh UI looks. The look follows T3 Code (`~/Sources/t3code`): quiet
surfaces, a sidebar plus main pane, a custom titlebar, dense type and
role-based theme palettes. The approved screens are the mockups in
[docs/mockups/](../mockups/index.html); their shared styles are
`docs/mockups/assets/mockup.css` and the chart code is
`docs/mockups/assets/mockup.js`. The app implements the same tokens as Tailwind
semantic classes.

## Principles

- **Restrained.** Colour carries meaning only: chart series and status. Text,
  surfaces and controls are neutral. No gradients, glows or decorative
  colour.
- **Dense and calm.** 14px base type, small metadata, tight rows. Information
  first, chrome second.
- **One look per kind of thing.** A download is always the same blue, a
  status is always a dot plus text, a quantity always uses the same formatter.
- **Every action is a command.** Controls map to command ids; risky ones
  confirm first (see [Confirmation](#confirmation)).

## Themes

Themes are `ThemeDefinition`s in `src/renderer/src/lib/themePalettes.ts`
(ported from T3 Code's `packages/shared/src/themePalettes.ts`), applied by
`lib/themes.ts` as `--theme-*` CSS variables on `<html>`. Each has a light and
a dark variant; appearance follows the system or a fixed choice.

| Theme | Notes |
| --- | --- |
| **Gruvbox Hard** | Default. Warm, low-contrast surfaces; the mockups use it |
| Classic | Neutral zinc, close to T3 Code's default |
| Rose | |
| Grove | |
| Ocean | |
| Ember | |
| Iris | |

To add a theme, add a `ThemeDefinition` and list it in `BUILT_IN_THEMES`.
The theme picker in Account & Settings shows each as a card with preview orbs, as in
T3 Code's settings. The choice is stored in localStorage
(`mesh-ui:theme:v1`), on this computer only.

## Tokens

Use semantic Tailwind tokens, never literal colours. The table maps the
mockup variable to the app token.

| Role | Mockup variable | Tailwind token | Gruvbox Hard dark | Gruvbox Hard light |
| --- | --- | --- | --- | --- |
| Page background | `--bg` | `bg-background` | `#1d2021` | `#f2e5bc` |
| Titlebar and sidebar | `--chrome`, `--sidebar-bg` | `bg-chrome`, `bg-sidebar` | `#1d2021` | `#f2e5bc` |
| Section and card surface | `--card` | `bg-card` | `#262829` | `#f9f5d7` |
| Inset or raised surface | `--card-2` | `bg-surface-raised`, `bg-muted` | `#2e2f2f` | `#f2e5bc` |
| Popover | `--popover` | `bg-popover` | `#282828` | `#f9f5d7` |
| Tooltip | `--bg` | `bg-tooltip` (the page background, one step below cards) | `#1d2021` | `#f2e5bc` |
| Text | `--fg` | `text-foreground` | `#ebdbb2` | `#3c3836` |
| Secondary text | `--fg-2` | `text-foreground/80` | `#d5c4a1` | `#504945` |
| Muted text | `--muted` | `text-muted-foreground` | `#a89984` | `#7c6f64` |
| Faint text, group labels | `--muted-2` | `text-muted-foreground/70` | `#7c6f64` | `#a89984` |
| Border | `--border` | `border` (`border-border`) | `#353637` | `#e1d3a8` |
| Control border | `--border-2` | `border-input` | `#45433f` | `#d5c4a1` |
| Chart gridline | `--grid` | `text-border` | `#323434` | `#ebdbb2` |
| Primary action | `--primary` | `bg-primary` / `text-primary-foreground` | `#458588` | `#076678` |
| Hover | `--hover` | `hover:bg-muted/50` | 4% of text | 4% of text |

Status tokens mean status only, never "series number three":

| Status | Token | Use |
| --- | --- | --- |
| `success` | `bg-success`, `text-success-foreground` | Online, active, healthy |
| `warning` | `bg-warning`, `text-warning-foreground` | Weak link, update available, degraded |
| `destructive` | `bg-destructive`, `text-destructive-foreground` | Offline, failed, destructive buttons |
| `info` | `bg-info`, `text-info-foreground` | Notices, links |

## Series colours

Each kind of series has one colour, defined once in
`src/renderer/src/lib/chartColors.ts` and used in every chart, legend, dot and
bar for that thing. Never pick a colour inline. Values come from the theme's
series palette so they read on both light and dark.

| Series | Mockup variable | Gruvbox dark | Gruvbox light |
| --- | --- | --- | --- |
| Download | `--c-down` (`--s-blue`) | `#83a598` | `#076678` |
| Upload | `--c-up` (`--s-purple`) | `#d3869b` | `#8f3f71` |
| 2.4 GHz | `--c-band24` (`--s-yellow`) | `#fabd2f` | `#b57614` |
| 5 GHz | `--c-band5` (`--s-blue`) | `#83a598` | `#076678` |
| 6 GHz | `--c-band6` (`--s-purple`) | `#d3869b` | `#8f3f71` |
| Wired (ethernet) | `--c-wired` (`--s-aqua`) | `#8ec07c` | `#427b58` |
| Each eero, each profile | Assigned in order from blue, purple, aqua, orange, yellow, green, stable per id | | |
| Neutral or "other" | Mix of `--foreground` with the background | | |
| Power saving schedules | `seriesColors.powerSaving` (`--s-green`) | `#b8bb26` | `#79740e` |
| Speed over plan (the flame on a speed gauge; its text stays muted) | `seriesColors.overPlan` (`--s-orange`) | `#fe8019` | `#af3a03` |
| Activity event types | `eventCategoryColors`: devices blue, paused / blocked orange, schedules red, eero status yellow, speed tests aqua, firmware gray, admin purple, ports & temperature green, other neutral | | |

Download and upload never appear in the same chart as bands, so sharing blue
and purple is safe. Themes other than Gruvbox Hard use T3-style mid-tones
(`#5b9bbd` blue, `#8c7bd1` violet, `#4d9f8a` teal, `#d97757` orange). Check
every chart in light and dark.

Command effect badges (palette, Account & Settings) use a dot in a fixed colour:
query aqua, write blue, disruptive yellow, destructive red. The badge itself is
neutral.

## Typography

Inter Variable for text, `ui-monospace` stack for code, ids and big tile
numbers.

| Use | Size | Class |
| --- | --- | --- |
| Body | 14px | base |
| Sidebar items, settings row titles | 13.5px | `text-[13.5px]` |
| Secondary body, buttons, tables | 13px | `text-[13px]` |
| Metadata, legends, section subtitles | 12px | `text-xs` |
| Fine metadata | 11px | `text-2xs` |
| Chart labels, group labels, tile labels | 10px | `text-3xs` |
| Section heading | 13.5-14px, 500-600 | `text-sm font-medium` |
| Page title | 28px, 650 | `text-[28px] font-semibold tracking-tight` |
| Hero figure | 36-40px, 650 | `text-4xl font-semibold tabular-nums` |
| Stat tile value | 24-25px mono, 650 | `font-mono text-2xl font-semibold tracking-tighter tabular-nums` |

- All numbers use `tabular-nums`.
- Group and tile labels are uppercase with wide tracking
  (`tracking-widest`); nothing else is uppercase except X axis labels.
- Sentence case everywhere ("Restart network", not "Restart Network").
- "eero" is always lowercase, even at the start of a label.

## Shape and spacing

| Thing | Value |
| --- | --- |
| Control radius (buttons, inputs, segmented, nav items) | 8px |
| Section card radius | 14px |
| Page header (hero) radius | 18px |
| Chips, status dots, avatars | Full |
| Titlebar height | 44px |
| Sidebar width | 15rem (mockup 236px) |
| Page max width | 1320px, padding 22px 28px 48px |
| Gap between sections | 28px |
| Gap inside a section (heading to card) | 12px |
| Card padding | 18px 20px |
| Settings row | 13px 18px, min height 58px |
| Button height | 30px (small 26px) |
| Icons | lucide, 16px in nav and buttons, 13-14px in chips and inputs |

## Layout

### Shell

Sidebar on the left (`bg-sidebar`, 1px right border): app icon, network
picker card, nav groups **Network** and **Settings**, and the account row
at the bottom (a neutral gear tile in place of an avatar, name and role; it
opens Account & Settings and uses the nav row hover and selected states).
Main pane: a 44px top bar (breadcrumbs, page navigation, search,
Refresh, notifications, theme toggle, window controls) over a scrolling content
column. Its icon controls (Refresh, bell, theme) are neutral 30px ghost
buttons with a `title` tooltip naming any shortcut ("Refresh (Ctrl+R)");
a running Refresh only spins its icon (rotation, no other animation). The top strip of each pane is the
window titlebar (`drag-region`); controls in it need `no-drag`, and it
respects `--titlebar-inset-left/right`. See
[architecture/ui.md](../architecture/ui.md#shell).

**The titlebar holds navigation and global tools only**: breadcrumbs,
search, Refresh, notifications, theme, and Prev / Next on detail pages.
**Page actions live in the page**, in the hero actions or a section's tools
(Add a profile sits in the Profiles section header beside Pause all). Pages
that still use the titlebar actions slot for page actions are tracked in
#323.

### Page header (hero)

Every page opens with the same header:

- icon tile (`size-16`, radius 18px) or avatar on the left, **top-aligned
  with the title**;
- title on the top row;
- status line under it: status dot plus plain text, then muted context
  ("Online · Gateway up 23 days, 4 hours");
- optional key facts as label-over-value pairs (ISP, Public IP, Last speed
  test);
- **actions in a row at the bottom**, primary first, disruptive last.

Every button in a header is the `hero` size (28px, `h-7`, 13px text,
14px icons), on every page: the actions row, the buttons in the right-hand
column (Pause profile) and the QR block. The one exception is "Show code"
over an empty QR frame, which is `xs` to fit inside the frame. `PageHeader` and `QrBlock` set it once through
`ButtonSizeContext` in `components/ui/button.tsx`, so buttons inside them
leave `size` off; a size given at the call site would break the match.
Dialogs opened from a header reset it, so their buttons keep their own sizes.

Guest network and Wi-Fi put a **QR block at the top right** of the header,
with labelled buttons (Copy password, Save QR, Print a card) to its left
(`components/ui/qr.tsx`, see Components).

### Sections

**Sections are subtle cards**: a `<section>` with a heading row
(`text-sm font-medium` title, optional muted subtitle, controls on the right)
that stays one line (title and tools never wrap; a long subtitle truncates
with an ellipsis and shows in full in its tooltip) above a card with a solid `bg-card` surface, a 1px `border`, and 14px radius.
**Header tools are 28px.** Every control in the tools slot (buttons,
`HeaderLink`, Segmented toggles, selects) is 28px tall, the height of the
title's line, so their top and bottom edges line up: buttons are the `tool`
size (`h-7`, 12px text, 14px icons) and Segmented its `tool` size (border,
`p-0.5`, 22px items). `Section` sets both once through `ButtonSizeContext`
and `SegmentedSizeContext`, so call sites inside the tools slot leave `size`
off, like the page header. A shared button that also appears outside a header
(`CopyCommandButton`) reads the context and falls back to its own size.

| Control row | Height |
| --- | --- |
| Section header tools | 28px (`tool`) |
| Page header (hero) actions | 28px (`hero`, 13px text) |
| Segmented outside a header (forms, settings) | 30px (`sm`, the default) |
| Toolbars (Devices filter row) | 32px (`md` Segmented, `h-8` inputs and buttons) |

A fully flat layout, with sections directly on the page background, was tried
in the mockups and rejected: on the warm Gruvbox surfaces sections blurred
together.

Inside a card, keep it flat: no nested cards, faint row dividers only. Boxes
inside a section are reserved for controls, code blocks, notes and selectable
cards.

Grids used by the mockups: two columns, three columns, main plus 360px side,
2:1, and a 290px side list plus detail.

## Components

Primitives live in `src/renderer/src/components/ui/`. Port new ones from
T3 Code's `apps/web/src/components/ui/` and trim what is unused.

| Component | Look |
| --- | --- |
| Button | 30px, 8px radius, `bg-card` with control border; `primary` filled; `danger` red text; `ghost` no border; `icon` square |
| Segmented toggle | Inset track (`bg-muted`, border), selected segment raised on `bg-card`. Used for Day / Week, metric switches, Email / Phone. Three sizes: `tool` (28px) in section headers, set by `Section`; `sm` (30px, the default) in forms and settings; `md` (32px) in toolbars beside `h-8` inputs and buttons, such as the Devices status filter |
| Switch | 32 x 19, `bg-primary` when on |
| Input, select | 30px, control border, mono variant for IPs and MACs |
| Chip | Full radius, 26px, for filters; selected chip gets a stronger border, not colour |
| Status | `size-1.5` dot in the status colour plus `text-xs text-foreground/80` label ("Online", "Weak link"). No pill outline, fill or uppercase |
| Badge | Small neutral box (`bg-muted`, border) for counts, versions, "Gateway" |
| Icon tile | Neutral square with inset border, icon in `text-muted-foreground`; sizes 24, 32, 44, 64 |
| Avatar | Round, initials, profile colour from `chartColors.ts` |
| Signal bars | Four bars; one bar red, two yellow, three or four in text colour |
| Settings rows | Card with rows split by 1px borders: title, muted description, value or control on the right, chevron if it opens something |
| Note | Bordered inset box with an icon in the status colour and body text in normal colour, for real warnings |

**Buttons.** Primary (filled) is only for the one main action of a hero
(Run speed test, Pause in the device hero) and for the submit button of a
sheet, dialog or form (Save, Create, Send), plus Install update and the
sign-in flow. Everything in section headers, the topbar and toolbars is
`outline` or `ghost` (Add a reservation, Add port forward, Add a profile,
Run again). This follows the restrained colour rule: buttons are neutral.
| Key-value list | `kv-list.tsx`. Two columns, muted keys, `tabular-nums` values; IPs, MACs and serials in mono with a small copy button |
| Band badge | `band-badge.tsx`. The neutral Badge box with "2.4 GHz", "5 GHz", "6 GHz" or a cable icon and "Wired". Never coloured: band colours are for chart series |
| Meter | `meter.tsx`. `h-1.5` bar on `bg-muted` for plan use and utilisation; neutral fill (`bg-foreground/70`), or the series colour via `color` for a series share (download and upload plan meters), `warning` from `warnAt`, `destructive` from `dangerAt`; empty track for a missing value |
| Device icon | `lib/deviceIcons.ts` `deviceIcon(device)`: the only map from a device to an icon, shown in an Icon tile. An Amazon Echo is matched by its model name first (see [Product icons](#product-icons)), then the device type, then core's guess for a `generic` device (`inferredType`), then the category. A device nothing is known about gets a neutral device icon (`MonitorSmartphone`), never a question mark. Never map device types to icons anywhere else |
| eero icon | `lib/deviceIcons.ts` `eeroIcon(eero)`: the only map from an eero to its product glyph, by `modelNumber`, then the model name, then the puck. See [Product icons](#product-icons) |
| Tooltip | One surface for every tooltip: `tooltipSurface` in `charts/Tooltip.tsx` (`bg-tooltip/95`, 1px `border`, `rounded-md` (6px), `shadow-lg`, `text-xs`, backdrop blur). Chart tooltips, the share bar and the donut use it, and `ui/title-tooltips.tsx` (mounted once in `main.tsx`) draws every `title` attribute with it, centred above the element after 500ms, instead of the OS tooltip. So components keep writing plain `title="..."` |
| Dialog and sheet | `bg-popover`, border, large radius, dimmed backdrop |
| QR block | `qr.tsx`. `QrBlock`: small outline buttons stacked on the left (Copy with a page label such as "Copy password", Save QR, then page actions like Print a card), the code with a muted `text-xs` caption on the right; `QrCode` is the code alone. On screen the code follows the theme: `text-foreground` modules on a `bg-card` tile with a quiet zone and 1px border, so the dark theme shows light modules on a dark tile (current iOS and Android cameras read inverted codes; Gruvbox foreground on card is about 12:1). The Mesh UI glyph (the three nodes from `build/icon.svg`) sits in a cleared square in the middle, about a quarter of the width, in the modules' colour; the code is encoded at error correction level H so the hidden modules (under 8%) never stop it scanning. An empty muted frame while the payload loads. What leaves the app stays black on white, the only fixed black and white: Save QR writes a black-on-white PNG (4-module quiet zone, glyph included) through Chromium's download save dialog, and the printed card (`GuestCard.tsx`) draws the code black on white. Encoder: `uqr` (MIT, pinned) |
| Week timeline | `timeline.tsx`. `WeekTimeline`: a lane per day, Mon to Sun (day label `text-2xs` uppercase, today in `text-foreground` with a stronger lane border), hour gridlines, blocks in the schedule's colour at 78% with `text-background` label (icon from 3 h, label from 2 h), disabled schedules as a dashed muted outline "(off)", a 2px Now line on today, ticks 12 AM, 6 AM, 12 PM, 6 PM, 12 AM. A span ending at or before its start wraps past midnight and splits across two days (Sunday into Monday). `layoutWeek` is the pure layout. Shared by profile schedules and power saving |

### Filter bar

List pages filter with one pattern, `components/ui/filter-bar.tsx`, used by
Devices and Activity. Do not build another.

- A bare toolbar (no card), 32px controls: `FilterSearch` (search icon, `/`
  hint; `useSlashFocus` wires the key, Esc clears) and a `FiltersButton` on
  the left, page-specific segments beside them (Devices' status).
- `FiltersButton`: outline button with a muted count badge, a popover of
  `FilterRow`s (label column plus control: `SelectPicker`, `FilterToggle`
  chips, a Segmented) and a footer "N filters set" with **Clear all**.
- Right (`FilterBarEnd`): `FilterDropdown` triggers for view choices such as
  Group by, Sort or Range (icon, current value, chevron, the name in the
  tooltip), then icon buttons such as Columns.
- `FilterBar` shows each filter that is set as a removable chip under the
  toolbar, then **Clear all**. Nothing else (no Reset button).
- `Picker` lists over 10 options get a type-ahead field at the top; Enter
  picks the first match.

### Tables

- Header `text-xs text-muted-foreground font-normal`, 1px bottom border.
- Rows with a faint divider (`border-b border-border/50`) and
  `hover:bg-muted/50`; offline rows in muted text.
- Numbers right-aligned, `tabular-nums`.
- Under a name, an optional 2px (`h-0.5`) bar in the series colour scaled to
  the largest row, `max-w-48`.
- Group header rows: `text-3xs` uppercase, tracking, on `bg-muted`.
- `components/ui/breakdown-table.tsx` is the shared breakdown: optional `#`
  rank, icon tile, name with the 2px bar, figure columns, and an optional
  Others row (muted name, neutral bar) that sums everything past `limit`.

### Page kit

`components/ui/page.tsx` holds what every page reuses: `RowList` and `Row`
(58px rows split by 1px borders, a link when given `to`),
`PlaceholderRows` (blank rows at normal height while loading), `HeaderLink`
(small outline button in a section header, optional arrow),
`ComingSoonButton` (disabled, "Coming soon" tooltip, for writes in a later
milestone), `SectionError` (what failed, eero's message, Retry; other
sections keep working) and `useNow` (a ticking clock for relative times).

**Clickable cards.** A large card that opens a detail page (an eero card,
a profile card) is one clickable target: `<Card to={path}>` with its title in
a `CardLink`. A click anywhere on the card opens the page; there is no
chevron or "Details" button. The card gets `cursor-pointer` and, on hover,
`bg-muted/30` plus a brighter border (`border-foreground/20`), with
`transition-colors` only (no movement, no shadow). The title link is the
keyboard focus target: focusing it gives the card the hover look plus the
focus ring, and Enter opens it. Buttons, links, inputs and menus inside the
card (Blink light, Pause, the `...` menu) keep their own clicks; wrap any other
control in `data-card-ignore`. List rows (`Row`) are a separate pattern and
keep `hover:bg-muted/50`.

`components/ui/text-link.tsx` is the inline link inside muted copy ("Set
your internet plan", "Change", "View history"): `text-foreground` with an
always-on underline (`decoration-foreground/40`, offset 2), so it reads as
clickable without hover. With `to` it is an in-app `Link`; without, a
button. Use it instead of a muted button that only underlines on hover.


`useGate({ area, op, capability, bridgeOff })` and `GatedButton` gate write
controls: from `network.permissions` and `network.get`, a closed gate
renders the button disabled with a tooltip ("Owner only", "You don't have
permission to change this", "Off in bridge mode", "Not available on this
network"). `gateFor` in `app/useWrite.ts` is the pure check. Replace `ComingSoonButton` with a
gated control once the page's write command exists.

### Write kit

Every write control uses the same pieces (M4.3):

- **`useWrite(id, options)`** (`app/useWrite.ts`): `run(params, options)`
  runs the command without `confirm`; on `needs_confirm` it shows the
  confirm with the engine's message, and only after the person confirms runs
  it again with `confirm: true`. A confirmed disruptive write shows a
  progress toast (`progress`), replaced by the result. Success refetches the
  affected queries and shows the `success` toast, with Undo when `undo`
  names the inverse write. Errors show an error toast with Retry (no second
  confirm) and the control keeps its old state; `form: true` sends
  `bad_params` to the fields instead (`fieldErrors(error)`). `askFirst`
  covers writes the UI confirms on its own (delete a schedule) and never sends
  `confirm`. Every confirm is a centred modal: `confirmIn: "dialog"`
  (default) uses the app's confirm dialog; `"nested"`, for a write inside
  another dialog (palette, sheet), holds the ask in the hook for
  `WriteConfirmDialog`, rendered inside that dialog.
  `performWrite(request)` is the same flow without React, for the palette.
- **Toasts** (`ui/toast.tsx`): `toast.success`, `toast.progress`,
  `toast.error`, `toast.update`; glass cards bottom right, at most 3,
  `aria-live`. Success closes after 4 s; progress and error stay.
- **Confirm** (`ui/confirm.tsx`): `ConfirmDialog` (type-to-confirm when
  given a name), `ConfirmHost`, mounted once by the shell, and
  `WriteConfirmDialog` for a nested write.
- **Sheet** (`ui/sheet.tsx`): `Sheet` and `SheetField`, as in
  [overview.md](../ux/overview.md#sheets).

```tsx
const rename = useWrite<{ eero: string; name: string }>("eero.rename", { form: true });
const restart = useWrite("eero.restart"); // confirms in the app's dialog

<GatedButton gate={useGate("eero.restart")}
  onClick={() => restart.run({ eero: id }, { success: `Restarted ${name}`, progress: `Restarting ${name}` })}>
  Restart
</GatedButton>
```

The dev gallery's Write kit section shows each piece.

## Charts

Hand-written SVG, no chart library. Shared pieces in
`src/renderer/src/components/charts/`, modelled on T3 Code's usage page
(`UsagePage.tsx`, `UsageProviderChart.tsx`, `UsageShareBar.tsx`) and
resource diagnostics. Port from them rather than inventing a style.

In a dev build (`pnpm dev:demo`), `#/dev/charts` opens the chart gallery
(`ChartGallery.tsx`): the write kit, every chart in the kit, the QR block
and the week timeline, with invented data, with a
Live / Loading toggle. It is not linked from the sidebar and is left out of
release builds. Check a chart change there in light and dark (the topbar
toggle switches appearance). Headless: `pnpm ui:shot --fake --route
'#/dev/charts'` (the dev route needs the dev build `--fake` makes).

- **Geometry.** Fixed `viewBox` (960 x 260), `preserveAspectRatio="none"`,
  filling its box (`h-56` for a main chart). Every stroke uses
  `vectorEffect="non-scaling-stroke"`.
- **Lines.** Monotone cubic interpolation (Fritsch-Carlson, T3's
  `monotoneTangents` / `smoothCurve`): smooth, never overshooting the data or
  dipping below zero. Never Catmull-Rom or free beziers.
- **Line plus soft area.** Each series is a 2px line with the area under it in
  the same colour at 12% opacity. Draw all areas first, then all lines; the
  largest series first so small ones sit on top.
- **Scale.** Overlapping (not stacked) series share a scale based on the
  largest single series, not the sum. A chart with a natural ceiling passes
  `max` (the Internet speed chart passes the plan), so the scale stays put
  as points come and go; values above it still fit.
- **Chrome.** Horizontal gridlines only, 1px `text-border`, at nice ticks
  (steps of 1, 2 or 5 times a power of ten, about 4 ticks). No axis lines,
  vertical gridlines, border or background.
- **Labels.** Y labels in a `w-14` gutter, right-aligned,
  `text-3xs text-muted-foreground tabular-nums`, zero shown as `0`. X labels
  only at start, middle and end, `text-3xs uppercase`.
- **Hover.** A 1px muted vertical line at the nearest point and a tooltip that
  follows the pointer 12px away and stays inside the plot. Tooltip: the shared
  tooltip surface (`tooltipSurface`: `bg-tooltip`, the page background, with
  a border, `rounded-xl shadow-lg text-xs`), period label in muted text, one row per series (dot, muted
  label, value right-aligned), and a Total row under a top border when totals
  make sense.
- **Ranges.** Usage charts offer Day and Week only (free accounts keep about 7
  days). The toggle sits in the section header.
- **Loading and empty.** Keep the layout. On a first load, or a switch to a
  range or filter not loaded yet, fade figures to `opacity-40` after a 150ms
  delay, with unlabelled placeholder gridlines while there is no data. A
  background refresh never dims data already on screen; the topbar Refresh
  icon spins instead (static and foreground-coloured with reduced motion). An
  empty range shows one centred muted sentence ("No activity in this window.").
- **Accessible.** `role="img"` and an `aria-label` saying what it shows.
- **No load animations.** Only opacity transitions; charts re-render cheaply
  while live data polls.

Other chart kinds in the mockups, same rules for colour and labels:

| Kind | Use |
| --- | --- |
| Sparkline | Tiny line, no labels, in tables and eero rows |
| Gauge | Speed test result (download, upload) in Internet and Overview. With a plan: runs to 125% of it, a 2px foreground `mark` at the plan, and a `note` under the unit ("94% of plan", or a solid `Flame` in `overPlan` plus "9% over plan"); `SpeedGauge` in `InternetHero.tsx` is the shared one, `formatPlanShare` words it |
| Heatmap | "When the network is busy", day by hour, one series colour at varying opacity |
| Donut | `Donut.tsx`. A share of counts (devices by type, by band, by Wi-Fi generation) with butt segment ends and a small gap. Ring thickness is 13.5% of the size (`DONUT_THICKNESS`: 13px at 96px, 16px at 120px); callers set only `size`. Centre content is kept inside the hole (`size - 2 * thickness - 8px`). The centre always shows the total and does not change on hover. Hovering a segment dims the others and shows "label · value · percent" in a tooltip that follows the pointer (`FloatingTooltip`, so it can leave the card). Its legend uses `DonutLegendRow`: hovering a row highlights its segment and the other way round |
| Share bar | `h-2` bar of segments with `gap-0.5`, rounded outer ends, tooltip "label · value · percent", legend of `size-2` squares |
| Topology | eero pucks joined by lines; wired solid, wireless dashed; weak links in the warning colour |

## Dashboard patterns

- **Hero figure.** `text-4xl font-semibold tabular-nums` with a
  `text-xs text-muted-foreground` line under it. Beside a main chart, an
  18rem column lists each series: dot, icon, label, value right in
  `font-medium`, muted share line below. Compact hero (Activity): `text-2xl`
  figure with its muted line beside it and a share bar filling the line,
  the legend as wrapping chips under it, and the chart filling the card's
  leftover height (`BarChart fill`).
- **Metric row.** Grid (2 columns, 5 on wide) of label (`text-xs` muted) over
  value (`text-base font-medium tabular-nums`).
- **Stat tiles** (status and diagnostics): icon plus label in
  `text-3xs font-semibold uppercase tracking-widest text-muted-foreground/70`,
  value in mono `text-2xl`, optional detail in `text-3xs`. Warning or danger
  values take the status foreground colour. Tiles sit in one card split by 1px
  borders.

## Numbers and copy

- Shared formatters in `src/core/format.ts` (re-exported to the renderer)
  for Mbps and Gbps (kbps below 1 Mbps, so a trickle never shows as 0), MB, GB and TB, percent, ms, relative time ("2h ago",
  "Yesterday, 3:04 AM"), durations ("23 days, 4 hours"). The same quantity
  looks the same everywhere, including CLI table output.
- Clock times and dates are always in the network's time zone, never the
  viewer's: `networkClock(network.timezone)` in `src/core/format.ts` gives
  `time` ("9:41 AM"), `dateTime` ("Oct 20, 9:41 AM"), `day` ("Sat Nov 8"),
  `hour` chart labels ("9 AM"), weekdays and `parts` for day-by-hour grids.
  Do not build an `Intl.DateTimeFormat` in a component.
- Show `-` for a missing value, never `0` or blank.
- No emdashes in UI copy or docs. Use a comma, colon or a new sentence.
- Example data is invented: Maple Street, Alex Kim, `192.168.4.x`.
- Mesh UI never shows eero Plus features, upsells or lock badges.

## Confirmation

Disruptive and destructive actions confirm in a centred modal before running,
the same everywhere (never a note in place of the button):

- A title naming the target and one or two sentences on the effect and how
  long it lasts ("Turn off guest network? 4 guests are disconnected right
  away."), then Cancel and a filled danger button that repeats the action.
- Destructive dialogs need a checkbox or typed name.
- Danger buttons are red text on a neutral button until the confirm step,
  where the confirming button is filled.

## App icon

One mark everywhere: the mesh triangle (three nodes, a hub, and the links
between them) in the [Gruvbox Plus](https://github.com/SylEleuth/gruvbox-plus-icon-pack)
app-icon style. `build/icon.svg` is the only source; `pnpm icons` renders
`build/icon.png`, the Linux sizes in `build/icons/` and the website copies
from it, and the UI draws it with `AppIcon` (`components/mesh/AppIcon.tsx`)
in the sidebar, the sign-in titlebar and Welcome step, and the About panel.
Never draw the app mark with a lucide glyph.

Beside the icon, the name is the wordmark `AppWordmark`
(`components/mesh/AppWordmark.tsx`), modelled on T3 Code's sidebar brand:
"Mesh" bold in the text colour, "UI" medium in `text-muted-foreground`.

The app icon follows the pack's measured conventions on a 256 canvas:

- **Box:** the pack's shared rounded-square path (6..250 across, 12..240
  down), filled with a top-to-bottom `#504945` to `#3c3836` gradient.
- **Symbol:** cream `#ebdbb2`, about 164px wide (the pack's median is 166),
  centred so symbol plus shadow sit on (128, 128).
- **Depth:** the symbol repeated 5px lower in `#282828` at 30% as its shadow,
  a 4px top lip in `#fbf1c7` at 60%, and the pack's rim gradient over the box
  (light top edge, darker bottom). No filters or blurs.

Tray icons for a future status bar live in `build/tray/`, in the pack's
panel style: flat filled paths in `currentColor` with the KDE
`ColorScheme-*` classes, at 16, 22 and 24px (`mesh-ui-symbolic.svg` is the
16px monochrome app icon). States: `mesh-ui-tray` (normal),
`-offline` (the symbol at 30%), and `-warning` and `-error`, which add the
pack's standard badge, a 4px dot (radius 2 on the 22px canvas) in the
bottom-right corner with a 1px gap cut from the symbol, in
`ColorScheme-NeutralText` or `ColorScheme-NegativeText`. They use no masks,
because Qt's SVG renderer does not support them.

## Accessibility

- Visible focus ring (`ring` token) on every control; full keyboard use,
  including the command palette.
- Text contrast at least 4.5:1 on its surface in every theme, light and dark;
  status is never colour alone (always dot plus text).
- Respect `prefers-reduced-motion`: no transitions beyond opacity.
- Icons that act as buttons have labels or tooltips.

## Product icons

eero and Echo hardware get their own glyphs in `lib/productIcons.ts`,
drawn in lucide's style (24px grid, 2px stroke, round caps) and built with
lucide's `createLucideIcon`, so they size and colour like any lucide icon.
Every eero shows its status LED; every Echo its light ring, screen or
speaker. Products that look alike share a glyph, so there are 13 in all.

| Glyph | eero products (`model_number`) |
| --- | --- |
| `EeroPuck` | eero 1st and 2nd gen (A010001, J010001), eero 6 (N010001), 6 Extender (Q010001), 6+ (R010001), eero Pro (B010001), Pro 6 (K010001), Pro 6E (S010001); also any unknown eero |
| `EeroUpright` | eero Max 7 (V010001), eero 7 (PA10001), eero Pro 7 (ME10001) |
| `EeroOutdoor` | eero Outdoor 7 (SN10001) |
| `EeroBeacon` | eero Beacon (D010001) |
| `EeroCeiling` | eero PoE 6 (T010001), eero PoE 7 (NV01) |
| `EeroGateway` | eero PoE Gateway (U010001) |

eero Signal (RG4U, RG4W, RG5W) has no glyph: it is eero Plus Internet
Backup (out of scope).

Echos are matched on the device's `model` (eero's `model_name`), because
eero reports most of them as `device_type: generic`. The wording varies
("Echo Dot (3rd Gen) with Clock", "Echo Dot (3rd generation)"), so
`echoIcon` matches the family and then the generation number.

| Glyph | Echo products |
| --- | --- |
| `EchoPuck` | Echo Dot 1st to 3rd gen (with or without Clock), Echo Input |
| `EchoSphere` | Echo 4th gen, Echo Dot 4th gen and later (with or without Clock), Echo Dot Max; also any unknown Echo |
| `EchoCylinder` | Echo 1st to 3rd gen, Echo Plus, Echo Studio, Echo Sub |
| `EchoPop` | Echo Pop |
| `EchoSpot` | Echo Spot (2017 and 2024) |
| `EchoFlex` | Echo Flex |
| `EchoDisplay` | Every Echo Show (5, 8, 10, 11, 15, 21) and Echo Hub |

Echo Link, Link Amp and Amazon Tap use lucide `Speaker`, Echo Look
`Camera`, Echo Connect `Phone`. Bluetooth-only Echo accessories (Buds,
Frames, Auto, Glow, Wall Clock) never join the network. An Amazon device
whose model is missing or not an Echo (Fire TV, Kindle) keeps its type icon.


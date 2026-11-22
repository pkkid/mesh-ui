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
- **1000px content.** The main content of every page is at most 1000px
  wide, centred, set once for the whole app (see [Page width](#page-width)).
- **Flat hero.** Each page opens with a header on the page background, no
  card, closed by a horizontal rule (see [Page header](#page-header-hero)).
- **Buttons act, links go.** Controls that change something (a setting, the
  view, a filter) are buttons, dropdowns, toggles and inputs. Anything that
  only navigates to another part of the app is a text link, in the dim
  `text-muted-foreground` colour, brightening on hover (see
  [Buttons and links](#buttons-and-links)).
- **Subtext under titles.** Muted detail sits on its own line below a
  title, never beside it (see [Sections](#sections)).
- **Pills.** Wherever pills remain (Segmented, a set of choices in a track),
they have no borders: not on the track, not on the selected pill, and no
outline or shadow standing in for one. Selection shows by fill and text
colour alone: the track is `bg-muted`, the selected pill `bg-card` with
`text-foreground` and `font-medium`, the others `text-muted-foreground`.

**Highlights are fill only.** A selected, active or highlighted item
(a list row, a menu item, a pill, the selected color in the theme editor)
shows it by changing its background, and its text colour where needed. It
never adds a border, ring, outline or inset shadow to do it. Only an element
that already has a border at rest (a theme tile, a card) may recolour that
border for its selected state. Focus rings for the keyboard
(`focus-visible`) are separate and stay.

**Scroll fades.** Content that scrolls behind something fixed (a title or
header, a footer or button bar, the top bar) dissolves into it instead of
being cut off at a hard edge or a divider. One look everywhere:
- A mask, not an overlay, so it fades to whatever surface is behind, on
  any theme. 1.5rem tall (`--topbar-scroll-fade-height`), transparent at
  the edge to opaque. The scrollbar lane stays opaque.
- `scroll-fade-y` (in `index.css`) on any scroll box: each edge fades only
  while there is more to scroll that way, so a list at rest is not faded
  at its first row and a box that does not scroll is not faded at all. Used by every sheet's body, the sidebar's page list, the notifications
  list, the title switcher's list, the command palette's results and
  preview, Add theme's results and the Edit theme panel.
- `topbar-scroll-fade` on the page column, whose top edge always fades
  under the top bar.
- A bordered scroll box keeps its border on a wrapper outside the masked
  box, or the fade eats the border (Add theme's results).
- No divider stands in for the fade: a header or title over a scroll area
  has no rule under it ([No divider lines](#no-divider-lines)).

**Dropdowns, not pill toggles.** View choices (range, metric, grouping)
  are dropdowns, never Segmented pill toggles (see
  [Buttons and links](#buttons-and-links)).
- **Room to scroll past the end.** Every page ends with 100px of empty
  space, so the last section can scroll up away from the bottom edge. Set
  once on the page column (see [Page width](#page-width)); pages never add
  or remove their own.
- **Subtitles carry live data.** A subtitle says something about the data
  on screen, built from values that change with it, not a fixed label (see
  [Subtitles carry data](#subtitles-carry-data)).
- **One look per kind of thing.** A download is always the same blue, a
  status is always a dot plus text, a quantity always uses the same formatter.
- **Every action is a command.** Controls map to command ids; risky ones
  confirm first (see [Confirmation](#confirmation)).

## Themes

Themes work as in T3 Code. A `ThemeDefinition`
(`src/renderer/src/lib/themePalettes.ts`, ported from T3 Code's
`packages/shared/src/themePalettes.ts`) is a full set of colour roles for one
appearance, an optional `variants` entry for the other, an optional
`collection` that groups related themes on one card, and an optional series
palette per appearance. `lib/themes.ts` applies the roles as `--theme-*` CSS
variables on `<html>`.

| Theme | Notes |
| --- | --- |
| **Classic** | Default. T3 Code's standard theme as its web app paints it: zinc in light, a true black page, chrome and sidebar in dark |
| Rose | T3 Code's T3 Chat theme |
| Grove | |
| Ocean | |
| Ember | |
| Iris | |

Other looks, Gruvbox included, are VS Code themes the user adds (Open VSX
or a file). Gruvbox is no longer built in; the import's tests use its files
(`test/fixtures/vscode-themes/gruvbox/`, MIT) because their result is known
to match T3 Code's Gruvbox role for role.

**Surfaces, as T3 Code paints them.** The roles map to tokens as in T3
Code's `index.css`: `canvas` is `bg-background`, `chrome` is the body,
`sidebar` is `bg-sidebar`, `surface` is `bg-card`, `surfaceOverlay` is
`bg-popover`. The window paints them the same way:

| Mesh UI | T3 Code | Paint |
| --- | --- | --- |
| `html`, `body` | `html, body` (base layer) | `chrome`, with grain on `body` |
| Navigation sidebar | `sidebar-inner` in `ui/sidebar.tsx` | `bg-sidebar surface-grain` |
| Main pane (topbar and content) | the page column over `SidebarInset` (`ChatView`, `NoActiveThreadState`) | `bg-background`, flat |
| Palette details panel | | `bg-sidebar surface-grain`, as the sidebar |

**Surface grain.** A faint fractal-noise tile (`surface-grain` in
`index.css`, 3.5% opacity, copied from T3) on the body and the sidebar
only. It is texture, not colour, and lifts a dark sidebar a few steps above
its flat role colour (dims a light one): with Gruvbox Dark Hard, whose
canvas and sidebar are both `#1d2021`, the sidebar paints at `#202324` and
the main pane at `#1d2021`, exactly as in T3 Code. T3's `SidebarInset` also
carries the grain, but every page column inside it paints a flat
`bg-background` over it, so the content T3 shows is flat; Mesh UI's main
pane is flat for the same reason. A panel drawn in the sidebar's surface
takes `bg-sidebar surface-grain`; anything on the page stays flat.

**Light and dark are picked separately**, as in T3 Code: the settings hold a
theme id for light mode, one for dark mode, and the mode (System, Light,
Dark). Picking a theme by name sets both; a circle sets only its own mode.

**VS Code themes.** `lib/vscodeTheme.ts` (a port of T3 Code's
`apps/web/src/vscodeThemeImport.ts`; keep the two in step) turns a VS Code
colour theme into a palette:

- `editor.background` is the canvas. The type (`dark`, `light`, `hc-*`) or,
  without one, the canvas luminance sets the appearance.
- The accent is the first of `focusBorder`, `button.background`,
  `textLink.foreground`, `activityBarBadge.background`,
  `progressBar.background`, `badge.background` that stands apart from the
  canvas (contrast 1.1 or more).
- `createVividThemeColors` (`lib/themeColor.ts`) derives every role from the
  canvas and a 20% wash of the accent; roles the theme names directly
  (`sideBar.background`, `editorWidget.background`, `panel.border`,
  `list.*`, `terminal.*`, ...) override it. Translucent colours are flattened
  onto their surface, and text roles must reach 4.5:1 or fall back.
- "X Light" and "X Dark" pair into one theme "X"; several themes from one
  source become a collection, one card with a style per circle.
- Mesh UI also reads `terminal.ansi*` for the chart series (T3 Code does
  not): of each normal and bright pair, the one with more contrast on the
  canvas, at least 3:1; orange is halfway between red and yellow; gray is
  bright black. Themes without ANSI colours use the T3-style mid-tones.

**Picker** (Settings, Application theme, from T3 Code's
`ThemeSettings.tsx`): System / Light / Dark tiles with a small wireframe of the
window in the picked themes, then a card per theme or collection with a light
and a dark circle. The circle in use has a ring and a sun or moon badge. A
collection's circle shows the picked style and "+n"; hovering it fans out its
other styles. **Add theme** searches Open VSX for colour themes (as T3 Code
does: Most popular, Top rated or Newest in a dropdown, each with Install, permissively licensed only, fetched and
checked in main, see [ui.md](../architecture/ui.md)) and imports VS Code or
Mesh UI / T3 Code theme files (choose, drop or paste). An extension becomes
one card; its themes take ids prefixed with the extension, so adding it again
updates it.

**Card actions** (as T3 Code's theme library): one "..." menu after the
card's name, the tables' row menu (`RowMenu`), so the card stays quiet and
the actions are labelled. **Duplicate** (every theme,
built-ins too) opens the theme editor on a copy named "<name> copy", so
built-ins stay read-only. **Edit** (added themes) opens the editor on the
theme itself. **Export** (every theme) saves a theme file through the save
dialog: one theme as `{ version: 1, id, name, appearance, colors, variants?,
series? }` (T3 Code's format; `series` is Mesh UI's and T3 ignores it), a
collection as a JSON array of those, each with its `collection`. Add theme
reads both back and keeps their ids, so importing an export updates the theme
it came from (a built-in comes back as an added copy). **Remove** (added
themes). On a collection, Duplicate and Edit act on the style showing for the
current appearance and name it ("Duplicate Hard"); Export and Remove take the
whole collection.

**Theme editor** (`features/themeEditor/`, ported from T3 Code's
`ThemeEditorPanel.tsx`, `ThemeEditorHost.tsx`, `themeEditorStore.ts`,
`ThemeColorPicker.tsx` and `themeInspector.ts`): a floating panel mounted once
in the window shell, bottom right, on the popover surface (`popoverSurface`),
`no-drag`, z 46 (under popovers and dialogs). Drag it by its header, resize
it from its corner, minimize it. The page stays usable behind it and shows
the draft live (`setThemePreview` in `lib/themes.ts` paints it over the picked
theme until the editor closes); Cancel, Close or Escape put the picked theme
back.

- **Name** and **Appearance** (Light / Dark: the palettes the theme has; a
  palette it lacks is disabled).
- **Colors**, **Simple** (a background and an accent derive every role,
  `createVividThemeColors`) or **Advanced** (every color family Mesh UI
  paints, grouped Foundation, Brand and controls, Sidebar, Status, with a
  filter; editing a family's color re-derives its text and washes,
  `updateThemeColorFamily`). T3 Code's terminal, search and message roles are
  not shown and keep their values. It opens in Advanced, since saved themes
  are hand-tuned.
- **Chart colors**: the eight series hues for the appearance (both modes).
- Each row: the name (click to spotlight where the color is used), a swatch
  that opens a picker popover (saturation plane, hue slider, hex and RGB;
  Escape reverts), and a hex field.
- **Spotlight and Inspect**: selecting a color dims the window with an SVG
  mask and outlines every element it paints, with a use count in the header;
  **Inspect** names the color under the pointer and a click selects it. Both
  probe the CSS variable (`--theme-*` or `--series-*`) with a marker color
  and compare computed paint, and read Mesh UI's Tailwind color classes
  directly. A chart's marks are outlined once, as their `<svg>`. The outline
  is a plain 2px ring, no glow. Refreshes are throttled to two a second, so
  live-polling pages stay cheap.
- **Save** writes the theme library: Edit replaces the theme in place; a new
  theme gets a free id and is picked for its appearances. No custom CSS
  editor (T3 Code has one).

Settings are stored in localStorage (`mesh-ui:theme:v1`, `{ light, dark,
mode }`; the older `{ themeId, mode }` is read too), added themes in
`mesh-ui:themes:v1`, on this computer only.

## Tokens

Use semantic Tailwind tokens, never literal colours. The table maps the
mockup variable to the app token. The hex columns are the mockups' values,
drawn in Gruvbox Hard. Gruvbox added from Open VSX matches T3 Code instead,
and differs on some surfaces (cards share the page colour and stand out by
their border).

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
and purple is safe. VS Code themes (Gruvbox included) take the series from
their ANSI colours (see Themes); the others use T3-style mid-tones
(`#5b9bbd` blue, `#8c7bd1` violet, `#4d9f8a` teal, `#d97757` orange). Check
every chart in light and dark.

Command effect badges (palette, Settings) use a dot in a fixed colour:
query aqua, write blue, disruptive yellow, destructive red. The badge itself is
neutral.

## Typography

Fonts are set once in `src/renderer/src/index.css` (`@theme`):

- `font-sans`: Inter Variable (bundled through `@fontsource-variable/inter`),
  falling back to the system UI font. Used for all text.
- `font-mono`: `ui-monospace`, SF Mono, Menlo, Consolas, Liberation Mono.
  Used for IPs, MACs, serials, code, command ids and stat tile values.

`body` sets 14px, `antialiased`, `text-foreground` on `bg-background`.
`text-2xs` (11px) and `text-3xs` (10px) are custom sizes defined in
`index.css`; the rest are Tailwind's.

### Size scale

Pick from this scale. Each size has a job; a new piece of UI takes the size
of the closest existing job rather than a new value.

| Size | Class | Use |
| --- | --- | --- |
| 10px | `text-3xs` | Chart axis labels, sidebar group labels, stat tile labels, table group headers |
| 11px | `text-2xs` | Fine metadata: counts in the sidebar, badges, timeline day labels |
| 12px | `text-xs` | Metadata, legends, section descriptions, the sidebar's network status line and account role, table headers, tooltips, toasts, `tool` and `xs` buttons, Segmented items, chips, badges |
| 13px | `text-[13px]` | Secondary body: hero buttons, key-value lists, empty states |
| 13.5px | `text-[13.5px]` | Sidebar nav items |
| 14px | `text-sm` / base | Body, default and `sm` buttons, inputs, selects, settings row titles, list row names (eeros, profiles on Overview), the sidebar's network and account names (switcher row, its popup rows, account footer), dialog descriptions |
| 16px | `text-base` | Section headings, hero fact values |
| 18px | `text-lg` | Dialog titles |
| 24px | `text-2xl` | Compact hero figure, stat tile value (mono) |
| 28px | `text-[28px]` | Page title |
| 36px | `text-4xl` | Hero figure |

Off-scale sizes (`text-[9px]`, `[9.5px]`, `[10.5px]`, `[11.5px]`,
`[12.5px]`, `[15px]`, `[17px]`, `[22px]`) still appear in a few places
(device table, palette, timeline, topology, eero and profile cards, sign-in).
Do not add more; move a touched one to the nearest scale size.

### Weights

| Weight | Class | Use |
| --- | --- | --- |
| 400 | default, `font-normal` | Body, descriptions, table headers (`font-normal` resets `<th>`) |
| 500 | `font-medium` | Buttons, nav items, settings row titles, row names, values in fact and metric rows, selected Segmented item, toast titles |
| 600 | `font-semibold` | Page title, section and dialog headings, hero figures, stat tile values, group and tile labels, avatar initials |
| 700 | `font-bold` | Reserved: the "Mesh" wordmark and tiny uppercase tags (the timeline Now label, the device table's tag) |

### Type roles

| Role | Classes |
| --- | --- |
| Page title | `text-[28px] font-semibold leading-tight tracking-tight` |
| Section heading | `text-base font-semibold leading-7 text-foreground` (T3 Code settings section titles) |
| Section description (under the title) | `text-xs text-muted-foreground`, truncates |
| Settings row title | `text-sm font-medium text-foreground` |
| Settings row description | `text-xs leading-normal text-muted-foreground` |
| Group and tile label | `text-3xs font-semibold uppercase tracking-widest text-muted-foreground/70` |
| Hero fact | label `text-xs text-muted-foreground` over value `text-base font-medium tabular-nums` (mono values `font-mono text-sm`) |
| Hero figure | `text-4xl font-semibold tabular-nums` |
| Stat tile value | `font-mono text-2xl font-semibold tracking-tighter tabular-nums` |
| Dialog title | `text-lg font-semibold leading-snug` |

### Text colour

Text uses four levels, all from the theme: `text-foreground` (titles,
values), `text-foreground/80` (status labels, chip text, avatar initials),
`text-muted-foreground` (metadata, descriptions, table headers, resting
icons) and `text-muted-foreground/70` (group labels). Placeholders use
`text-placeholder`. Status colours (`text-success-foreground`, ...) only
for status and errors.

### Rules

- All numbers use `tabular-nums`.
- Group and tile labels are uppercase with wide tracking
  (`tracking-widest`); nothing else is uppercase, chart axis labels
  included.
- Sentence case everywhere ("Restart network", not "Restart Network").
- "eero" is always lowercase, even at the start of a label.

## Shape and spacing

Spacing uses Tailwind's 4px scale (`p-3` is 12px). The shell sizes live as
CSS variables on `:root` in `index.css`.

### Radius

| Thing | Value | Class |
| --- | --- | --- |
| Controls: buttons, inputs, selects, nav items, sidebar rows | 8px | `rounded-(--control-radius)` (`--control-radius`), or `rounded-lg` |
| Segmented track / its items | 9px / 7px | `rounded-[9px]` / `rounded-[7px]` |
| Badges | 4px | `rounded-sm` |
| Tooltips | 6px | `rounded-md` |
| Section cards, notes, popovers, toasts | 12px | `rounded-(--card-radius)` or `rounded-xl` (as T3 Code) |
| Carded page header (being replaced by the flat hero), xl icon tile | 12px | `rounded-(--hero-radius)` |
| Dialogs and sheets ([Modals and popups](#modals-and-popups)) | 18px | `rounded-[18px]` |
| Icon tiles sm / md / lg | 7px / 9px / 12px | set by `IconTile` |
| Chips, status dots, avatars, switches, count badges | Full | `rounded-full` |

### Shell and page

| Thing | Value | Where |
| --- | --- | --- |
| Titlebar height | 44px | `--titlebar-height` (matches `TITLEBAR_HEIGHT` in `src/main/index.ts`) |
| Sidebar width | 15rem (240px; the mockups use 236px) | `--sidebar-width` |
| Sidebar padding | nav `px-2`, items `h-8 px-2.5`, gap 9px to the icon | `features/shell/Sidebar.tsx` |
| Page column | max 1056px (1000px of content), padding 22px 28px 100px | `max-w-[1056px] px-7 pt-[22px] pb-[100px]` in `RouterOutlet` |
| Gap between sections | **56px**, the same as from the hero's rule to the first section, so every section on a page starts the same distance below the one before | Pages wrap the sections after the hero in `flex flex-col gap-14` (grids of side-by-side sections: `gap-x-7 gap-y-14`); the page column itself stays `gap-7`. Overview, Internet, eeros, eero detail and Activity follow this; other pages move over page by page, so check it whenever a page is updated |
| Section heading to card | **15px from the subtitle to the card**; 12px when a section has no subtitle | `gap-[15px]`; `gap-3`. `Section` still defaults to `gap-5` (20px) with a description: Overview passes `gap-[15px]`, other pages move over page by page |
| Section header tools gap | 8px | `gap-2` |
| Card padding | 18px 20px | `Card padded`: `px-5 py-[18px]` |
| Page header (hero) | flat: no side padding, 24px above, 40px below to a 1px rule, 28px after the rule; 28px between columns (Devices: 56px, so its By type bar and Live chart do not crowd) | `pt-6 pb-10 mb-7 border-b`, `gap-7` (see [Page header](#page-header-hero)) |
| List row (`Row`) | 12px 16px, min height 58px, 14px gap | `min-h-[58px] px-4 py-3 gap-3.5` |
| Settings row | 12px 16px, 32px to the control | `px-4 py-3`, `gap-8` |
| Table cell | 8px 12px | `px-3 py-2` |
| Hero actions, toolbars | 8px between controls | `gap-2` |

### Control heights

| Height | Class | Used by |
| --- | --- | --- |
| 20px | `h-5` | Badges, switches (`h-5 w-9`) |
| 24px | `h-6` | `xs` buttons (QR block), chips, Segmented `sm` items |
| 28px | `h-7` | `sm`, `hero` and `tool` buttons, `tool` selects, the Segmented `tool` track |
| 30px | `size-[30px]` | Topbar icon buttons |
| 32px | `h-8` | Default buttons, inputs, default selects, sidebar nav items, toolbars |
| 36px | `h-9` | `lg` buttons |

### Icons

lucide icons. 16px (`size-4`) in nav items, default buttons and inputs;
14px (`size-3.5`) in `hero`, `tool` and `xs` buttons, Segmented items and
select chevrons; 12px (`size-3`) in badges. Resting icons are
`text-muted-foreground` and turn `text-foreground` on hover or when active.

### Page width

Every page's content is at most **1000px** wide, centred in the main pane.
The cap lives in one place, the content column in `RouterOutlet`
(`src/renderer/src/app/router.tsx`: `max-w-[1056px]` with `px-7`, so 1000px
inside the padding), and every page renders inside it.

- Pages never set their own max width, and never widen past the column
  (no negative margins or full-bleed breakouts).
- A page that should read narrower (a form, a settings list) narrows inside
  the column; it does not change the column.
- Check wide windows: at 1600px and up the content stays 1000px and the
  margins grow.

## Borders and surfaces

Every border is 1px. Colour comes from two tokens, softened with opacity:

| Border | Class | Used by |
| --- | --- | --- |
| Default | `border` (`border-border`) | Dialogs, popovers, tooltips, outline badges, the rule under the page header, table header rule, chips |
| Card edge | `border-border/60` | Section cards, toasts (`/50`) |
| Row divider | `divide-y divide-border/50`, `border-b border-border/50` | Rows inside a card, table rows |
| Control | `border-input` | Outline buttons, inputs, selects |
| Focus | `ring-2 ring-ring` (inputs: `ring-[3px] ring-ring/24` and `border-ring`) | Every focusable control |
| Inset outline | `shadow-[inset_0_0_0_1px_var(--color-border)]` | Avatars, icon tiles |
| Sidebar edge | `border-e`, coloured in `index.css` (`[data-app-sidebar]`) | Sidebar |

No double borders: a card inside a card, or a bordered box flush against a
card edge, is a mistake. Dashed borders mean "unknown" or "off" (a switch
eero does not report, a disabled schedule).

Backgrounds, from back to front:

| Surface | Class |
| --- | --- |
| Page, titlebar, tooltips | `bg-background` (flat), `bg-tooltip/95` |
| Sidebar | `bg-sidebar surface-grain`; rows `bg-sidebar-row-hover`, `bg-sidebar-row-selected`; an icon button inside a row (Sign out) `hover:bg-foreground/8`, and the row drops its own hover while the pointer is on it |
| Section card | `bg-card/40`, `shadow-xs/5` |
| Hover on rows and cards | `hover:bg-muted/50` (rows), `hover:bg-muted/30` (cards) |
| Inset: Segmented track, badges, avatars, icon tiles, table group rows | `bg-muted` |
| Selected Segmented item, on its `bg-muted` track | `bg-card` |
| Outline buttons, popovers, dialogs, toasts | `bg-popover` (outline buttons `dark:bg-input/32`) |
| Inputs | `bg-background` (`dark:bg-input/32`) |
| Dialog backdrop | `bg-background/60` (`/64` dark), `backdrop-blur-[2px]` |

Shadows are faint: `shadow-xs/5` on cards, outline buttons and inputs;
`shadow-lg` only on floating things (tooltips, toasts, popovers); dialogs
use their own deep soft shadow.

## Layout

### Shell

Sidebar on the left (`bg-sidebar`, a 1px right divider in the sidebar text
colour at 10% light and 8% dark, as T3 Code draws it, `[data-app-sidebar]`
in `index.css`; Rose keeps its tinted `sidebarBorder` in dark): app icon, network
picker (on the selected-row surface, like the active nav item; selections
have no outline, as in T3 Code), nav groups **Network** and **Settings**, and the account name
and role at the bottom as plain text (no icon or avatar, not a link) with a
sign-out icon.
Main pane: a 44px top bar (breadcrumbs, page navigation, search,
Refresh, notifications, theme toggle, window controls) over a scrolling content
column. The top bar paints no background of its own (the main pane's
flat canvas shows through, so it matches the content and the
transparent native window controls exactly) and has no bottom border: as in T3 Code, the scroll column's
top 1.5rem fades from transparent to opaque (`topbar-scroll-fade`, a mask;
the scrollbar lane stays opaque), so content scrolling up dissolves under the
bar. The search field keeps about 26px to the Refresh glyph (`me-[15px]` on top of the 4px gap), set by eye against the space the theme toggle keeps to the native window controls. Headless screenshots cannot show the native controls; check this one in a real window. Its icon controls (Refresh, bell, theme) are neutral 30px ghost
buttons with a `title` tooltip naming any shortcut ("Refresh (F5)", the current binding);
a running Refresh only spins its icon (rotation, no other animation). The top strip of each pane is the
window titlebar (`drag-region`); controls in it need `no-drag`, and it
respects `--titlebar-inset-left/right`. See
[architecture/ui.md](../architecture/ui.md#shell).

**Crumb switcher.** On a detail page (device, eero, profile) the last
crumb, the item's name, is a button (`TopBarTitleSwitcher` in
`features/shell/TitleSwitcher.tsx`), copied from T3 Code's thread title: no
border or fill at rest, a `size-3.5` muted chevron after the name that fades
in on hover, keyboard focus and while open. It opens a `PopoverPopup` (300px for devices, 240px for eeros and
profiles)
(at most 60vh, the list scrolling inside) of every sibling in the list
page's order: devices in the Devices table's order (the `[` / `]` order),
then any its filters hid; eeros and profiles in their list order. The
current one has a check and is scrolled into view. A row is the icon
(`deviceIcon`, `eeroIcon`; profiles have none), the name, and muted context
on the right: a device's eero with a status dot (its profile still matches a search
but is not shown) (online,
paused, blocked, offline), an eero's status, a profile's Paused or
Scheduled. Lists longer than 10 get a filter field, focused on open, that
ranks matches as the command palette does (`siblingHits` in
`palette/search.ts`), with one muted line when nothing matches ("No devices
match."). Up and Down move the highlight, Enter opens, Esc closes.

**The titlebar holds navigation and global tools only**: breadcrumbs,
search, Refresh, notifications, theme, and Prev / Next on detail pages.
**Rename lives in the hero.** Detail pages (device, eero, profile) put
**Rename…** first in the hero's action row, opening the shared Rename sheet
(`components/ui/rename-sheet.tsx`), never as a name field in a settings
row. A device's icon is changed by clicking the icon in its hero.

**Page actions live in the page**, in the hero actions or a section's tools
(Add a profile sits in the Profiles section header beside Pause all). Pages
that still use the titlebar actions slot for page actions are tracked in
#323.

### Page header (hero)

Every page opens with the same header, `PageHeader` in
`components/ui/hero.tsx`. **The Overview hero (`NetworkHero`) is the model
for every page**: a flat header that sits on the page background, not in a
card.

**Frame and spacing (the flat hero):**

- **No outline or card.** No border box, background, radius or shadow
  around the header. It reads as the top of the page, not as one more
  section.
- **A horizontal rule under it.** A 1px `border-b` (`border-border`) across
  the full content column (1000px) closes the header and separates it from
  the sections below. It is the only rule on the page; sections keep their
  own cards.
- **Space above:** 24px (`pt-6`) inside the header, on top of the page
  column's 22px top padding, so the title starts 46px below the titlebar.
- **Space below the content:** 40px (`pb-10`) from the lowest thing in the
  header (the actions row, or the bottom of the aside) to the rule.
- **Space after the rule:** 28px (`mb-7`) plus the page column's 28px
  section gap, so the first section heading starts 56px below the rule.
- **No side padding.** The header's content lines up with the left and right
  edges of the sections below it.
- The actions row gets an extra 12px (`mt-3`) above it, so the buttons sit
  apart from the facts.

These values live once in `PageHeader flat`; pages pass `flat` and never
set their own margins or padding on the header.

**Content, top to bottom on the left:**

- optional icon tile (`IconTile size="xl"`: 64px, 12px radius) on the
  left, **top-aligned with the title** (Overview has none). **No avatars**:
  a person's hero (Account) is their name alone, without an initials
  circle;
- title on the top row;
- status line under it: status dot plus plain text, then muted context
  ("Online · Gateway up 23 days, 4 hours");
- optional key facts as label-over-value pairs (ISP, Public IP, Last speed
  test) in a wrapping row, 40px apart (`gap-x-10`) with 12px (`gap-y-3`)
  between wrapped lines, set once in `PageHeader` so no page sets its own
  fact spacing;
- **actions in a row at the bottom**, all `outline` buttons (never filled), the main action first, disruptive last.

Everything in the header is **pinned to the top**. The left column (icon,
title, status, facts, actions) and the right-hand column (gauges, QR block,
hero figures) both start at the top padding and are never centred against
each other, so a tall aside leaves the title where it is. Inside the aside,
its own pieces keep their layout (the QR block's buttons sit centred beside
the code).

Every button in a header is the `hero` size (28px, `h-7`, 13px text,
14px icons), on every page: the actions row, the buttons in the right-hand
column (Pause profile). The exception is the QR block: its stacked buttons
(Copy, Save QR, Print a card, Send to a guest) and "Show code" over an
empty QR frame are `xs` (24px, `h-6`, `text-xs`), so four of them fit
beside the 116px code. `PageHeader` and `QrBlock` set their size once through
`ButtonSizeContext` in `components/ui/button.tsx`, so buttons inside them
leave `size` off; a size given at the call site would break the match.
Dialogs opened from a header reset it, so their buttons keep their own sizes.

**Moving pages to the flat hero.** Overview and Devices pass `flat` today;
the other pages still draw the older carded header (`bg-card/40`, 1px
`border-border/60`, 12px radius, `px-6 py-[22px]`). New pages use `flat`,
and the rest move over page by page. Once every page is flat, `flat` becomes
the only `PageHeader` style and the card styling is removed.

Guest network and Wi-Fi put a **QR block at the top right** of the header,
with labelled buttons (Copy password, Save QR, Print a card) to its left
(`components/ui/qr.tsx`, see Components).

### Sections

**Sections are subtle cards**: a `<section>` with a heading row
(`text-base font-semibold` title, optional muted text under it, controls on
the right) above a card styled as T3 Code's settings groups: `bg-card/40`, a
1px `border-border/60`, `shadow-xs/5`, 12px radius. Rows inside are divided
by `border-border/50` (`divide-y divide-border/50`); settings rows are
`px-4 py-3` with a `text-sm font-medium` title over a `text-xs
leading-normal text-muted-foreground` description, the control 32px to the
right (T3's `SettingsRow`).

**Subtext goes under the title, never beside it.** Any muted line that
belongs to a title (a section's freshness or count line, a settings row's
description, a card's detail) sits on its own line below the title, in
`text-xs text-muted-foreground`. The title stays alone on its line, so
titles line up down the page and the subtext can be as long as it needs.
In a section this is `Section`'s `description` (15px from the subtitle to the card,
tools aligned to the bottom of the heading block); its older `subtitle`
prop, which draws the text beside the title, is not used for new sections,
and existing uses move to `description` when touched. The title and tools
never wrap; a subtext too long for the line truncates with an ellipsis and
shows in full in its tooltip.

### Subtitles carry data

A subtitle earns its line by telling the reader something they would
otherwise have to work out from the section. **Build it from the data**:
counts, totals, shares, the busiest or worst item, what is unusual right
now. A fixed label is about a tenth as useful.

| Section | Static (avoid) | Data-driven (do) |
| --- | --- | --- |
| eeros | "Your mesh nodes" | "4 eeros · 4 online, 1 weak link" |
| Top devices | "Last 24 hours" | "Last 24 hours · 78% of all traffic" |
| Data usage | "Download and upload" | "Last 24 hours, 38 devices" |
| Top profiles | "Last 24 hours" | "24 hours, 1.2 GB" |
| When the network is busy | "This week" | "Busiest Thursday, 4 to 6 PM" |
| Recent activity | "Latest events" | "7 events" |

- **Keep it short**: a few words, no sentence. Name the window bare ("24
  hours", "7 days", not "Last 24 hours" or "This week"), then the fact that
  changes, joined by a comma: "24 hours, 1.2 GB". The newest sections
  (Top profiles, busy heatmap, Recent activity) follow this; the older ones
  above still say "Last 24 hours" and use " · ".
- Lead with the scope when the section has one (the range, the filter),
  then the fact that changes.
- **Skip the window when the content already shows it**: the busy heatmap's
  Mon to Sun grid is obviously a week, so its subtitle is just "Busiest
  Thursday, 4 to 6 PM".
- **Only state a window that is true.** Leave the span out when the data
  does not cover a fixed one: Recent activity says "7 events", not "24
  hours, 7 events", because events are kept only from eero's last ~15
  minutes plus the time the app has been open.
- Call out what needs attention (weak links, offline, over plan) before
  what is fine, and leave out zero counts ("1 weak link", never
  "0 offline").
- Use the shared formatters (`formatCount`,
  `formatPercent`, `formatBytes`) so numbers match the rest of the app.
- While the data loads, show the static part alone ("Last 24 hours") or
  `-`, never a made-up number; the text fills in when the data lands.
- A static subtitle is the last resort, only when nothing about the data
  can be said. If a subtitle would only repeat the title, leave it out.

**Header tools are 28px.** Every control in the tools slot (buttons,
`HeaderLink`, Segmented toggles, selects, and inputs such as a filter box) is 28px tall, the height of the
title's line, so their top and bottom edges line up: buttons are the `tool`
size (`h-7`, 12px text, 14px icons) and Segmented its `tool` size (3px padding,
`p-0.5`, 22px items). `Section` sets both once through `ButtonSizeContext`
and `SegmentedSizeContext`, so call sites inside the tools slot leave `size`
off, like the page header. A shared button that also appears outside a header
(`CopyCommandButton`) reads the context and falls back to its own size.
`Input` reads the same context: in the tools slot it is 28px outside with
12px text and a 14px icon (elsewhere 32px, like default buttons and selects).
Heights are measured outside the 1px border: the field's border sits around
the input, so the input itself is 26px (30px by default), as the Devices
filter does it, so a filter box and the button beside it
(Reservations & ports: Filter and Add a reservation…) always line up. Never
size an input in a header by hand.

| Control row | Height |
| --- | --- |
| Section header tools | 28px (`tool`) |
| Page header (hero) actions | 28px (`hero`, 13px text) |
| Segmented outside a header (forms, settings) | 30px (`sm`, the default) |
| Toolbars (Devices filter row) | 32px (`h-8` inputs, buttons and dropdowns) |

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
| Button | `button.tsx`. 8px radius, 1px border, `font-medium`. Variants: `default` (filled `bg-primary`), `outline` (`bg-popover`, `border-input`), `ghost` and `ghost-muted` (no border, `hover:bg-accent`), `secondary`, `destructive` (filled red, white text), `warning` (filled yellow, `text-black/85`; only the confirm button of a disruptive action), `link`. Sizes: `default` 32px 14px text, `sm` 28px, `hero` 28px 13px text, `tool` 28px 12px text, `xs` 24px 12px text, `lg` 36px, `icon` / `icon-sm` / `icon-xs` squares of 32 / 28 / 24px. Disabled at 64% opacity; pressed scales to 97% |
| Segmented toggle | Pills ([below](#pills)): a `bg-muted` track, the selected segment on `bg-card` in the foreground colour, no border or shadow on either. Used for Day / Week, metric switches, Email / Phone. Three sizes: `tool` (28px) in section headers, set by `Section`; `sm` (30px, the default) in forms and settings; `md` (32px) in toolbars beside `h-8` inputs and buttons |
| Switch | `switch.tsx` (Base UI `Switch`, ported from T3 Code), the only switch in the app; `switch.test.ts` fails on a hand-made `role="switch"`. 36 x 20 (`h-5 w-9`), full radius, a 16px `bg-background` knob that squashes slightly while pressed. `bg-primary` when on, `bg-muted` with a border when off, a dashed border that cannot be used when eero does not report the value (`checked` null, tooltip "eero does not report this setting"). Disabled at 64% opacity with the reason as its `title`. One size everywhere, table rows included. Settings rows use `WriteSwitch` (`features/advanced/SettingsGroups.tsx`), which takes a gate and a busy flag |
| Input, select | 32px (`h-8`), 8px radius, `border-input`, `text-sm`, `bg-background` (`dark:bg-input/32`). Focus, as T3 Code: `border-ring` and a 3px glow inside the border (`ring-[3px] ring-inset ring-ring/24`), never outside. Text fields use `components/ui/input.tsx`, with no decorative icon (no pencil); an optional 16px leading icon only when it says what to type (search); selects also have a 28px `tool` size. Mono (`font-mono`) for IPs and MACs |
| Chip | 24px (`h-6`), full radius, 1px border, `bg-card`, `text-xs text-foreground/80`, for filters; selected chip gets a stronger border, not colour |
| Status | `size-1.5` dot in the status colour plus `text-xs text-foreground/80` label ("Online", "Weak link"). No pill outline, fill or uppercase |
| Badge | `badge.tsx`. 20px (`h-5`), 4px radius, `text-xs font-medium`, neutral `secondary` by default, for counts, versions, "Gateway". Status variants (`success`, `warning`, `error`, `info`: an 8% tint, 16% dark) only for status |
| Role label | A word that tags a name ("Gateway" beside an eero) is plain dim text, `text-xs text-muted-foreground font-normal`, never a pill or outlined badge. `GatewayLabel` in `badge.tsx` is the gateway one, used everywhere an eero is named |
| Icon tile | Neutral square with inset border, icon in `text-muted-foreground`; sizes 24, 32, 44, 64 |
| Avatar | `avatar.tsx`. Round, initials in `font-semibold`, inset 1px border, `bg-muted` or the profile colour from `chartColors.ts`. Sizes `sm` 26px, `md` 36px, `lg` 56px |
| Signal bars | Four bars; one bar red, two yellow, three or four in text colour |
| Settings rows | Card with rows split by 1px borders: title, muted description, value or control on the right, chevron if it opens something |
| Note | Bordered inset box with an icon in the status colour and body text in normal colour, for real warnings |

| Key-value list | `kv-list.tsx`. Two columns, muted keys, `tabular-nums` values; IPs, MACs and serials in mono with a small copy button |
| Band badge | `band-badge.tsx`. The neutral Badge box with "2.4 GHz", "5 GHz", "6 GHz" or a cable icon and "Wired". Never coloured: band colours are for chart series |
| Meter | `meter.tsx`. `h-1.5` bar on `bg-muted` for plan use and utilisation; neutral fill (`bg-foreground/70`), or the series colour via `color` for a series share (download and upload plan meters), `warning` from `warnAt`, `destructive` from `dangerAt`; empty track for a missing value |
| Device icon | `lib/deviceIcons.ts` `deviceIcon(device)`: the only map from a device to an icon, shown in an Icon tile. An Amazon Echo is matched by its model name first (see [Product icons](#product-icons)), then the device type, then core's guess for a `generic` device (`inferredType`), then the category. A device nothing is known about gets a neutral device icon (`MonitorSmartphone`), never a question mark. Never map device types to icons anywhere else |
| eero icon | `lib/deviceIcons.ts` `eeroIcon(eero)`: the only map from an eero to its product glyph, by `modelNumber`, then the model name, then the puck. See [Product icons](#product-icons) |
| Tooltip | One surface for every tooltip: `tooltipSurface` in `charts/Tooltip.tsx` (`bg-tooltip/95`, 1px `border`, `rounded-md` (6px), `shadow-lg`, `text-xs`, backdrop blur). Chart tooltips, the share bar and the donut use it, and `ui/title-tooltips.tsx` (mounted once in `main.tsx`) draws every `title` attribute with it, centred above the element after 500ms, instead of the OS tooltip. So components keep writing plain `title="..."` |
| Popover | `popover.tsx` (trimmed from T3 Code's). `PopoverPopup` anchors under its trigger (`side="bottom" align="start"`, 4px offset), `no-drag`, and is capped at the available height with its content scrolling inside. One surface, `popoverSurface`: `bg-popover`, 1px border, 12px radius, `shadow-lg`, `text-xs`, with shared list, item and separator classes. Every popover uses it ([Popovers and menus](#popovers-and-menus)) |
| Menu | `menu.tsx` (trimmed from T3 Code's). `Menu`, `MenuTrigger`, `MenuPopup`, `MenuItem` (`variant="destructive"`), `MenuSeparator`, `MenuSub`, `MenuSubTrigger`, `MenuSubPopup`, on the popover surface and item classes ([Popovers and menus](#popovers-and-menus)) |
| Dialog and sheet | `dialog.tsx`, `sheet.tsx`, `confirm.tsx`. `bg-popover`, 1px border, backdrop `bg-background/60` with a 2px blur; every one opens at `--dialog-top`. Kinds, sizes, look and behaviour: [Modals and popups](#modals-and-popups) |
| QR block | `qr.tsx`. **Plain** (`QrCode plain`, the Guest network and Wi-Fi network heroes): the code at error correction level L with no tile or glyph, so a guest `WIFI:` payload is 29 x 29 modules instead of 41 x 41, drawn as round dots (radius 0.46 of a module, so scanners still read them) with the three finder patterns as rounded squares, in the full text colour on screen (a 60% dim was tried and dropped). Both heroes frame it in a 1px rounded border with 15px of padding and no buttons beside it; their share actions are hero buttons (**Copy invite**, **Copy password**). Wi-Fi network keeps the frame empty, with **Show code** centred in it, until clicked. Standard: `QrBlock`: `xs` outline buttons stacked on the left (Copy with a page label such as "Copy password", Save QR, then any page actions), the code with a muted `text-xs` caption on the right; `QrCode` is the code alone. On screen the code follows the theme: `text-foreground` modules on a `bg-card` tile with a quiet zone and 1px border, so the dark theme shows light modules on a dark tile (current iOS and Android cameras read inverted codes; Gruvbox foreground on card is about 12:1). The Mesh UI glyph (the three nodes from `build/icon.svg`) sits in a cleared square in the middle, about a quarter of the width, in the modules' colour; the code is encoded at error correction level H so the hidden modules (under 8%) never stop it scanning. An empty muted frame while the payload loads. What leaves the app stays black on white, the only fixed black and white: Save QR writes a black-on-white PNG (4-module quiet zone, glyph included) through Chromium's download save dialog. (The printed guest card was dropped on 2026-11-20 with Print a card.) Encoder: `uqr` (MIT, pinned) |
| Week timeline | `timeline.tsx`. `WeekTimeline`: a lane per day, Mon to Sun (day label `text-2xs` uppercase, today in `text-foreground` with a stronger lane border), hour gridlines, blocks in the schedule's colour at 78% with `text-background` label (icon from 3 h, label from 2 h), disabled schedules as a dashed muted outline "(off)", a 2px Now line on today, ticks 12 AM, 6 AM, 12 PM, 6 PM, 12 AM. A span ending at or before its start wraps past midnight and splits across two days (Sunday into Monday). `layoutWeek` is the pure layout. Shared by profile schedules and power saving |

**Buttons.** Primary (filled `bg-primary`, the `default` variant) is used
sparingly: only for the submit button of a sheet, dialog or form (Save,
Create invite, Send code, Add theme), a plain write's confirm, the sign-in
flow, and the one action
that switches on a page whose feature is off (Guest network's **Turn on
guest network**): there the whole page is waiting on that one step. Hero actions are
never filled, not even the main one (Run speed test, Pause): every button in
a hero is `outline`. Everything in section headers, the topbar and toolbars
is `outline` or `ghost` (Add a reservation, Add port forward, Add a
profile, Run again). This follows the restrained colour rule: buttons are
neutral.

### Buttons and links

**Dropdowns, not pill toggles.** A choice between views (a range, a metric,
a grouping) is a dropdown: `Select` with `SelectTrigger size="tool"` in a
section header, as in Overview's Data usage ("Last 24 hours") and
Internet's Speed test history ("Last month", "All results"). Option labels
say what you get, not a bare unit ("Last month", not "Month"; "All
results", not "All"). Do not add new Segmented toggles; existing ones (Day /
Week, Devices' status filter, Grouped / Raw) move to dropdowns page by page.

**An ellipsis means "asks first".** A button whose click opens a confirm
or asks for more input before anything happens ends its label with an
ellipsis character (`…`, U+2026, not three dots): "Restart network…",
"Rename…", "Add a reservation…". A button that does its job on click has
none, even when its result shows in a sheet or dialog: Share Wi-Fi opens
the QR sheet, and that sheet is the action, so it is "Share Wi-Fi". The
same goes for menu items and command palette entries. Overview, Devices
and device detail follow this; other pages move over page by page.

**Hover colour fades.** Anything that changes colour on hover (dim to
bright text, a row or card background) eases with `transition-colors`
(150ms), never a hard switch: section links, the titlebar search, rows and
clickable cards all fade the same way.

**Hover changes the background, never the border.** A hovered control, row
or card fades in a background (`hover:bg-accent`, `hover:bg-muted/50`) and
keeps its border exactly as it was: no `hover:border-*` that brightens,
darkens or adds an outline. Keyboard focus still shows the focus ring.

**Header actions sit on the title's line.** In a card or row header with an
icon, a title and a subtitle under it, the status and buttons on the right
(Online, Blink light, View eero) are level with the title, not centred on
the two lines: top-aligned in a 20px box (`flex h-5 items-center
self-start`), the title's line height.

**Disruptive actions sit apart.** A section of disruptive or destructive
actions (Restart network, Danger zone) is its own full-width section at the
bottom of the page, never tucked beside read-only content.

**Off watermarks.** When a feature is off and its content has nothing to
show (Live throughput off on Devices, the guest network off), the space
holds a watermark instead of an empty card: a lucide glyph at `size-12`,
`strokeWidth={1.6}`, in `text-foreground/7`, beside the words in
`font-semibold text-xl text-foreground/13` ("Live throughput off", "Guest
network off"), centred in an `h-40` band with no border or background. It
is decoration (`aria-hidden`); the status and the way to turn it on live in
the hero.

**Footnotes are extra dim.** An info line under a card (the speed test
note, the eeroOS line, the wired backhaul note, Activity's note on how far
eero's events reach) is plain `text-xs text-muted-foreground/50`, half as
strong as normal muted text, so it never competes with the content.
**Footnotes have no icon**: no Info, check or arrow glyph in front, just the
text. Use
`Footnote` from the page kit. **Explanations go in a footnote, not in the
card**: a line that explains the data (where it comes from, why it stops)
sits under the card, never as a footer row or a last row inside a table or
list. A card's footer row is only for a control on its rows (Load older
events). A
link inside one is dimmed the same way (`text-foreground/50`, underline
`decoration-foreground/25`, `hover:text-foreground/70`), so only the
underline marks it.

**Icons in buttons are dim.** A button's icon uses `text-muted-foreground`
while its label stays `text-foreground`, so the words lead and the icon
supports them (`[&_svg]:text-muted-foreground` on the button). **Buttons
side by side share a variant**: hero actions are all `outline`, never an
outline next to a borderless `ghost`, which reads as a stray label. Overview
follows both (Share Wi-Fi, Restart network); other pages move over page by
page.

**Buttons act, links go.** Pick the element by what happens on click:

| Click does | Element | Examples |
| --- | --- | --- |
| Changes a setting or the network | Button, switch, input | Restart network, Pause, Save, Add a reservation |
| Changes the view of this page | Dropdown (see below), button | Range (Last 24 hours), Group by, Columns |
| Opens a sheet, dialog or menu on this page | Button | Share Wi-Fi, Copy details, Filters |
| Navigates to another page or section | Text link | View topology ->, View all devices ->, View history |

- **Section header links** use `SectionLink` (`components/ui/page.tsx`):
  `text-xs text-muted-foreground`, a 14px `ArrowRight` after the label, and
  `text-foreground` on hover. No border, background or underline; the arrow
  says it goes somewhere. It sits in the section's tools slot, right-aligned
  like a button would.
- **Links are dim.** A standalone link to another part of the app (a
  section header link, a "View all" under a list) uses
  `text-muted-foreground` at rest and turns `text-foreground` on hover. It
  is secondary to the content around it and must never outshine a section
  title or a value (bright links were tried and stood out too much). The
  arrow, the hover and the pointer cursor mark it as clickable. Colour stays
  neutral: no blue or accent links.
- **Links that leave the app** (they open the user's browser, such as
  device detail's "Look up online") look the same as section header links
  but end with a 14px `ExternalLink` icon instead of the arrow, so it is
  clear they open outside Mesh UI.
- **Navigation links start with "View".** Name the destination after the
  verb: "View topology", "View all devices", "View all activity", "View
  history". Never a bare "All" or a lone noun.
- **Inline links** inside a sentence of muted copy ("Set your internet
  plan", "View history") use `TextLink` (underlined `text-foreground`, see
  Page kit): the underline is what separates them from the words around
  them, and they are as small as that copy.
- Rows and clickable cards that open a detail page stay rows and cards; the
  rule is about what to draw in place of a button.
- Do not style a link as a button, or a button as a link: a link never runs
  a command, and a button never only navigates.

Overview follows this (View topology, View all devices, View all profiles, View all activity). Other pages still use
`HeaderLink`, an outline button that navigates, and move to `SectionLink`
page by page.

### Filter bar

List pages filter with one pattern, `components/ui/filter-bar.tsx`, used by
Devices and Activity. Do not build another.

- A bare toolbar (no card), 32px controls, every one the same height
  (`FilterSearch` included: its field is 32px outside, border and all):
  `FilterSearch` (search icon, `/` hint; `useSlashFocus` wires the key, Esc
  clears) first, then page-specific filters as `FilterDropdown`s (Devices'
  Status), not segmented pills, then the `FiltersButton`.
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

- Header `text-xs text-muted-foreground font-normal`, 1px bottom border,
  in normal case ("Band", "Channel"), never uppercase. This includes
  table-like grids such as the radio table in eero cards.
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
`PlaceholderRows` (blank rows at normal height while loading), `SectionLink` (text link in a section header, see [Buttons and links](#buttons-and-links)), `HeaderLink`
(small outline button in a section header, optional arrow),
`Footnote` (the dim info line under a card, see [Buttons and
links](#buttons-and-links)), `ComingSoonButton` (disabled, "Coming soon"
tooltip, for writes in a later milestone), `SectionError` (what failed, eero's message, Retry; other
sections keep working) and `useNow` (a ticking clock for relative times).

**Clickable cards.** A large card that opens a detail page (an eero card,
a profile card) is one clickable target: `<Card to={path}>` with its title in
a `CardLink`. A click anywhere on the card opens the page; there is no
chevron or "Details" button. The card gets `cursor-pointer` and, on hover,
`bg-muted/30` only, with `transition-colors` (no brighter border, no
movement, no shadow; a brighter outline was tried and was too loud). The title link is the
keyboard focus target: focusing it gives the card the hover background plus
the focus ring, and Enter opens it. Buttons, links, inputs and menus inside the
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
  `confirm`. Every confirm is the same modal ([Modals and popups](#modals-and-popups)): `confirmIn: "dialog"`
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
  [overview.md](../ux/overview.md#sheets) and [Sheet](#sheet) under Modals
  and popups. Choices inside a sheet are dropdowns (`Select`, full width or
  sharing a row with related fields), never Segmented, and on/off is the
  standard 36x20 switch. Shortcuts that fill a field (the schedule sheets'
  day presets) are plain text links, not pills or chips. A picked tile in a
  grid of choices (the device icon picker) is marked by a background
  (`bg-accent`, as a pressed button), never an outline.
- **Schedule fields** (`ui/schedule-fields.tsx`), shared by every schedule
  sheet (a profile's scheduled pause, power saving): `DayPicker` (the days
  as one connected control in Segmented's look, any number picked, presets
  under it), `TimeSelect` (the app's dropdown in 15 minute steps, never the
  native time input) and `DayBar` (one day, midnight to midnight, the span
  in the `foreground` colour, as text, dashed while the schedule is off;
  10px tall, so it previews without shouting).

```tsx
const rename = useWrite<{ eero: string; name: string }>("eero.rename", { form: true });
const restart = useWrite("eero.restart"); // confirms in the app's dialog

<GatedButton gate={useGate("eero.restart")}
  onClick={() => restart.run({ eero: id }, { success: `Restarted ${name}`, progress: `Restarting ${name}` })}>
  Restart
</GatedButton>
```

The dev gallery's Write kit section shows each piece.

## Modals and popups

One standard for everything that floats over a page (#346). Every kind is
on its shared component; feature files pass content and placement, never a
surface of their own.

### Kinds

| Kind | Use it for | Built with |
| --- | --- | --- |
| Confirm | A yes or no before a `disruptive` or `destructive` action, or a write the UI asks about first (`askFirst`). Nothing to fill in except a type-to-confirm name | `ConfirmDialog` (`ui/confirm.tsx`), opened by `useWrite`; `WriteConfirmDialog` inside another dialog |
| Sheet | A form (an editor, Edit name, Change email and its code, Transfer network) or content that is the action itself (Share Wi-Fi's QR, Invite an admin) | `Sheet` (`ui/sheet.tsx`) |
| Popover | A panel anchored to its trigger: filters, notifications, the network switcher, pickers | `PopoverPopup` (`ui/popover.tsx`) |
| Menu | A short list of actions on one target or selection: a row's Actions, the bulk bar | `MenuPopup` and `MenuItem` (`ui/menu.tsx`) |

A single field or switch is edited in place on the page, never in a modal.
The command palette is its own kind and the one exception to the position
rule below.

### Size

Modals take one of three widths, never a free value:

| Size | Width | Used by |
| --- | --- | --- |
| Confirm | 448px (`max-w-md`) | Every confirm |
| Sheet | 540px | Every sheet (the default), Share Wi-Fi included |
| Wide sheet | 640px | A sheet whose content needs the room: the device icon picker |

Height follows the content. A modal never grows past the window: it keeps a
16px gap at the bottom and its body scrolls inside, header and footer fixed.
Popovers and menus size to their content (a list at least 176px, `min-w-44`)
and are capped at the space available below their trigger, then scroll; a
list also stops at 320px. See [Popovers and menus](#popovers-and-menus).

### Look

- **Surface:** `bg-popover`, 1px `border`, 18px radius (`rounded-[18px]`) for
  every modal, confirms included; the shadow and backdrop from
  `ui/dialog.tsx` ([Borders and surfaces](#borders-and-surfaces)). Popovers
  and menus use `popoverSurface`: 12px radius, `shadow-lg`, `text-xs`.
- **Padding:** 20px at the sides (`px-5`), `pt-5` above the header and
  `pb-4` under the buttons. Menus and popovers have 4px (`p-1`) inside, items
  `px-2.5 py-1.5` with an 8px radius.
- **Breathing room:** 30px under the title section and 30px above the
  button row, in every modal, sheets and confirms alike. On a confirm the
  title section is the title alone, so it reads title, 30px, message, 30px,
  buttons (`gap-[30px]`, `pt-[30px]`); a type-to-confirm field sits under the
  message, still 30px above the buttons. On a sheet it is title and muted
  line, 20px, fields, 30px, the footer band.
- **Header:** no icon tile. A sheet's header is the title (`text-base
  font-semibold`) and an optional muted `text-xs` line on what it affects
  ("Mia · pauses all 4 devices automatically"). A confirm's header is its
  title alone in `text-base font-semibold`; its message is
  `text-foreground/80`.
- **Title colour says how serious it is:** red
  (`text-destructive-foreground`) for a `destructive` action, which cannot be
  undone; yellow (`text-warning-foreground`) for a `disruptive` one, which
  takes devices offline; the normal title colour for everything else. Never
  an icon inside the title text (no warning triangle on a confirm).
- **Close X:** every sheet has `DialogPopup`'s X at the top right, with or
  without a footer. It is `ghost-muted`, the dim gray of icons elsewhere,
  and turns to the foreground colour on hover, in every modal that has one. A confirm has none: it is a question, and Cancel and Esc
  answer it (`showCloseButton={false}`).
- **Footer:** the band from the confirm (top border, `bg-muted/72`, `py-4`)
  on confirms and every sheet; a content sheet (Share Wi-Fi, an invite once
  made) has just an outline Close in it. Buttons are `sm`, on the right, Cancel
  (`outline`) then the primary
  action last. The action is filled `bg-primary` (`default`), as T3 Code's
  dialogs: sheet Save, Send code and Verify (Change email, Verify mobile),
  Create invite, Add theme. On a confirm the action button matches the title:
  filled red (`destructive`) for a destructive action, filled yellow
  (`warning`) for a disruptive one, and filled `bg-primary` for a plain
  write. A sheet whose save is destructive (Start transfer) takes the red
  button too (`saves`).
  A sheet's secondary or destructive action ("Delete schedule") sits alone on
  the left.

### Sheet

The detail for sheets (#361). Every sheet goes through `Sheet`
(`ui/sheet.tsx`); pages pass a title, fields and a save, never layout.

- **One style, the confirm's:** the popup on `bg-background`; the title
  and its muted line, 20px, the content, 30px, then the footer band (top
  border, `bg-muted/72`) with Cancel (`outline`) and the filled primary
  action. No icon tile and no rule under the header. There is no other
  style.
- **Width:** `size` names it, never a class: the default is 540px, `wide`
  is 640px for content that needs the room (the device icon picker). A call
  site never passes `className` or a `max-w-*`.
- **Layout:** header (`pt-5`), 20px, the fields 16px apart, 30px, the
  footer band (optional action on the left, Cancel and Save on the right),
  all at 20px from the sides. A form-level error sits under the last field.
- **Form or content:** a sheet with `onSave` is a form: Cancel and its
  action in the footer. Without it the sheet is content (Share Wi-Fi's QR)
  and the footer holds one outline Close. A sheet can be both in turn:
  Invite an admin is a form until the invite exists, then shows the link
  with Close.
- **Name the action:** the primary button says what it saves, never a bare
  "Save": Rename device, Save icon, Save time zone, Save name and password,
  Save plan, Save profile, Save notifications, Save schedule, Save and
  restart, Save name, Send code, Verify, Start transfer. Cancel keeps its
  name unless closing leaves something pending (`cancelLabel`: Later, once
  Change email has sent its code).
- **Close X:** every sheet has the X at the top right; the X, Esc and
  Cancel close it.
- **Save's colour:** a sheet names the commands its Save runs (`saves`),
  and Save takes the confirm's colour from their effect: filled yellow
  (`warning`) when one is `disruptive` (Wi-Fi name and password, guest
  name and password, ISP, DHCP, DNS, time zone), red when one is
  `destructive`, filled primary otherwise.
- **Content:** a switch that turns a field on is a switch row (label and
  muted hint on the left, switch on the right, as "Schedule on"), with the
  field appearing under it while it is on (the uplink VLAN tag).

### Impact of saving

The box a sheet shows before a change that takes devices offline is saved
(the pieces in `ui/impact.tsx`, used by `ImpactPanel` for settings and `WifiImpact` for Wi-Fi). It
appears only once something changed; there is no "Nothing to save" state.

- A muted box: `rounded-xl border bg-muted/40`, `px-3.5 py-3`, items 10px
  apart.
- Title "Impact of saving" in the field label style (`font-medium
  text-xs`), not an uppercase eyebrow.
- Figures packed to the left, 40px apart (`gap-x-10`, the hero facts'
  spacing), never split into equal columns: the count in `text-base font-semibold
  tabular-nums` over a lowercase muted `text-xs` label ("0" over "devices
  lose internet", "4" over "eeros restart"). A count above zero takes the
  warning colour (red for devices that cannot rejoin); zero stays plain.
  Counts, never words ("None").
- Core's summary sentence under them in `text-muted-foreground text-xs`.
  No step lists.
- **Scroll:** when a sheet would pass the bottom of the window, its body
  scrolls and the header and footer stay in view. A sheet never adds its
  own scroll box or max height.

### Confirm

The detail for confirms (#360). Every confirm goes through `ConfirmDialog`;
pages pass words, never layout.

- **Layout** (as T3 Code's `AlertDialog`): two bands. The body (title,
  20px, message, and any fields) sits on `bg-background`, 20px padding (30px
  under the content). The
  footer is a band with a top border and `bg-muted/72`, 16px tall padding,
  holding Cancel (`outline`) and the action button on the right. This is the
  one modal with a rule above its footer.
- **Tone:** title and action button together. `destructive`, or a `write`
  whose run cannot be undone (`irreversible` on the ask: deleting a power
  saving schedule on hardware that cannot add one back): red title, filled
  red button. `disruptive`, or a `write` the engine asked about
  because this run takes devices offline (`confirmWhen`, `offline` on the
  ask): yellow title, filled yellow button. Any other `write` asked about
  first (`askFirst`: the palette's writes, deleting a schedule, a
  reservation or a port forward): plain title, filled `bg-primary` button
  (`default`).
- **Words:** the title names the target as a question ("Restart network?",
  "Remove "Garage" from Maple Street?"). The message is the engine's
  `needs_confirm` text, one or two sentences on who loses what and for how
  long. The action button repeats the action with no "Yes," in front
  ("Restart network", "Remove from network", "Change time zone").
- **Type-to-confirm:** a destructive action on a named thing (a network, an
  eero, a profile, an admin, the account) adds a field under the message
  ("Type "Garage" to confirm"); the button stays disabled until it matches.
- **Fields beyond a type-to-confirm** make it a sheet, not a confirm
  (Transfer network keeps its warning as the first line of the body and
  the type-to-confirm as its last field). A small choice that changes what a
  field takes (Email or Text message) is a `tool` dropdown at the right end
  of that field's label line (`SheetField aside`), not a toggle above it.
- **Always asks:** `disruptive` and `destructive` commands confirm every
  time, including a toast's Undo that runs one. Changing the time zone is
  `disruptive`, since every schedule shifts at once.

### Popovers and menus

The detail for popovers and menus (#363). Everything lives in
`ui/popover.tsx` and `ui/menu.tsx`; a feature file never writes its own
surface, item or separator classes (`popover.test.ts` fails on a feature
that imports Base UI's popover or menu directly or uses `bg-popover`).

| Piece | What it is |
| --- | --- |
| `PopoverPopup` | A popover. Portal, positioner (`z-50`, `side="bottom"`, `align="start"`, 4px offset), `no-drag`, `popoverSurface`, capped at `--available-height` and scrolling inside. `variant="panel"` (default) leaves padding to the content; `variant="list"` adds `popoverList` |
| `MenuPopup`, `MenuItem` | A menu (Base UI `Menu`): the same positioner, surface and list. `MenuItem variant="destructive"` is red text (Block, Remove); `MenuSeparator`; `MenuSub` with `MenuSubTrigger` (chevron added) and `MenuSubPopup` |
| `popoverSurface` | `bg-popover`, 1px `border`, 12px radius, `shadow-lg`, `text-xs`. Also the Select list and the theme editor panel |
| `popoverList` | 4px padding (`p-1`), at least 176px (`min-w-44`), at most 320px or the space available, scrolling inside |
| `popoverItem` | A row of a menu, a Select or a listbox: 28px (`min-h-7`), `px-2.5 py-1.5`, 8px radius, 8px gap, direct icons `size-3.5`; lit `bg-muted/60` while `data-highlighted` (Base UI sets it on hover and arrow keys). Disabled rows at 50% |
| `popoverButtonItem` | The same row as a plain `<button>` in a popover list (pickers, Columns, Add a schedule), lit on hover and keyboard focus |
| `popoverSeparator` | A 1px `border/60` rule, 4px above and below, edge to edge inside the padding |
| `popoverLabel` | A muted heading row at the top of a list ("Pick who to schedule") |

- **Menu or popover list?** A menu runs actions (a row's Actions, the bulk
  Assign profile, a shortcut's Reset or Remove). A popover list picks a value
  or toggles (filter pickers, Columns, the title switcher, Add a schedule's
  profile). A popover panel holds anything else: the Filters form,
  notifications, the Sign out confirm.
- **Panels pad themselves:** 12px (`p-3`) for a form or a short confirm
  (Filters, Sign out), 4px for a list with a header (notifications).
- **A picked row** shows a `size-3.5` check before its label; rows that are
  not picked keep the space (`invisible`) so labels line up. A profile row
  has a `size-4` avatar after the check.
- **Placement:** pass only `side` and `align` (top bar and row menus
  `align="end"`, the sidebar's Sign out `side="top"`); never an offset.
- **The exception:** the network switcher keeps the sidebar surface
  (`bg-sidebar`, grain, `border-sidebar-border`, the row's width), since it
  reads as the sidebar row opening, not a floating panel. It still opens 4px
  below and is `no-drag`.

### No divider lines

No modal has a rule under its header. The one rule is the top border of
the footer band on confirms and sheets ([Confirm](#confirm),
[Sheet](#sheet)); otherwise spacing alone
separates them, so every modal reads as one clean panel, not three stacked
sections. Rules inside the body (a list's row dividers) are fine. In a menu,
a separator between groups of items is `popoverSeparator`, a 1px
`border/60` line with 4px above and below.

### Position

Every modal opens with its top edge at one fixed offset, `--dialog-top` in
`index.css`: `max(var(--titlebar-height) + 24px, 15vh)`. That clears the
titlebar in a short window (105px down in a 700px window) and sits a little
above the middle third in a tall one (180px in a 1200px window). The box
grows downward from there and never re-centres, so it does not jump when a
validation error or a section appears, and a confirm opened from a sheet
opens at the same height as the sheet. `DialogPopup` does this by default;
nothing passes an offset of its own.

The command palette is the one exception: `placement="palette"` keeps it
40px from the top, since it is nearly as tall as the window.

Popovers and menus open under their trigger (`side="bottom"`), 4px away,
aligned to its start edge unless they would leave the window (the top bar's
popovers align to the end). Everything that floats is `no-drag`, so a
popover over the titlebar still takes clicks.

### Behaviour

- **Focus on open:** a sheet focuses its first field; a confirm focuses
  Cancel, or the type-to-confirm field when it has one; a popover focuses its
  search field or its list; a menu its first item. Closing returns focus to
  the trigger.
- **Esc and Cancel close a modal; the backdrop does not.** Esc does what
  Cancel (or a dialog's X) does: a confirm answers no, a sheet or dialog
  closes. A click on the backdrop does nothing, on every modal and the
  command palette (`Dialog` sets `disablePointerDismissal`), so a stray click
  never throws away a form; the X on every sheet is the pointer's way out.
  Popovers and menus are not modal: Esc and a
  click outside close them.
- **Never ask "Discard changes?"** Esc or Cancel on a sheet with unsaved
  changes closes it at once and drops the changes. The only hold: a modal
  ignores Esc and Cancel while its command is running (saving, sending a
  code, a transfer).
- **Nested confirms:** a write inside a sheet or the palette confirms with
  `WriteConfirmDialog` (`useWrite` with `confirmIn: "nested"`), rendered
  inside that dialog. It opens at the same top edge above it, Esc closes only
  the confirm, and the sheet stays open behind it.
- **One at a time:** opening a modal closes any open popover or menu. A
  popover never opens a second popover; it opens a sheet or confirm instead.

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
  vertical gridlines, border or background. A small chart in a page header
  (Activity's Events over time) drops even the gridlines and Y labels
  (`BarChart hideGrid hideYLabels`) and draws a 2px stub for each empty
  column (`zeroStubs`), so empty slots still read as slots.
- **Labels.** Y labels in a `w-14` gutter, right-aligned,
  `text-3xs text-muted-foreground tabular-nums`, zero shown as `0`. X labels
  only at start, middle and end, `text-3xs`, in normal case ("Fri Oct 31",
  "6 PM", heatmap rows "Mon"), never uppercase.
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
| Share bar | `h-2` bar of segments with `gap-0.5`, rounded outer ends and square inner corners (a short middle segment must not read as a pill), tooltip "label · value · percent", legend of `size-2` squares |
| Topology | eero pucks joined by lines; wired solid, wireless dashed; weak links in the warning colour |

## Dashboard patterns

- **Stats under a chart** (Internet's Per hour and Per day cards): a row
  of label over figure, every one the same style so labels and figures line
  up across cards: label `text-xs text-muted-foreground`, figure `text-xl
  font-semibold tabular-nums` with its unit small and muted ("54.0 GB"), and
  any context (a weekday, an hour) as a muted prefix in the unit's style
  ("Thu 54.0 GB"). Short context only: an abbreviated weekday, not a date. Left
  aligned, 50px apart (`flex gap-[50px]`), not spread across the row.

- **Hero figure.** `text-4xl font-semibold tabular-nums` with a
  `text-xs text-muted-foreground` line under it. Beside a main chart, an
  18rem column lists each series: dot, icon, label, value right in
  `font-medium` with its share after it in muted `text-xs` ("254 GB
  (83%)"), one line per series, 8px apart. Compact hero (a summary sharing a row with a table): `text-2xl`
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

**Key hints** (`Kbd`, `components/ui/kbd.tsx`): a 20px cap with the label centred, set in "Mesh Mono Field" (`font-kbd`), whose metrics are corrected so mono glyphs do not ride high. Every key hint uses it or the same `font-kbd` and `leading-none`.

## Numbers and copy

Speeds come from `formatMbps` / `mbpsParts` in `src/core/format.ts`: kbps below 1 Mbps, Mbps below a gigabit, then Gbps (`2.4 Gbps`; a whole gigabit drops its `.0`, `1 Gbps`), so a multi-gig link or plan never reads `2,401 Mbps`.

- Shared formatters in `src/core/format.ts` (re-exported to the renderer)
  for Mbps and Gbps (kbps below 1 Mbps, so a trickle never shows as 0), MB, GB and TB, percent, ms, relative time ("2h ago",
  "Yesterday, 3:04 AM"), durations ("23d 4h"). The same quantity
  looks the same everywhere, including CLI table output.
- **Time units sit right after the number**, one letter each: `s`, `m`, `h`,
  `d` ("45s", "12m", "3h 20m", "19d 19h", "5m ago", "in 5m"). No space
  before the unit and no "min". Countdowns past an hour read "1h 05m".
  Data and speed units keep their space ("942 Mbps", "1.2 GB"). Prose that
  is not a formatted value can still say "about 30 seconds".
- Clock times and dates are always in the network's time zone, never the
  viewer's: `networkClock(network.timezone)` in `src/core/format.ts` gives
  `time` ("9:41 AM"), `dateTime` ("Oct 20, 9:41 AM"), `day` ("Sat Nov 8"),
  `hour` chart labels ("9 AM"), weekdays and `parts` for day-by-hour grids.
  Do not build an `Intl.DateTimeFormat` in a component.
- Show `-` for a missing value, never `0` or blank.
- Connected things are **devices**, never "clients" (Wireless devices, Devices by band, "27 devices"), so one word means one thing across the app. eero's own feature names keep their words (Client steering).
- No emdashes in UI copy or docs. Use a comma, colon or a new sentence.
- Example data is invented: Maple Street, Alex Kim, `192.168.4.x`.
- Mesh UI never shows eero Plus features, upsells or lock badges.

## Confirmation

Disruptive and destructive actions confirm in a modal before running
([Modals and popups](#modals-and-popups)),
the same everywhere (never a note in place of the button):

- A title naming the target (no icon) and one or two sentences on the
  effect and how long it lasts ("Turn off guest network? 4 guests are disconnected right
  away."), then Cancel and a filled button that repeats the action: yellow
  (`warning`) with a yellow title when it is disruptive, red
  (`destructive`) with a red title when it is destructive.
- Destructive dialogs need a checkbox or typed name.
- Danger buttons are red text on a neutral button until the confirm step,
  where the confirming button is filled.
- **Red text is for actions that do not undo themselves**: destructive ones
  (Delete network, Remove eero, Delete profile, Reset Thread) and Block
  device, which cuts a device off until someone unblocks it. Disruptive
  actions that recover on their own (Restart network, Restart eero, Pause)
  are neutral outline buttons with a dim icon; their confirm dialog carries
  the warning, in yellow.
- **Restart copy has one shape.** What restarts, then who loses internet and
  for how long: "Restarts every eero at once. 31 devices online lose internet
  for about 2 to 3 minutes." or "Restarts Office. 6 devices on it lose
  internet for about 1 minute." (`restartNetworkLine` and `restartLine` in
  `features/eero/helpers.ts`, estimates from core). Restart network is one
  shared row, `useRestartNetworkRow` in `features/eeros/NetworkActions.tsx` (each page writes the title itself so Places indexes it),
  on the eeros page, Troubleshooting and Advanced networking; Overview's hero
  button has the same neutral look.

## App icon

One mark everywhere: the mesh triangle (three nodes, a hub, and the links
between them) in the [Gruvbox Plus](https://github.com/SylEleuth/gruvbox-plus-icon-pack)
app-icon style. `build/icon.svg` is the only source for the launchers;
`pnpm icons` renders `build/icon.png`, the Linux sizes in `build/icons/` and
the website copies from it. Inside the app, `AppIcon`
(`components/mesh/AppIcon.tsx`) draws the same tile and node shapes inline,
flat and in the theme's colours: a quiet tile in `--color-app-icon` (10% of
the text colour in the page colour) with the nodes in
`--color-app-icon-foreground` (80% text colour), so it follows every theme,
light and dark, without standing out, instead of the launcher's fixed
Gruvbox colours. It appears in the sidebar, the sign-in titlebar and Welcome
step, and the About panel. Keep its paths in step with `build/icon.svg`.
Never draw the app mark with a lucide glyph.

Beside the icon, the name is the wordmark `AppWordmark`
(`components/mesh/AppWordmark.tsx`), modelled on T3 Code's sidebar brand:
"Mesh" bold in the text colour, "UI" medium in `text-muted-foreground`.

The sidebar header copies T3 Code's `SidebarChromeHeader`: icon and
wordmark, then Back and Forward (`ArrowLeft` / `ArrowRight`, `size-3.5`, in
`ghost` `icon-sm` buttons in the nav icons' `--sidebar-icon-color`
(full sidebar text on hover), `gap-1` after the brand, disabled at 64% when
there is nowhere to go, tooltip "Go back (Alt+←)" or "(⌘[)" on macOS, the current binding), then
the Demo badge `ml-1`. The row is one `h-8` line that wraps with overflow
hidden, so a badge that does not fit drops out of sight instead of crowding
the buttons.

The app icon follows the pack's measured conventions on a 256 canvas:

- **Box:** the pack's shared rounded-square path (6..250 across, 12..240
  down), filled with a top-to-bottom `#504945` to `#3c3836` gradient.
- **Symbol:** cream `#ebdbb2`, about 164px wide (the pack's median is 166),
  centred so symbol plus shadow sit on (128, 128).
- **Depth:** the symbol repeated 5px lower in `#282828` at 30% as its shadow,
  a 4px top lip in `#fbf1c7` at 60%, and the pack's rim gradient over the box
  (light top edge, darker bottom). No filters or blurs.

Tray icons live in `build/tray/`, in the pack's
panel style: flat filled paths in `currentColor` with the KDE
`ColorScheme-*` classes, at 16, 22 and 24px (`mesh-ui-symbolic.svg` is the
16px monochrome app icon). States: `mesh-ui-tray` (normal),
`-offline` (the symbol at 30%), and `-warning` and `-error`, which add the
pack's standard badge, a 4px dot (radius 2 on the 22px canvas) in the
bottom-right corner with a 1px gap cut from the symbol, in
`ColorScheme-NeutralText` or `ColorScheme-NegativeText`. They use no masks,
because Qt's SVG renderer does not support them.
The running app's tray (Keep running in the tray) always uses the normal
`mesh-ui-tray` glyph, never the color app icon: a template image in the
macOS menu bar, and on Windows and Linux rendered in plain white for dark
taskbars and panels and black for light ones (`build/tray/png/`,
`pnpm icons --tray`), picked from the OS theme. The rendered glyph is
trimmed and scaled: it fills the 16px canvas (and the macOS template), like
the pack's panel tray icons, and is 20px with 1px padding on 22px, because
Linux tray hosts shrink an app's image into their icon box (20px in GNOME's
BetterTrayIcons) while themed icons are drawn at about 90% of it.

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


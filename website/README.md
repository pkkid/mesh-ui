# meshui.pkarma.com

The project's website: one page with the headline, the app (click its sidebar to see each page) and the downloads.
Plain HTML, CSS and JavaScript with no build step and no third-party requests; Cloudflare serves
the files in `public/` as they are. Its look follows dalica.pkarma.com.

| Path | What |
|---|---|
| `public/index.html` | the page: header (Changes, GitHub, Download), hero, screenshot, downloads, footer |
| `public/changes.html` | the Changes page: a bulleted list per release, newest first (served at `/changes`) |
| `public/style.css` | all styles, including the self-hosted `@font-face` rules |
| `public/main.js` | headline arrival, the header hairline, the clickable app in the hero, and the download button that names the visitor's system |
| `public/404.html` | the not-found page |
| `public/_headers` | security headers (a strict Content-Security-Policy: no inline styles or scripts) and cache lifetimes |
| `public/img/` | the app's pages (`pages/`), the link-preview screenshot, the icon, and the CC0 licence of the system logos inlined in the page |
| `public/fonts/` | Schibsted Grotesk, IBM Plex Mono and Caveat, with their OFL licence texts |
| `wrangler.jsonc` | the Cloudflare configuration: a Worker with static assets only |

## Look at it locally

```sh
python3 -m http.server 8000 --directory website/public
```

## Deploy to Cloudflare

A Worker with static assets on the Free plan. Installers are not hosted here: the download links
point at GitHub Releases. `wrangler.jsonc` attaches `meshui.pkarma.com` as the Worker's custom
domain, so a deploy creates its DNS record and certificate. Deploy by hand from this folder once
the change is on `main`: `npx wrangler deploy`. Then check `curl -sI https://meshui.pkarma.com/`.

## Editing the page

- The site itself is dark Gruvbox only (the app picture in the hero has a light theme too). One accent, the app's blue-gray `#83a598`; orange appears only as the
  wordmark's dot. Colors are tokens at the top of `style.css`.
- No `style="..."` attributes and no inline scripts: the Content-Security-Policy refuses them.
- Every page fits a 320 px phone with no sideways scroll.
- Keep it simple: no feature tour. The app's screens are documented in `docs/`.
- Mesh UI is not affiliated with eero or Amazon; keep the footer line saying so.

## Releasing a new version

Add the release's changes as a new section at the top of `public/changes.html`. In `public/index.html` the version appears in the download heading and the links
(`releases/download/v0.6.0/...`). Replace `0.6.0` and `0.6` with the new version, then check
every link answers 200:

```sh
for u in $(grep -o 'https://github.com/pkkid/mesh-ui/releases/download/[^"]*' website/public/index.html); do curl -sIL -o /dev/null -w "%{http_code} $u\n" "$u"; done
```

## The app in the hero

The hero shows the app as a clickable picture: every sidebar item (and the account row in the
sidebar's footer) is a button over the sidebar image (their row centres are the `data-y` values,
in pixels of a 1400 x 860 window), the header stays put and the page scrolls (never on its own).
The light / dark button in the header picture is a button too (`#app-theme`, over the icon at
x 1231): it swaps every picture to the other theme and keeps the page and its scroll. Dark is
Gruvbox Hard (the maintainer's theme), light is the default Classic.

Each page and theme is three images in `img/pages/`: `<id>-<theme>-nav.webp` (the sidebar,
480 x 1720), `<id>-<theme>-head.webp` (the main header, 1740 x 66) and
`<id>-<theme>-body.webp` (the page below it, 1740 wide). The body heights are `HEIGHTS` in
`main.js`, one table per theme. The page ids are the app's route ids (`settings` is the
Application page).

All are demo-mode captures with the Demo badge removed. To retake them, run `pnpm ui:shot`
for every page and theme (dark: `--theme dark --theme-file test/ui-shots/themes/gruvbox-hard.json`;
light: `--theme light`) with `--wait 1500` and this `before`:

```js
[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()==='Demo').forEach(e=>e.remove())
```

- a `--size 1400x860 --scale 2` shot: the sidebar is its `480x1720+0+0`;
- a `--size 1400x4000 --scale 1.5` shot of the whole page (1.5 makes the main pane exactly
  1740 wide): the header is its `1740x66+360+0`, and the body runs from y 66 to the end of the
  content (trim the background, then keep about 45 px under it).

The offscreen renderer crashes on shots over about 4096 x 4096 device pixels, and now and then
on a long run, so take each shot in its own `ui:shot` launch and retry a failed one; Devices,
Signal and Activity in dark may need a shorter tall shot (as tall as the page). Update
`HEIGHTS` from the body files.

`img/overview-1.0.jpg` is the link-preview image (`og:image`), the Overview page in dark at
2000 px wide.

The note's handwriting is Caveat (OFL, `fonts/OFL-Caveat.txt`).

Images are cached for a week, so give a replaced image a new file name.

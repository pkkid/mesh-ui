# meshui.pkarma.com

The project's website: one page with the headline, the app (click its sidebar to see each page) and the downloads.
Plain HTML, CSS and JavaScript with no build step and no third-party requests; Cloudflare serves
the files in `public/` as they are. Its look follows dalica.pkarma.com.

| Path | What |
|---|---|
| `public/index.html` | the page: header (GitHub, Download), hero, screenshot, downloads, footer |
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

- Dark Gruvbox only. One accent, the app's blue-gray `#83a598`; orange appears only as the
  wordmark's dot. Colors are tokens at the top of `style.css`.
- No `style="..."` attributes and no inline scripts: the Content-Security-Policy refuses them.
- Every page fits a 320 px phone with no sideways scroll.
- Keep it simple: no feature tour. The app's screens are documented in `docs/`.
- Mesh UI is not affiliated with eero or Amazon; keep the footer line saying so.

## Releasing a new version

The version appears in `public/index.html` only: the download heading and the links
(`releases/download/v0.6.0/...`). Replace `0.6.0` and `0.6` with the new version, then check
every link answers 200:

```sh
for u in $(grep -o 'https://github.com/pkkid/mesh-ui/releases/download/[^"]*' website/public/index.html); do curl -sIL -o /dev/null -w "%{http_code} $u\n" "$u"; done
```

## The app in the hero

The hero shows the app as a clickable picture: the sidebar's pages are buttons over the sidebar
image (their row centres are the `data-y` values, in pixels of a 1400 x 860 window), the header
stays put and the page scrolls (never on its own). Each page is three images in
`img/pages/`: `<id>-nav.webp` (the sidebar, 480 x 1720), `<id>-head.webp` (the main header) and
`<id>-body.webp` (the page below it, 1740 wide). The body heights are `HEIGHTS` in `main.js`.

All are demo-mode captures, dark theme, with the Demo badge removed. To retake them, run
`pnpm ui:shot --shots shots.json` with, for every page, a `1400x860` shot (the sidebar) and a
`1400x4000` shot (the whole page), both at `--scale 2` and with this `before`:

```js
[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()==='Demo').forEach(e=>e.remove())
```

Then crop at scale 2: the sidebar is `480x1720+0+0` of the short shot; the header is
`2320x88+480+0` of the tall shot and the body runs from y 88 to the end of the content (trim the
tall shot's background), both resized to 1740 wide. Update `HEIGHTS` from the body files.

`img/overview.jpg` is the link-preview image (`og:image`), the Overview page at 2000 px wide.

The note's handwriting is Caveat (OFL, `fonts/OFL-Caveat.txt`).

Images are cached for a week, so give a replaced image a new file name.

# Sign in

First launch and signed-out flow: passwordless eero login with a one-time
code, pick a network, then a short first-run load before the dashboard.

Mockup: [../mockups/18-sign-in.html](../mockups/18-sign-in.html)

The mockup shows four frames of a 460 x 640 window side by side. In the app
this is one small window (no sidebar, no topbar beyond a titlebar with the
app mark, "Mesh UI" and window controls) that steps through the frames, then
grows into the main window. Shell rules are in [overview.md](overview.md).

## Layout

### 1. Welcome

- App mark in a rounded square, title "Sign in to your eero account", lead
  text: "Manage Maple Street and your other eero networks from the desktop.
  We'll send you a one-time code, no password needed." (On first launch
  there is no network name yet; use "your eero networks".)
- Segmented **Email / Phone** toggle.
- Field label ("Email address" or "Mobile number") and a large input with an
  `at-sign` or phone icon. Phone input has a country code picker and stores
  E.164 (`+15550100142`).
- Primary full-width **Send code →**.
- Info note: "Amazon login is not supported in Mesh UI. If you sign in to the
  eero app with Amazon, use an eero account that has admin access to your
  network."
- Footer rule with "Just looking? **Try demo mode**" and the app version
  (`v0.1.0`) on the right.

### 2. Verification code

- **← Back** link (returns to Welcome with the login kept).
- Mail-check icon, title "Check your email" (or "Check your messages" for
  phone), lead "We sent a 6-digit code to **alex.kim@example.com**. It can
  take a minute or two to arrive."
- "Enter code": six boxes, mono digits. Typing advances, Backspace goes back,
  pasting a 6-digit string fills all boxes. The active box has the primary
  border.
- Wrong code state (shown in the mockup as a second row): all boxes take the
  destructive border and text, with "That code didn't work. 4 tries left
  before the account is locked."
- Primary full-width **Verify**. Auto-submits when the sixth digit lands.
- Row under it: "Didn't get it? Resend in 0:42" (countdown, then a **Resend
  code** link), and on the right "Use a phone number instead" (or "Use an
  email instead").
- Footer: "Each code works once. Five wrong codes may lock the account."

### 3. Choose network

- Account header: avatar with initials, name ("Alex Kim"), email, and a
  "Signed in" status on the right.
- Title "Choose a network", lead "Your account has 3 networks. You can
  switch any time from the sidebar."
- Radio list of networks. Each row: radio, network icon, name (with the
  owner's nickname label when it differs, "Mom's House · Kim Home"), one
  detail line ("4 eeros · 31 devices online · Ziply Fiber", "1 eero · last
  seen 2 days ago", "2 eeros · 9 devices online · update available"), and on
  the right a status (Online / Offline) over a role badge (Owner / Admin).
- Switch "Open this network on launch".
- Primary full-width **Continue to Maple Street →** pinned to the bottom; its
  label follows the selection.

### 4. First run

- Success ring with a check, "You're all set, Alex", lead "Maple Street is
  online and looking healthy." (or a plain status sentence when it is not).
- Summary badges: "4 eeros", "31 of 38 devices", "4 profiles", "942 Mbps"
  (last speed test download).
- Load checklist card, one row per step with a check (or a spinner ring while
  running) and the time it took on the right: Signed in, Network and health,
  4 eeros and mesh links, 38 devices and 4 profiles, 7 days of usage history
  (with a percent and a progress meter while loading).
- Primary full-width **Open dashboard**.
- Footer: "`Ctrl K` runs any command. The same commands work from the
  `mesh-ui` CLI."

Page header in the mockup also notes "Session token kept in the system
keychain"; in the app that line sits in the Welcome footer and reflects the
real storage state (see States).

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Whether to show sign-in at all | `auth.status` | On launch and after any `not_signed_in` |
| Version in footer | `app.info` | Once |
| Network list (step 3) | `network.list` | Once after verify |
| Account header (step 3) | `account.get` | Once after verify |
| "Open this network on launch" | `app.settings.get` | Once |
| First-run checklist rows | `network.get` + `network.health`, `eero.list`, `device.list` + `profile.list`, `usage.get {scope: "network", range: "week"}` | Each row once, in that order; timings measured in the renderer |
| Summary badges | Results of the checklist queries, plus `speedtest.history` latest | Once |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Email / Phone toggle | - (view state) | - | No | Switches field type |
| Send code | `auth.login.start {login}` | write | No | Moves to step 2; starts the 60 s resend timer |
| Try demo mode | - (host restarts the engine with the demo backend) | - | No | Skips to step 3 with demo networks; sidebar shows the Demo badge |
| Back | - | - | No | Back to step 1, pending login discarded |
| Verify (or sixth digit) | `auth.login.verify {code}` | write | No | `ok`: step 3 (or step 4 if there is one network). Error: wrong-code state |
| Resend code | `auth.login.resend` | write | No | Clears the boxes, restarts the 60 s timer, toast "New code sent" |
| Use a phone number / email instead | - | - | No | Back to step 1 with the other tab selected |
| Network radio | - (view state) | - | No | Updates Continue label |
| Open this network on launch | `app.settings.set {openOnLaunch: networkId or null}` | write | No | Saved in `settings.json` |
| Continue to <network> | `network.select {networkId}` | write | No | Step 4 |
| Open dashboard | - | - | No | Main window opens on Overview |

## States

- **Loading.** Send code and Verify show their label faded with the button
  disabled while the command runs; no spinner on the page. Step 4's checklist
  is itself the loading state; Open dashboard is enabled as soon as the first
  four rows are done (usage history can finish in the background).
- **Wrong code.** Error row as in the mockup. The pending login is kept so
  the user can retry or resend. eero returns `error.code.invalid` or
  `error.verification.invalid`; the engine maps both to `eero_error` with a
  stable message.
- **Too many resends.** eero `error.too.many.resends`: resend link stays
  disabled, message "Too many codes requested. Try again in a few minutes."
- **Locked or unknown account.** Message from eero in the error row, with a
  link to eero support (opens in the system browser).
- **Empty: no networks.** Step 3 shows "This account has no eero networks
  yet. Set one up in the eero mobile app, then come back." with Sign out and
  a small destructive link "I want to delete my account and data"
  (`account.delete`, destructive, type-to-confirm dialog).
- **One network.** Step 3 is skipped; `network.select` runs automatically.
- **Network offline.** Row shows Offline and "last seen ..."; it can still be
  chosen. Step 4 then says "Lake Cabin is offline. You can see its settings
  and history, but live data is unavailable." and skips the eeros and devices
  rows' timing claims.
- **Offline (this computer).** Send code fails with `network_error`: inline
  message "Can't reach eero. Check your internet connection." under the
  button.
- **No keychain (Linux `basic_text`, or keychain locked).** Welcome footer
  says "No system keychain found. You'll stay signed in only until Mesh UI
  closes." instead of "Session token kept in the system keychain". The flow
  is otherwise identical (see `AGENTS.md`, Security).
- **Session expired later.** Any `not_signed_in` from a page returns here at
  step 1 with a note "Your session ended. Sign in again." and the last login
  prefilled; after verify the previously selected network opens directly.
- **No permission / capability / bridge mode.** Not applicable here; role
  badges in step 3 are informational.

## Notes

- The session token never reaches the renderer. `auth.login.start` keeps the
  pending `user_token` in the engine; `auth.login.verify` promotes it to the
  session, adopts any new `s=` cookie and stores it through the host
  `SecretStore`.
- The CLI runs through the Electron binary in headless mode and shares the
  same `SecretStore` and session, so signing in here also signs in
  `mesh-ui` on the command line, and `auth.logout` from either signs out
  both.
- eero rate-limits resend to about once per 60 s; the countdown matches.
- The mockup step captions show the catalogue ids, `auth.login.start` and
  `auth.login.verify`.
- Open question: eero does not appear to return "tries left". Unless a real
  response shows it, the error row should say "That code didn't work. Check
  it and try again, or resend a new code." and keep the general lock warning
  in the footer.
- Open question: whether the code is always 6 digits. The API accepts 4 to 10;
  render as many boxes as the first code length eero reports, default 6.
- Amazon login is out of scope (see the note on Welcome). A user whose eero
  account is Amazon-only needs another admin to invite an email account.
- MANUAL: check the real error code and message for a wrong verification
  code, and whether a remaining-attempts count is returned | sign in with a
  wrong code once, then the right code | error row shows eero's message,
  sign-in then succeeds | risk: none.

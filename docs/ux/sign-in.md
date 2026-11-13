# Sign in

First launch and signed-out flow: passwordless eero login with a one-time
code, then straight to the dashboard on the last used network. The steps
are Welcome, Verification code, then the dashboard. There is no network
chooser and no first-run screen: switching is the sidebar's network
switcher, and the Overview sections show their own loading fade.

Mockup: [../mockups/18-sign-in.html](../mockups/18-sign-in.html)

The mockup shows four frames of a 460 x 640 window side by side. In the app
this is one small window (no sidebar, no topbar beyond a titlebar with the
app mark, "Mesh UI" and window controls) that steps through the first two frames, then
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
- Sandbox hint: outside live mode no code is sent, so one quiet muted line
  under the boxes says what to type. Demo: "Demo mode: no code is sent.
  Enter any 6 digits." (111111 simulates a wrong code). Fake eero server
  (`app.info` `fakeServer`): "Fake eero server: enter 123456." Live shows
  nothing.
- Wrong code state (shown in the mockup as a second row): all boxes take the
  destructive border and text, with "That code didn't work. 4 tries left
  before the account is locked."
- Primary full-width **Verify**. Auto-submits when the sixth digit lands.
- Row under it: "Didn't get it? Resend in 0:42" (countdown, then a **Resend
  code** link), and on the right "Use a phone number instead" (or "Use an
  email instead").
- Footer: "Each code works once. Five wrong codes may lock the account."

### 3. Open the dashboard (no screen)

After verify the renderer runs `network.list` and selects the last used
network (the engine's selection, read from `lastNetworkId`) if the account
still has it, else the first network in `network.list` order, with
`network.select`. Verify stays busy until that resolves, and the main window
mounts only after it, so no network-scoped query runs before a network is
selected. The dashboard then loads like any launch, each section with its
own fade.

The mockup's third and fourth frames (Choose network, First run) are no
longer built.

Page header in the mockup also notes "Session token kept in the system
keychain"; in the app that line sits in the Welcome footer and reflects the
real storage state (see States).

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Whether to show sign-in at all | `auth.status` | On launch and after any `not_signed_in` |
| Version in footer | `app.info` | Once |
| Network to open (step 3) | `network.list` | Once after verify |
| Account header (no networks) | `account.get` | Once, only on the no-networks screen |
| Sandbox hint (step 2) | `app.info` (`backend`, `fakeServer`) | Once |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Email / Phone toggle | - (view state) | - | No | Switches field type |
| Send code | `auth.login.start {login}` | write | No | Moves to step 2; starts the 60 s resend timer |
| Try demo mode | - (host restarts the engine with the demo backend) | - | No | Signs in to the demo networks; sidebar shows the Demo badge |
| Back | - | - | No | Back to step 1, pending login discarded |
| Verify (or sixth digit) | `auth.login.verify {code}` | write | No | `ok`: selects the last used or first network and opens the dashboard (step 3). Error: wrong-code state |
| Resend code | `auth.login.resend` | write | No | Clears the boxes, restarts the 60 s timer, toast "New code sent" |
| Use a phone number / email instead | - | - | No | Back to step 1 with the other tab selected |
| (after verify) | `network.select {network}` | write | No | Main window opens on the last used or first network |
| Retry (list failed) | `network.list`, `network.select` | write | No | Tries step 3 again |

## States

- **Loading.** Send code and Verify show their label faded with the button
  disabled while the command runs; no spinner on the page. Verify stays
  busy until the network is selected; the dashboard then shows its own
  loading fade.
- **Wrong code.** Error row as in the mockup. The pending login is kept so
  the user can retry or resend. eero returns `error.code.invalid` or
  `error.verification.invalid`; the engine maps both to `eero_error` with a
  stable message.
- **Too many resends.** eero `error.too.many.resends`: resend link stays
  disabled, message "Too many codes requested. Try again in a few minutes."
- **Locked or unknown account.** Message from eero in the error row, with a
  link to eero support (opens in the system browser).
- **Empty: no networks.** Instead of the dashboard, a screen with the account
  header shows "This account has no eero networks
  yet. Set one up in the eero mobile app, then come back." with Sign out and
  a small destructive link "I want to delete my account and data"
  (`account.delete`, destructive, type-to-confirm dialog).
- **Network list fails.** The same screen says "Couldn't load your
  networks" with the error, Retry and Sign out.
- **Network offline.** It is opened like any other; the dashboard shows
  its offline state.
- **Offline (this computer).** Send code fails with `network_error`: inline
  message "Can't reach eero. Check your internet connection." under the
  button.
- **No keychain (Linux `basic_text`, or keychain locked).** Welcome footer
  says "No system keychain found. You'll stay signed in only until Mesh UI
  closes." instead of "Session token kept in the system keychain". The flow
  is otherwise identical (see `AGENTS.md`, Security).
- **Session expired later.** Any `not_signed_in` from a page returns here at
  step 1 with a note "Your session ended. Sign in again." and the last login
  prefilled; after verify the previously selected network opens directly (else the
  first network).
- **No permission / capability / bridge mode.** Not applicable here.

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

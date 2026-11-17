# Account

The signed in eero account, notification choices, the networks on the account, and sign out and account deletion. App settings (CLI and agents, theme, About) are on the [Settings](settings.md) page.

Mockup: [../../mockups/17-account-settings.html](../../mockups/17-account-settings.html) (drawn before the split; Account has its hero, Account, Networks and Sign out sections)

Shared patterns (hero, settings rows, destructive confirms) are described in [../overview.md](../overview.md).

## Layout

Breadcrumb `Account`, nothing after it. Opens from the signed-in name and role in the sidebar footer (the whole footer row is the button, full sidebar width, with the nav rows' hover and selected states; the sign-out icon sits inside it on the right and is its own button), the palette, the network switcher's **Manage networks** (`#/account/networks`) and deep links. It is not a sidebar nav item. Main column on the left, side panel on the right (as Settings has About):

1. **Hero.** Avatar with initials at the top left. Title is the account name (`Alex Kim`) with `Signed in`. Under it the email with `Verified` and the mobile number with `Unverified`. Action row: **Edit name**, **Change email**, **Verify mobile** (the third button reads **Change mobile** once the number is verified).
2. **Account** ("Email preferences and alerts"): **Stay up to date** switch (product news by email), then one **Notifications** row: a summary of the selected network's choices ("Desktop on · 6 of 9 alerts on", counting eero alerts and phone alerts) and **Edit** with a chevron. The whole row is the button (hover `bg-muted/50`); it opens the Notification settings sheet ([overview.md](../overview.md#notifications-bell)), the one place alerts are edited. The page has no Notifications section of its own.
3. **Networks on this account.** Table: Network (neutral icon, the nickname or else the name, then a muted line with the Wi-Fi name when a nickname is shown, ISP, "Shared with you" for an admin role and "current" for the selected network), Role (`Owner` or `Admin`), eeros count, Status (`Online`, `Offline 2d`). eero sends no owner name for a shared network, so the mockup's "shared by ..." reads "Shared with you". A row click switches to that network.
Side panel:

1. **Sign out and delete**: text saying where the session is stored ("saved in GNOME Keyring and refreshes on its own") and **Sign out**. Then **Delete account and data**, a quiet collapsed row with a chevron (no badge, no red) so it takes a deliberate click; it always starts collapsed, is not remembered, and collapses again after a cancelled confirm. Expanded: what it does and what must happen first (transfer or delete owned networks; lose admin access to shared ones), a checkbox "I want to permanently close my account and delete my data", **Delete account** (solid danger, disabled until checked). Delete opens the app's confirm dialog with core's message; type the account email (or name, when there is no email) to enable it. In demo mode the text says so and the panel adds **Leave demo mode**.

**Deep links.** Each section has a stable id; `#/account/<section>` opens
the page scrolled to it (a second `account` route, `/account/:section`).
Sections: `profile` (hero), `email` (Account), `notifications`, `networks`,
`sign-out` (`ACCOUNT_SECTIONS` in `AccountPage.tsx`, DOM ids
`account-<section>`). `#/account/notifications` scrolls to the Notifications
row and opens the Notification settings sheet. `#/account/cli`, `theme` and
`about`, from before the split, redirect to [Settings](settings.md).
Activity's settings icon and the bell's gear open the sheet where you are,
without leaving the page.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Name, email, phone, verification, consents, push settings | `account.get` | on load, every 5 min, after writes |
| Notifications row summary | `notifications.settings.get` (eero keys, account push settings, desktop choices) | on load, after writes |
| Networks table | `network.list` | on load, every 60 s (shares the sidebar switcher's poll, no extra request) |
| Session storage description (keychain name or memory only) | `auth.status`, `app.info` (`keychainName`) | on load |
| Owned and shared networks for Delete account | `network.list` | with the table |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Edit name | `account.name.set` `{name}` | write | no | Dialog with one field |
| Change email | `account.email.set` `{email}`, then `account.email.verify` `{code}` | write | no | Dialog: new address, then 6 digit code |
| Verify mobile | `account.phone.verify` `{code}` (after a code is sent by `account.phone.set`) | write | no | Dialog with code field; status becomes `Verified` |
| Stay up to date | `account.consents.set` `{marketingEmails}` | write | no | |
| Notifications row (Edit) | none (opens the sheet) | | | The Notification settings sheet; its Save runs `notifications.settings.set` and `account.push.set` |
| Network row | `network.select` `{network}` | write (app local) | no | Switches the current network |
| Sign out | `auth.logout` | write | no | Session removed from the keychain; app returns to sign in |
| Delete account | `account.delete` `{acknowledge: true}` | destructive | checkbox, then dialog with type the email; sends `confirm: true` | Account closed; app returns to sign in |
| Leave demo mode (demo only) | `app.demo.set` `{enabled: false}` | write (app local) | no | Relaunches Mesh UI without `--demo` |

## States

- **Loading:** hero placeholders; switches show their last known value faded.
- **Unverified email or phone:** `Unverified` status and the hero button reads **Verify ...**.
- **No keychain:** the sign out text says "Your session is kept in memory only on this computer; you will sign in again next time" (Linux `basic_text`, see [../overview.md](../overview.md)).
- **Owns networks:** Delete account and its checkbox stay disabled with the reason ("You own 2 networks. Transfer or delete them first.") until owned networks are transferred or deleted. A network with no known role counts as owned, as core's refusal does. The `admin` demo scenario owns none, to show the enabled path.
- **Demo mode:** the sign out text reads "You are in demo mode: invented networks, and nothing you change reaches eero." with **Leave demo mode** beside **Sign out**.
- **Error:** inline note per section with **Retry**; verification code errors show under the field.
- **Offline (computer):** account data shows from the last fetch with a muted "Offline" note; writes are disabled.

## Notes

- Push settings (`networkOffline`, `nodeOffline`) live on the account; other toggles are a per network map on `{net}/notifications` that must be sent whole with one key changed. Core hides that detail behind `notifications.settings.set`.
- The weekly report row is not built (M6.7): `{net}/data_usage/report_settings` was never captured (endpoints.md section 20), so there is no known key. When eero sends its own `network.dataUsageReport` notifications key, it shows like any other alert key, as "Data usage report". The Simple Setup row is an integrations setting, not an alert, and stays on Advanced networking.
- Account writes (name, email, mobile, Stay up to date, push switches) work in demo and against the fake eero server. Against the real eero API they answer "not available yet" (no live-tested request, endpoints.md section 20) and the toast says so.
- Notification choices have one editor, the bell's Notification settings sheet; this page only summarises them in the Notifications row (#279 replaced the old section of instant-save switches).
- The hero's code dialog (`CodeDialog.tsx`) takes the new address or number, then the 6 digit code; a wrong code shows under the field and keeps the change pending. An unverified address or number opens it at the code step (the button reads Verify email or Verify mobile; Add mobile when there is none). Edit name has Undo; email and mobile changes do not (they need a code).
- Desktop notifications are raised by the main process from the same `notifications.list` poll that feeds the bell; one poll, both surfaces.
- Mesh UI does not offer **Switch to Amazon login** (it is permanent and needs Amazon sign in), so the Account section has no login row.
- Support ID is the account `log_id`; it shows on Settings (About) and Troubleshooting (Get help). Network ID, the id in the network URL, is on Troubleshooting (Get help), under the Support ID.

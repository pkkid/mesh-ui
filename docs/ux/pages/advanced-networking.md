# Advanced networking

Network wide settings for the internet connection, addressing, DNS, radios, Thread and smart home integrations, plus the network restart and delete actions.

Mockup: [../../mockups/13-advanced-networking.html](../../mockups/13-advanced-networking.html)

Shared patterns (settings rows, restart badges, side panel, confirm bar, danger zone) are described in [../overview.md](../overview.md).

## Built so far (M3.10, read view)

The page shows every group read only: values, switches and segmented choices reflect `settings.get`, `integrations.get`, `internet.get` and `network.get`, and every control is disabled with a "Coming soon" tooltip (writes and `settings.impact` come in M5). Differences from the full design below:

- No Pending change panel or confirm bar. The side panel says the page is read only, and adds the offline and bridge notes.
- Fast roaming (802.11r) and Legacy device mode rows sit in Wireless (both are read by `settings.get`).
- No Thread device count (eero does not report it). **Reveal** and **Copy dataset** are disabled; `settings.thread.credentials` is not built yet.
- The ISP settings footer says eero does not report the DHCP lease time (a real capture has no lease or renew time).
- The Reservations row links to Reservations & ports without counts.
- Power saving schedules draw on the shared week timeline (`components/ui/timeline.tsx`) in the theme's green, with one line per schedule above it.
- A setting eero does not report shows a dashed, empty switch or `-`; an integration eero leaves out (HomeKit `null` included) shows `Unavailable`, dimmed.

## Layout

Breadcrumb `Settings / Advanced networking`, subtitle "Changes apply to every eero". Settings column on the left, side panel on the right. Rows that restart eeros carry a **Restarts eeros** badge next to their title.

### Internet ("How the gateway eero talks to Ziply Fiber")

- **WAN IP address**: public IP (mono) with copy icon; hint says whether the gateway is behind another router (double NAT).
- **IPv6** (Restarts eeros): `Active` status and a switch. Sub panel: delegated prefix, WAN IPv6, LAN prefix, devices with IPv6 (`24 of 31`), IPv6 DNS, firewall rules link (`2 pinholes`) to [Reservations & ports](reservations-ports.md).
- **ISP settings**: segmented **DHCP** / **Static IP** / **PPPoE**, warning hint that wrong values take the network offline. Sub panel: **Uplink VLAN tag** (ID input 1 to 4094 plus switch, eero 6 or newer), **Multicast IPTV** (ID input plus switch), then Static IP fields (IP address, subnet mask, router IP) and PPPoE fields (username, password with reveal), dimmed unless that mode is selected. Footer: "DHCP lease from Ziply renewed 6h ago" and **Save settings** (disabled until edited).

### Network services ("Addressing, DNS and traffic handling")

- **eero Simple Setup**: switch. Auto adds wired eero 6 or newer units.
- **DHCP and NAT** (Restarts eeros): segmented **Automatic** / **Manual** / **Bridge**. Sub panel fields (read only unless Manual): IP address prefix, subnet IP, subnet mask, gateway, starting IP, ending IP. Hint about Manual, Bridge consequences and that hairpin NAT is always on. **NAT port mode** (Restarts eeros): **Direct** / **Randomized**.
- **Reservations and port forwarding**: link row with counts (`8 reservations · 5 port forwards (4 on)`), **Manage** opens [Reservations & ports](reservations-ports.md).
- **DNS** (Restarts eeros): **ISP default** / **Custom DNS**. Sub panel: IPv4 nameserver 1 and 2, optional IPv6 nameserver; edited fields marked. Info line names the current ISP servers and warns when a custom server is a device on the LAN (here the NAS with a reserved IP).
- **Local DNS caching** (Restarts eeros): switch. Written through `settings.dns.set {caching}`.
- **UPnP**: switch.
- **Optimize for conferencing and gaming (SQM)**: switch; not available in bridge mode.
- **Eco efficiency**: **Power saving schedule** switch with a note that Wi-Fi blips up to 5 seconds when it starts; schedule list (`Overnight · Every day · 1:00 AM to 6:00 AM`) with a 24 hour strip and **Add schedule**.

### Wireless ("Radio features across all eeros")

- **Multi-link operation** (`Wi-Fi 7` badge): switch; restarts the network (estimate from `settings.impact`, about 2 to 3 minutes) and may turn on WPA3.
- **Client steering**: switch.
- **Thread** (`Border router` status): switch, Thread device count. Sub panel: network name, channel, PAN ID, extended PAN ID, network key (masked, **Reveal**), border agent address. **Share credentials with phone keychain** switch. **Copy dataset** and **Regenerate credentials** (danger) with the note that regenerating disconnects every Thread device.
- **WPA3**: link row to [Wi-Fi](wifi.md).

### Integrations ("Smart home platforms")

- **Apple HomeKit**: dimmed, `Unavailable` status, explains which models support it.
- **Amazon Connected Home** (`Linked` status, owner only): **Unlink Amazon** (danger). Sub panel: **eero Built-in** switch (one, network-wide); **Smart Home Hub** with **Discover Zigbee devices**; **Frustration-Free Setup** switch.

### Danger zone

- **Restart network** (`Disruptive` badge): restarts every eero; **Restart network** button.
- **Delete network** (`Destructive · owner` badge): factory resets every eero and removes the network, profiles, history and admins; solid danger **Delete network** button.

### Side panel and confirm bar

- **Pending change**: what changes (`DNS ISP default -> Custom`), "What happens" numbered steps (saved to every eero, eeros restart gateway first with the outage length, devices rejoin) with the restart warning.
- **Confirm bar** (sticky): `1 pending change · DNS to custom servers`, **Discard**, **Apply and restart** (primary). Changes apply now only; there is no scheduled apply.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| WAN IP, double NAT hint, ISP name, lease age | `internet.get` | on load, every 5 min |
| IPv6 state, prefixes, IPv6 DNS | `settings.get` (ipv6) with `internet.get` | on load |
| Devices with IPv6 | `device.list` | on load |
| Pinhole count | `pinhole.list` | on load |
| ISP settings, VLAN, IPTV, static, PPPoE | `settings.get` (wan) | on load |
| Simple Setup, DHCP and NAT, NAT port mode, DNS, caching, UPnP, SQM, power saving, MLO, client steering | `settings.get` | on load, after writes |
| Power saving schedules | `settings.get` (power saving) | on load |
| Reservation and forward counts | `reservation.list`, `forward.list` | on load |
| Custom DNS on a LAN device warning | `reservation.list`, `device.list` | when the DNS fields change |
| Thread state, names, channel, IDs, border agent | `settings.get` (thread, secrets masked) | on load |
| Thread network key, dataset | `settings.thread.credentials` (reveals) | on demand only |
| HomeKit, Amazon, eero Built-in, Smart Home Hub, Frustration-Free Setup | `integrations.get` | on load |
| Feature availability (HomeKit, MLO, VLAN, NAT port mode) | `network.get` (capabilities) | on load |
| Pending change steps and outage length | `settings.impact` `{changes: [{id, params}]}` | when edits change |
| Owner only gating | `network.permissions` | on load |

## Actions

Writes marked "confirm bar" are staged and applied together from the confirm bar; the bar plus the Pending change panel is the confirm step and sends `confirm: true`.

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| WAN IP copy | none | | | Copies the IP |
| IPv6 switch | `settings.ipv6.set` `{enabled}` | disruptive | confirm bar | eeros restart |
| ISP mode, VLAN, IPTV, static, PPPoE, Save settings | `settings.wan.set` `{mode, static?, pppoe?, vlan?, iptv?}` | disruptive | dialog: wrong values take the network offline | eeros restart |
| eero Simple Setup | `settings.simple_setup.set` `{enabled}` | write | no | |
| DHCP and NAT Automatic / Manual | `settings.dhcp.set` `{mode, subnetIp?, subnetMask?, startIp?, endIp?}` | disruptive | confirm bar | |
| DHCP and NAT Bridge | `settings.connection_mode.set` `{mode: "bridged"}` | disruptive | dialog listing what turns off (profiles, forwards, reservations, SQM, guest isolation) | |
| NAT port mode | `settings.nat_randomization.set` `{randomized}` | disruptive | confirm bar | |
| Manage (reservations) | none (navigation) | | | [Reservations & ports](reservations-ports.md) |
| DNS mode and nameservers | `settings.dns.set` `{mode, servers, ipv6Servers?}` | disruptive | confirm bar | |
| Local DNS caching | `settings.dns.set` `{caching}` | disruptive | confirm bar | |
| UPnP | `settings.upnp.set` `{enabled}` | write | no | |
| SQM | `settings.sqm.set` `{enabled}` | write | no | |
| Power saving schedule switch | `settings.power_saving.set` `{scheduleEnabled}` | write | no | Wi-Fi may blip when a schedule starts |
| Add schedule | `settings.power_saving.schedule.add` `{name, days, start, end}` | write | no | Sheet with name, days, times |
| Edit or remove a schedule | `settings.power_saving.schedule.update` / `.remove` | write | no | |
| Multi-link operation | `settings.mlo.set` `{mode}` | disruptive | confirm bar | outage from `settings.impact` |
| Client steering | `settings.band_steering.set` `{enabled}` | write | no | |
| Thread switch | `settings.thread.set` `{enabled}` | write | no | |
| Share credentials with phone keychain | `settings.thread.set` `{credentialSync}` | write | no | |
| Reveal network key, Copy dataset | `settings.thread.credentials` | query | no | Shows or copies the secret |
| Regenerate credentials | `settings.thread.reset` | destructive | dialog: every Thread device must be re-paired | |
| WPA3 row | none (navigation) | | | [Wi-Fi](wifi.md) |
| Unlink Amazon | `integrations.amazon.unlink` | destructive | dialog | Amazon linked features turn off |
| eero Built-in switch | `integrations.builtin.set` `{enabled}` | write | no | |
| Discover Zigbee devices | `integrations.zigbee.discover` | write | no | Note: pairing finishes in the Alexa app |
| Frustration-Free Setup | `integrations.ffs.set` `{enabled}` | write | no | |
| Restart network | `network.restart` | disruptive | inline confirm with outage length | |
| Delete network | `network.delete` `{networkName}` | destructive | dialog: type the network name | Signed out of that network; switcher picks another |
| Discard | none | | | Clears staged changes |
| Apply and restart | staged commands, each with `confirm: true` | disruptive | this is the confirm | Progress in the bar until eeros return |

## States

- **Loading:** rows render with their titles; controls show skeletons until `settings.get` returns.
- **Pending changes:** confirm bar and Pending change panel visible; edited fields marked. With no pending change the panel shows the last applied change or is hidden.
- **Applying:** the bar shows the estimate from `settings.impact` ("Restarting eeros, about 8 min" for DNS, DHCP, WAN or connection mode); the app keeps polling `network.health` and refetches when the network is back. If the computer is behind this network, it says so and waits for the connection.
- **Error:** a failed write keeps the staged change and shows the eero error in the bar.
- **Bridge mode:** DHCP shows Bridge selected; NAT port mode, DNS, SQM, UPnP, reservations row and IPv6 pinholes are disabled with a single hint per section. In ISP settings only Multicast IPTV shows.
- **Capability missing:** VLAN and PPPoE need eero 6 or newer; NAT port mode needs eeroOS 7.16.1 or newer; MLO needs Wi-Fi 7 eeros; HomeKit only on supported models. Hide or grey the row with a reason.
- **No permission:** Amazon Connected Home and Delete network are owner only; admins see them disabled with "Owner only".
- **Offline:** settings are read from the cloud and still show; writes are blocked with "Your network is offline, changes cannot reach the eeros".

## Notes

- Almost every toggle goes through `PUT {net}/settings`. Field reports say DNS and DHCP writes rebooted every eero (about 8 minutes). DNS caching is part of the same `dns` object, so it goes through `settings.dns.set` and is disruptive (the mockup shows no restart badge on that row; add one).
- Outage estimates come from core only: `settings.impact` returns them from the table in [commands.md](../../architecture/commands.md#restart-estimates) (about 8 minutes for DNS, DHCP, WAN and connection mode writes; about 2 to 3 minutes for a network restart, MLO and legacy mode).
- **eero Built-in** is one network-wide switch (`PUT {net}/proxied_nodes {enabled}`); eero has no per-device toggle, so the page has none.
- Static IP and PPPoE values are secrets in transit only; never log them. PPPoE credentials may go through `POST {eero}/pppoe` first (returns an encrypted blob).
- Thread credentials are secrets: `settings.get` masks them and only `settings.thread.credentials` returns them.
- Smart Home Hub appears among eero Business features in our notes; confirm it is free before building it (open question). Amazon linking itself (Connect to Amazon) needs Amazon sign-in in a browser and is out of scope; an unlinked network just shows "Link in the eero app".
- Commands added: `settings.simple_setup.set` w, `settings.nat_randomization.set` d, `settings.power_saving.schedule.add|update|remove` w, `settings.thread.credentials` q, `settings.impact` q, `integrations.get` q, `integrations.amazon.unlink` x, `integrations.builtin.set` w, `integrations.zigbee.discover` w, `integrations.ffs.set` w, `network.delete` x. `settings.connection_mode.set` is NAT, bridged or IP passthrough; legacy 802.11ac mode is `settings.legacy_mode.set` (see [Troubleshooting](troubleshooting.md)).

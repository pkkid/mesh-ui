# Reservations & ports

Fixed IPv4 addresses, port forwards and IPv6 pinholes, with a map of how the LAN address space is used.

Mockup: [../../mockups/14-reservations-ports.html](../../mockups/14-reservations-ports.html)

Shared patterns (flat hero, tables, sheets, footnotes) are described in [../overview.md](../overview.md).

## Layout

Breadcrumb `Settings / Reservations & ports`, nothing after it. One full-width column, sections `gap-14` apart (the Good to know side panel moved into the hero on 2026-11-21). Every section has a data-driven subtitle under its title; buttons that open a sheet end in an ellipsis and have dim icons; explanations sit in footnotes under the cards.

1. **Hero** (the flat page header). Title `Reservations & ports`. Status line: the network status and its connection mode (`NAT mode`), plus, on its own line while the network is offline, "Maple Street is offline. These are the addresses and rules eero last reported." Facts: **Reservations** (`8`), **Port forwards** (`5 · 4 on`), **IPv6 rules** (`2`), **Public IP** (mono). Right-hand column, flat (`w-72`): **Good to know**: first, a forward needs a reservation, picking a device without one creates it, and these changes apply instantly and never restart eeros; then hairpin NAT is always on (with the public IP); and, only while the network is in bridge or passthrough mode, that forwards and reservations are off. In bridge or passthrough mode the facts are left out and an empty card says why, with **View advanced networking**.
2. **LAN address map**, subtitle `192.168.4.0/22, 1,024 addresses, 8 reserved, 22 leased`. Legend (Gateway, Static range, Reserved, Leased, Free in pool) on the right of the header on wide windows (`xl`), and under the subtitle, wrapping, on narrower ones; it never disappears. A range bar split into gateway, static range (`.4.2 to .4.99`) and DHCP pool (`192.168.4.100 to 192.168.7.254 · 923 addresses, 23 leased`). Below it a grid of squares, one per address (64 per row, every row the same height with no gaps; the first address of each /24 labelled, the label top-aligned with its row and taking no height of its own; subnets over 4,096 addresses show the range bar only; the grid is at most 16 rows tall, the height of eero's default /22, and a bigger range scrolls inside it), coloured by kind; hovering a square shows its address. Footnote: reservations sit in the static range so they never collide with leases (and hover a square for its address).
3. **IPv4 reservations**, subtitle `8 devices with a fixed address, 3 with port forwards`. Header: filter input and **Add a reservation…**. Table: Device (icon, name, connection and online state), MAC address, Reserved IP, Connected to (eero dot and name), Ports (count of forwards using this IP, `-` when none), overflow menu (**Edit…**, **Remove** or **Remove with its forwards…**). Offline devices are dimmed.
4. **Port forwards**, subtitle `5 forwards, 4 on, open on 203.0.113.48` (`Nothing open to the internet`). Header: **Add port forward…**. Table: Name, Device, Internal IP, External port or range, arrow, Internal port or range, Protocol (TCP, UDP, TCP+UDP), Enabled switch, overflow menu. Disabled forwards are dimmed.
5. **IPv6 firewall rules**, subtitle `2 pinholes open to one device each` ; left out entirely while IPv6 is off, along with the hero's IPv6 rules fact. Header: **Add a rule…**. Rows: device icon and name, its IPv6 address, port, protocol.

**Add port forward sheet** (opens from the button; a clean sheet, no divider lines): Device dropdown (the app's `Select`: name in the trigger, each option with its IP on the right; helper "192.168.4.23, reserved: it never changes" or "..., not reserved yet: saving reserves it"), Nickname, then one row of External port ("One port or a range"), Internal port ("Same as external if empty") and a Protocol dropdown **TCP** / **UDP** / **TCP + UDP**, an Enabled row with the standard switch ("Off keeps the rule but closes the port"), validation lines ("No conflict with existing port forwards", "Applies instantly, no restart"), footer **Cancel** and **Save port forward**. The reservation and IPv6 rule sheets still have dividers, the native device select and the Protocol Segmented; they move over next.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Subnet, static range, DHCP pool, gateway | `reservation.list` (`lan`) | every 60 s |
| Leased addresses and count | `reservation.list` (`leases`, counted in core) | every 60 s, after writes |
| Reserved addresses and table | `reservation.list` | every 60 s, after writes |
| Device name, state, eero per reservation | `device.list`, `eero.list` | every 60 s |
| Ports column | `forward.list` grouped by IP | every 60 s |
| Public IP in the forwards header | `internet.get` | on load |
| Port forwards table | `forward.list` | every 60 s, after writes |
| IPv6 pinholes | `pinhole.list` | every 60 s, after writes |
| Connection mode subtitle, offline note | `network.get` | polled |
| Sheet conflict check | `forward.validate` `{device, externalPort, internalPort, protocol, forward?}` | as the fields change (debounced) |

`reservation.list`, `forward.list` and `pinhole.list` share one cached
`GET {net}/routing`, so the page makes one routing read (tested in
`routing.test.ts`). The lists poll every 60 s and refetch when the page opens
on data older than that, so a rule added or removed in the eero app shows
up without a restart.

## Actions

Built in M5.5. All of these are plain writes: they apply instantly and never
restart eeros, so none needs `confirm`; the UI asks first only before a
removal. Each control dims with its command's gate (`settings` update
permission, off in bridge mode). Every success toast has Undo, except a
reservation removed together with its forwards. Removing a rule the eero
app already removed is not an error: core answers `alreadyGone`, the toast
says "Plex was already removed" (no Undo) and the lists refresh. The sheets live in
`features/ports/RuleSheet.tsx` and are shared with device detail.

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Reservation filter | none (view state) | | | Filters rows by name, MAC or IP |
| Add a reservation | `reservation.add` `{device, ip?, description?}` | write | no | Sheet with a device picker; the address starts as the device's current one, and left empty core picks the first free address in the static range |
| Reservation menu: Edit | `reservation.update` `{reservation, ip?, description?}` | write | no | Same sheet, device fixed |
| Reservation menu: Remove | `reservation.remove` `{reservation, removeForwards}` | write | dialog; when forwards use the address it says they go too ("This also removes the 3 port forwards on 192.168.4.23") and `removeForwards` is true | |
| Reservation menu: Open device | none (navigation) | | | Device detail |
| Add port forward | opens the sheet | | | |
| Sheet Save port forward | `forward.add` `{device, description, externalPort, internalPort, protocol, enabled}` | write | no | Creates the reservation first if the device has none; the toast says so ("Added Lamp UI and reserved 192.168.4.190") |
| Sheet Cancel, X, backdrop | none | | | Closes the sheet |
| Enabled switch | `forward.update` `{forward, enabled}` | write | no | |
| Forward menu: Edit | `forward.update` | write | no | Same sheet, filled in |
| Forward menu: Remove | `forward.remove` `{forward}` | write | dialog | |
| Pinhole Add | `pinhole.add` `{device, port, protocol}` | write | no | Sheet with device, port or range, protocol |
| Pinhole row menu: Remove | `pinhole.remove` `{pinhole}` | write | dialog | |
| Device detail: Reserve or Edit (IP addresses) | `reservation.add` or `reservation.update` | write | no | The reservation sheet with the device picked |
| Device detail: + Open a port, trash, off switch (Port forwarding) | `forward.add`, `forward.remove`, `forward.update` | write | dialog for remove | The port forward sheet with the device picked |

## States

- **Loading:** map grid shows empty squares; tables show placeholder rows.
- **Empty:** "No reservations yet.", "No port forwards yet.", "No IPv6 rules yet." each with its add button.
- **Error:** inline note per section with **Retry**. Sheet errors are core's `bad_params` issues under their field ("That address is outside your network (192.168.4.0/22).", "Port 8080 is already forwarded to Alex's MacBook Pro (Web dev server).", "Alex's iPhone is using that address now."); eero's own codes (`error.reservation.ip.invalid`, `error.assignment.ip.unavailable`) also come back as `bad_params`. Other write errors toast with Retry.
- **Offline:** a muted line above the map says the network is offline and the lists are what eero last reported.
- **Bridge mode:** the whole page shows a single note "Reservations and port forwards are off while the network is in bridge mode" (IP passthrough says so too) with a link to [Advanced networking](advanced-networking.md); tables are hidden.
- **IPv6 off** (`settings.get` `ipv6.enabled` false; `settings.ipv6.set` refreshes it): the IPv6 section shows "Turn on IPv6 to add firewall rules." with a link to Advanced networking, and no Add.
- **Capability missing:** port ranges need the `port_forward_range` capability; without it `forward.validate` says "This network takes single ports only, not ranges." under the port.
- **No permission:** add, edit, the switch and remove are dimmed with the reason when `network.permissions` denies `settings` updates.

## Notes

- `GET {net}/routing` returns devices, reservations, forwards and pinholes in one call. Core can use it to serve all three list commands from one request.
- Removing a reservation uses `?delete_forwards=true|false`; the confirm decides which.
- A forward needs a reserved IP. `forward.add` creates the reservation in core when the device has none, so the CLI gets the same behaviour.
- `forward.validate` checks overlap with existing forwards (overlapping protocol, overlapping external range), port range bounds, range length, the range capability and that the device has or can get a reservation. The sheet runs it 300 ms after the fields settle and shows its issues under the fields and the "No conflict" line. The same checks run inside `forward.add` and `forward.update`, which fail with `bad_params`.
- The address map only needs the DHCP config, reservations and current leases; it never scans the LAN.
- The sheet for reservations and pinholes is not in the mockup; reuse the port forward sheet layout.
- Commands added: `forward.validate` q.

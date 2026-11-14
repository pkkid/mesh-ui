# Reservations & ports

Fixed IPv4 addresses, port forwards and IPv6 pinholes, with a map of how the LAN address space is used.

Mockup: [../../mockups/14-reservations-ports.html](../../mockups/14-reservations-ports.html)

Shared patterns (tables, sheets, side panel) are described in [../overview.md](../overview.md).

## Layout

Breadcrumb `Settings / Reservations & ports`, subtitle shows the connection mode (`NAT mode`). Main column on the left, side panel on the right.

1. **LAN address map.** Sub line is the subnet (`192.168.4.0/22 · 1,024 addresses`). Legend in the header: Gateway, Static range, Reserved, Leased, Free in pool. A range bar split into gateway, static range (`.4.2 to .4.99`) and DHCP pool (`192.168.4.100 to 192.168.7.254 · 923 addresses, 23 leased`). Below it a grid of squares, one per address (64 per row, the first address of each /24 labelled; subnets over 4,096 addresses show the range bar only), coloured by kind; hovering a square shows its address. Info line: reservations sit in the static range so they never collide with leases.
2. **IPv4 reservations** ("Devices that always get the same address"). Header: filter input and **Add a reservation**. Table: Device (icon, name, connection and online state), MAC address, Reserved IP, Connected to (eero dot and name), Ports (count of forwards using this IP, `-` when none), overflow menu. Offline devices are dimmed.
3. **Port forwards** ("Open to the internet on 203.0.113.48"). Header: **Add port forward** (primary). Table: Name, Device, Internal IP, External port or range, arrow, Internal port or range, Protocol (TCP, UDP, TCP+UDP), Enabled switch, overflow menu. Disabled forwards are dimmed.
4. **IPv6 firewall rules** ("Pinholes to one device"). Header: **Add**. Rows: device icon and name, its IPv6 address, port, protocol.

Side panel **Good to know** (below the sections on windows narrower than 1536 px, so the forwards table never scrolls sideways): a forward needs a reservation and picking a device without one creates it; hairpin NAT is always on; forwards and reservations are off in bridge mode; these changes apply instantly with no restart.

**Add port forward sheet** (opens from the button): Device select (shows the IP and "Has a reservation, address will not change"), Nickname, External port and Internal port (single or range, internal defaults to same as external), Protocol segmented **TCP** / **UDP** / **TCP + UDP**, Enabled switch, a flow diagram (Internet with public IP and port, gateway eero, device with internal IP and port), validation lines ("No conflict with existing port forwards", "Applies instantly, no restart"), footer **Cancel** and **Save port forward**.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Subnet, static range, DHCP pool, gateway | `reservation.list` (`lan`) | on load |
| Leased addresses and count | `reservation.list` (`leases`, counted in core) | on load, after writes |
| Reserved addresses and table | `reservation.list` | on load, after writes |
| Device name, state, eero per reservation | `device.list`, `eero.list` | every 60 s |
| Ports column | `forward.list` grouped by IP | on load |
| Public IP in the forwards header | `internet.get` | on load |
| Port forwards table | `forward.list` | on load, after writes |
| IPv6 pinholes | `pinhole.list` | on load, after writes |
| Connection mode subtitle, offline note | `network.get` | polled |
| Sheet conflict check | `forward.validate` `{device, externalPort, internalPort, protocol, forward?}` | as the fields change (debounced) |

`reservation.list`, `forward.list` and `pinhole.list` share one cached
`GET {net}/routing`, so the page makes one routing read (tested in
`routing.test.ts`).

## Actions

M3 ships the page read-only: Add, the row menus and the Enabled switch are
disabled "Coming soon" controls until the write commands below land. All of these are plain writes: they apply instantly and never restart eeros, so none needs `confirm`.

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Reservation filter | none (view state) | | | Filters rows by name, MAC or IP |
| Add a reservation | `reservation.add` `{device or mac, ip, description}` | write | no | Sheet with device picker and a suggested free IP in the static range |
| Reservation menu: Edit | `reservation.update` `{reservation, ip?, description?}` | write | no | |
| Reservation menu: Remove | `reservation.remove` `{reservation, removeForwards}` | write | inline confirm when forwards use it ("Also remove 3 port forwards?") | |
| Reservation menu: Open device | none (navigation) | | | Device detail |
| Add port forward | opens the sheet | | | |
| Sheet Save port forward | `forward.add` `{device, description, externalPort, internalPort, protocol, enabled}` | write | no | Creates the reservation first if the device has none |
| Sheet Cancel, X, backdrop | none | | | Closes the sheet |
| Enabled switch | `forward.update` `{forward, enabled}` | write | no | |
| Forward menu: Edit | `forward.update` | write | no | Same sheet, filled in |
| Forward menu: Remove | `forward.remove` `{forward}` | write | inline confirm | |
| Pinhole Add | `pinhole.add` `{device, port, protocol}` | write | no | Sheet with device, port or range, protocol |
| Pinhole row menu: Remove | `pinhole.remove` `{pinhole}` | write | inline confirm | |

## States

- **Loading:** map grid shows empty squares; tables show placeholder rows.
- **Empty:** "No reservations yet.", "No port forwards yet.", "No IPv6 rules yet." each with its add button.
- **Error:** inline note per section with **Retry**. Write errors map eero codes to plain text (`error.reservation.ip.invalid` = "That address is outside your network", `error.assignment.ip.unavailable` = "That address is already in use").
- **Offline:** a muted line above the map says the network is offline and the lists are what eero last reported.
- **Bridge mode:** the whole page shows a single note "Reservations and port forwards are off while the network is in bridge mode" (IP passthrough says so too) with a link to [Advanced networking](advanced-networking.md); tables are hidden.
- **IPv6 off** (not built in M3; needs the IPv6 setting): the IPv6 section shows "Turn on IPv6 to add firewall rules" with a link.
- **Capability missing:** port ranges need the `port_forward_range` capability; without it the sheet accepts single ports only and says so.
- **No permission:** add, edit and remove hidden if `network.permissions` denies routing updates.

## Notes

- `GET {net}/routing` returns devices, reservations, forwards and pinholes in one call. Core can use it to serve all three list commands from one request.
- Removing a reservation uses `?delete_forwards=true|false`; the confirm decides which.
- A forward needs a reserved IP. `forward.add` creates the reservation in core when the device has none, so the CLI gets the same behaviour.
- `forward.validate` checks overlap with existing forwards (same protocol, overlapping external range), port range bounds and that the device has or can get a reservation. The same checks run inside `forward.add`, which fails with `bad_params` on conflict.
- The address map only needs the DHCP config, reservations and current leases; it never scans the LAN.
- The sheet for reservations and pinholes is not in the mockup; reuse the port forward sheet layout.
- Commands added: `forward.validate` q.

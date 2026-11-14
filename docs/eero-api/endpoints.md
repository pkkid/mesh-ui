# eero cloud API: endpoints

Reference for the unofficial eero cloud API that the mobile app uses, compiled
2026-11-12 from the source of open source clients. Nothing here was tested
against the live API by the Mesh UI project, and eero can change any of it
without notice. Agents never call this API (see [Testing](../testing.md));
Rows that were checked with a read-only capture on a real network (key
paths and types only) say so, and [Real captures for M3](#17-real-captures-for-m3-2026-11-13)
lists them ([section 18](#18-real-captures-for-m4-2026-11-13) for the
objects the M4 writes change). The client that does is described in
[architecture/eero-client.md](../architecture/eero-client.md), and the fields
are in [data-model.md](data-model.md).

**Scope.** Mesh UI does not support eero Plus (or eero Secure) features.
Rows marked **$** need a subscription and are **out of scope**: they are kept
here only so nobody rediscovers them by accident and so the client can
recognise their errors. Do not build commands for them.

## Conventions used in this file

- Base: `https://api-user.e2ro.com`. Default version prefix `/2.2/`. Some families need `/2.3/` or `/2.4/` (called out per row).
- `{net}` = the network `url` returned by the API, normally `/2.2/networks/{network_id}`. Prefer the URLs the API hands back (`url`, `resources.*`) over building paths yourself; several clients note the published link can move to another version (see "API versions" below).
- `{eero}` = eero node `url` (`/2.2/eeros/{eero_id}`), `{device}` = device `url`, `{profile}` = profile `url`.
- Body encodings: **JSON**, **form** (`application/x-www-form-urlencoded`, booleans as `true`/`false`), **empty-JSON** (the literal two-byte body `""` with `Content-Type: application/json`, which is what clients send for parameterless POSTs), **none**.
- Every response is `{ "meta": { "code": int, "server_time": str, "error"?: str }, "data": ... }`. "Returns" below describes `data`.
- Kind column: **R** read-only, **W** mutating, **D** destructive or disruptive (reboots, deletes, outages, credential resets), **$** needs eero Plus / Secure (server answers 402 or an `error.premium.*` code otherwise). **$ rows are out of scope for Mesh UI.**.
- Client codes (summarised in [eero-client.md](../architecture/eero-client.md#prior-art)):
  - **SX** schmittx/home-assistant-eero (HA integration)
  - **FF** fulviofreitas/eero-api (PyPI `eero-api`, the most complete SDK; many endpoints marked "live-verified")
  - **LD** Los33c/unofficial_eero_desktop_native (desktop app; ships a 3,700 line API-REFERENCE.md)
  - **MX** 343max/eero-client (PyPI `eero`), **ES** EvanSchalton/eero-client (PyPI `eero-client`, pydantic models)
  - **EH** erikh/eero (Rust), **DC** dciobanu/eero-cli (Go), **ED** EnricoFlammini/Dashboard_EERO, **YV** Yeraze/eeroVista, **XD** xrvk/eero-dashboard (wraps FF)

Approximate total: about 230 distinct eero API endpoints (method + path) across all sources, of which roughly 150 are relevant to a router management client. LD alone documents ~300 calls including billing, chat, Guardian VPN, Amazon sign-in and onboarding.

---

## 1. Auth and session

| Method | Path | Body / params | Returns | Kind | Clients | Notes |
|---|---|---|---|---|---|---|
| POST | `/2.2/login` | `{login}` email or E.164 phone (`+15551234567`). JSON (SX, MX, EH) or form (FF, LD), both accepted | `{user_token: str}` | W | all | Sends a one-time code by email/SMS. `user_token` is not yet valid for API calls. LD rate-limits "resend" to once per 60 s. |
| POST | `/2.2/login/verify` | `{code}` (4-10 digits). Cookie `s=<user_token>` | user/account-ish object | W | all | After success the same `user_token` becomes the session. LD and EH also check `Set-Cookie: s=...` and `data.user_token` / `data.session_token` and prefer a new value if present. Wrong code: 401 `error.code.invalid` / `error.verification.invalid`; keep the pending token to retry. |
| POST | `/2.2/login/resend` | empty-JSON or `{}`. Cookie `s=<user_token>` | maybe `{user_token}` | W | FF, LD | Resend the code. `error.too.many.resends` if abused. |
| POST | `/2.2/login/refresh` | none / empty-JSON. Current cookie | `{user_token}` | W | SX, MX, FF, LD, ES | Called when any request returns HTTP 401 with `meta.error == "error.session.refresh"`. SX/MX/LD replace the token with the returned one (LD prefers `Set-Cookie s=`). FF keeps the old token (says the server's value is ignorable). Safest: accept a new token if one comes back. Retry the original request once. |
| POST | `/2.2/logout` | FF sends form field literally named `Cookie` = `s=<token>`; LD and EH send no body | - | W | FF, LD, EH | Best effort; clear local token regardless. |
| POST | `/2.2/login/amazon` | form `{auth_token: <Amazon LWA access_token>, create_account: false}` | `{user_token}` / `Set-Cookie` | W | LD | Login with Amazon. `error.login.unknown` if not linked. Not needed for email/phone flow. |
| GET | `/2.2/login/temporary` | `?client_type=WEB_PAYMENTS&target_page=...` | temporary web login URL/token | R | LD | Used to hand off to web billing / eero Insight. |
| POST | `/2.2/register`, `/2.2/register/verify`, `/2.2/register/phone/resend`, `/2.2/register/email/resend` | see LD | `{user_token}` | W | LD | Account creation. Out of scope for Mesh UI. |
| GET | `/2.2/consents/account?country=US` | - | `[{name, localized_consent, requires_consent}]` | R | LD | Registration consents. |
| GET | `/2.2/account` with no cookie | - | expect 401 | R | LD | LD uses this as a cheap "can I reach eero" probe. |

## 2. Account (user)

| Method | Path | Body / params | Returns | Kind | Clients | Notes |
|---|---|---|---|---|---|---|
| GET | `/2.2/account` | - | Account object (see [data-model.md](data-model.md)): `name`, `email{value,verified}`, `phone{value,country_code,national_number,verified}`, `log_id`, `networks{count,data[{url,name,created,nickname_label,access_expires_on,amazon_directed_id}]}`, `role`, `premium_status`, `premium_details`, `push_settings{networkOffline,nodeOffline}`, `consents`, `can_transfer`, `auth{type}`, `trust_certificates_etag`, `eero_for_business` | R | all | Entry point. Network list lives here. |
| GET | `/2.2/networks` | - | `[{url, name, ...}]` | R | FF, LD, ED | Fallback list (LD uses only when `account.networks` is empty). |
| PUT | `/2.2/account/name` | form `name` | account | W | FF, LD | |
| PUT | `/2.2/account/email` | form `email` | - | W | FF, LD | Pending until verified. |
| POST | `/2.2/account/email/verify` | form `code` | - | W | FF, LD | |
| PUT | `/2.2/account/phone` | form `phone` | - | W | FF, LD | |
| POST | `/2.2/account/phone/verify` | form `code` | - | W | FF, LD | |
| PUT | `/2.2/account/consents` | form `marketing_emails=true|false` | - | W | FF, LD | |
| PUT | `/2.2/account/push_settings` | JSON `{networkOffline: bool, nodeOffline: bool}` (send all keys) | - | W | FF, LD | Phone push toggles. |
| GET | `/2.2/countries/sms` | - | SMS-capable country list | R | FF, LD | |
| GET | `/2.2/account/eero_support` | - | `{contacts:[{type: CHAT|HELP_LINK|PHONE|EMAIL, title, content}]}` | R | LD | Support contacts. |
| GET/POST/PUT/DELETE | `/2.2/account/trust`, `/2.2/account/trust/{serial}` | form `certificate` (PEM), `serial` | cert list | W | LD | Trusted certificates. Niche. |
| GET | `/2.2/app_configuration[?networkId=]`, `/2.2/data-controller/info`, `/2.2/directedid?d=0&i=0&p=0` | - | misc | R | LD | Misc account metadata. |
| GET | `/2.2/premium/customer` | - | subscription record (`plan`/`plan_name`) | R | FF, LD | eero Plus billing status. |
| GET | `/2.2/account/identity_protection` (+ `/signup`, `/scan`, `/scan/email`, `/verify_email` POSTs) | - | `{enabled, status}` | R/W $ | LD | eero Plus identity protection (Malwarebytes). |
| DELETE | `/2.2/account` | none | - | **D** | LD | **Deletes the eero account.** Never expose casually. |

## 3. Networks (top level)

| Method | Path | Body / params | Returns | Kind | Clients | Notes |
|---|---|---|---|---|---|---|
| GET | `{net}` | - | Network object (the big one: name, status, health, speed, dns, dhcp, lease, connection, settings booleans, guest_network, updates, premium_dns, capabilities, resources, eeros{count,data}, clients{count,url}, geo_ip, ip_settings, ddns, thread, temporary_flags...) | R | all | Main dashboard read. `resources` map gives the canonical URL for sub-resources. |
| PUT | `{net}` | form `name` | network | W | LD | Rename SSID (LD). FF uses `PUT {net}/settings` form `name` instead. Devices must reconnect. |
| GET | `{net}/password` | - | string or `{password}` | R | LD | Main Wi-Fi password (also in network object `password`). |
| PUT | `{net}/password` | form `password` (8-63 printable ASCII) | - | W **D** | FF, LD | Change main Wi-Fi password: every client drops. |
| DELETE | `{net}/password` | - | - | W **D** | FF | Clears password (open network). Dangerous. |
| POST | `/2.2/util/generatepassword` | JSON `{}` | string or `{password}` | R | LD | Server-suggested password, changes nothing. |
| PUT | `{net}/label?labelType=specialMarket` | form `label` | - | W | LD | Network nickname shown in apps (not SSID). Read from `nickname_label`. |
| POST | `{net}/reboot` | empty-JSON | - | **D** | SX, FF, LD, MX, ES, EH, DC, ED | **Reboots every eero on the network.** |
| GET | `{net}/permissions` | - | `{role: "standard-admin"|..., permissions{<area>:{create,read,update,delete}, per_eero:[...]}}` | R | FF | What the signed-in user may do. Use to gate UI. |
| GET | `{net}/members` | - | `{members:[{user_id, user_role: owner|admin|..., user_name, user_email?, user_tags}]}` | R | FF, LD | Real (2026-11-13): `{members: [{user_id: number, user_role, user_name, user_tags: string[]}]}`, no email. |
| GET | `{net}/invites` | - | `[{invite_id, invite_nickname, created}]` | R | FF, LD | FF saw access-denied on a non-owner. Real (2026-11-13), owner, none pending: a bare empty array. |
| POST | `{net}/invites` | JSON `{invite_role: "admin"}` | `{invite_url}` | W | FF, LD | Creates shareable admin invite link. |
| PUT / DELETE | `{net}/invites/{invite_id}` | JSON `{invite_nickname}` | - | W | FF, LD | |
| POST | `{net}/invites/response` | JSON `{invite_id}` or `{invite_code}` + accept/decline | - | W | FF, LD | |
| POST | `{net}/invites/cancel_pending_admin` | empty-JSON | - | W | FF, LD | |
| POST | `{net}/member_promotion` | JSON `{member_id}` | - | W | FF, LD | Promote member to admin. |
| DELETE | `{net}/admins/{user_id}` | - | - | **D** | FF, LD | Removes an admin's access. |
| POST | `/2.2/inviteQuery` | JSON `{invite_code}` | network + role the code grants | R | FF, LD | |
| GET | `/2.2/incoming_member_promotions` | - | list | R | LD | |
| GET/POST/DELETE | `{net}/transfer` | form `{name, email, phone}` | `{recipient_*, transfer_date}` | W **D** | LD | Ownership transfer. Also `/2.2/transfer/has_networks?email=`, `/2.2/network_transfers/pending`, `/2.2/network_transfers/{id}/accept|deny`. |
| DELETE | `{net}` | - | - | **D** | LD | **Deletes the whole network.** |
| PUT | `{net}/flags/{flag_name}` | form `value` | - | W **D** | LD | Raw network feature flags (`network.flags[]`). Unknown flags can change behaviour. Avoid. |
| PUT / DELETE | `{net}/temporary_flags/hide_5g` | PUT JSON or form `{value: true}`; DELETE none | - | W | SX, FF, LD | Temporarily hide 5 GHz for onboarding 2.4 GHz-only IoT devices. Auto-expires; state in `temporary_flags.hide_5g{value, expires_on}`. |

## 4. Network settings

Most toggles are written through one endpoint, `PUT {net}/settings` (`resources.settings`). **FF warns, from live testing, that a DNS write here rebooted every eero (about 8 minutes of outage), and a DHCP write did the same.** Treat every `settings` write as possibly causing a mesh restart: read first, skip if unchanged, never retry in a loop, and warn the user.

| Method | Path | Body | Kind | Clients | Notes |
|---|---|---|---|---|---|
| PUT | `{net}/settings` | JSON `{band_steering: bool}` | W | SX, FF, LD | Client steering. Read from network `band_steering`. |
| PUT | `{net}/settings` | JSON `{upnp: bool}` | W | SX, FF, LD | Read `upnp`. |
| PUT | `{net}/settings` | JSON `{wpa3: bool}` | W | SX, FF, LD | Read `wpa3`. Older devices may drop. |
| PUT | `{net}/settings` | JSON `{sqm: bool}` | W | SX, FF, LD | "Optimize for conferencing and gaming" (Smart Queue Management). FF sends it as query `?sqm=true`; SX/LD as JSON. |
| PUT | `{net}/settings` | JSON `{ipv6_upstream: bool}` (FF `set_ipv6` also sends `ipv6_downstream`) | W | SX, FF, LD | IPv6 toggle. |
| PUT | `{net}/settings` | JSON `{ffs: bool}` | W | LD | Amazon Frustration-Free Setup. |
| PUT | `{net}/settings` | form `name` | W | FF | Rename SSID (FF live-verified). |
| PUT | `{net}/settings` | JSON `{timezone: {value: "America/New_York"}}` | W | LD | Schedules follow network timezone. |
| PUT | `{net}/settings` | JSON `{dns: {mode: "automatic"|"custom", caching: bool, custom: {ips: [..up to 4, v4 or v6]}}}` and/or `{ipv6: {name_servers: {mode, custom: [...]}}}` | W **D** | FF, LD | Custom DNS. **Confirmed mesh reboot (FF).** Read from `dns{mode, caching, parent{ips}, custom{ips}}`, `ipv6.name_servers`. |
| PUT | `{net}/dns` | JSON `{caching: bool}` | W **D** | SX | SX's DNS caching toggle (alternate path). FF uses `settings` `{dns:{caching}}`. |
| PUT | `{net}/settings` | JSON `{connection: {mode: "nat"|"bridged"|"ipPassthrough"}, nat_port_randomization: bool, dhcp: {mode: "automatic"|"custom", custom: {subnet_ip, subnet_mask, start_ip, end_ip}}}` | W **D** | FF, LD | Bridge mode / LAN subnet / DHCP range. Bridge or passthrough disables profiles, routing, many Plus features. Mesh restart. |
| PUT | `{net}/settings` | JSON `{lease: {mode: "dhcp"|"static", static: {ip, mask, router}}}` | W **D** | LD | WAN static IP. Wrong values take the network offline. |
| PUT | `{net}/settings` | JSON `{pppoe: {enabled, credentials?{username,password}}, vlan: "" | "100"}` | W **D** | LD | PPPoE and ISP VLAN tag. |
| POST | `{eero}/pppoe` | JSON `{pppoe:{username,password}}` | W | FF | Returns encrypted credential blob for a later settings write. |
| GET | `{net}/fast_transition` | - | R | FF, LD | `{fast_transition: bool}` (802.11r). |
| PUT | `{net}/fast_transition` | JSON `{fast_transition: bool}` | W | FF, LD | |
| GET | `{net}/wpa3_per_band` | - | R | FF, LD | `{band_2_4_ghz, band_5_ghz, band_6_ghz}` values `WPA2`/`WPA2_WPA3`/`WPA3` (case varies). Real (2026-11-13): only `band_2_4_ghz` and `band_5_ghz`, both strings. |
| PUT | `{net}/wpa3_per_band` | JSON `{band_2_4_ghz?, band_5_ghz?}` | W | FF, LD | 6 GHz is always WPA3. |
| PUT | `{net}/mlo_mode` | JSON `{mlo_mode: "disabled"|"single"|"multi"}` | W | FF, LD | Wi-Fi 7 multi-link. Shown when network has `mlo_mode`. |
| GET / PUT | `{net}/ac_compat` | PUT form `enabled` | R/W | FF, LD, ES | Legacy 802.11ac compatibility mode. |
| PUT | `{net}/passpoint/enabled` | JSON `{enabled}` | W | FF, LD | Hotspot 2.0. |
| GET / PUT | `{net}/proxied_nodes` | JSON `{enabled}` | R/W | FF, LD | "eero Built-in" (Amazon/partner devices acting as nodes). Device list can be filtered with `?proxied_node=`. `GET` is a **404** on a real network (2026-11-13); the state is the network's embedded `proxied_nodes{enabled, devices[]}`. |
| PUT | `{net}/power_saving` | JSON `{enable?, power_saving_schedule_enabled?}` | W | FF, LD | Read from network `power_saving`, `power_saving_schedule_enabled`. |
| GET | `{net}/power_saving/schedules` | - | R | FF, LD | `{schedules:[{url,id,name,days[],start_time,end_time,enabled}]}` |
| POST | `{net}/power_saving/schedules` | JSON `{name, days:["MON",...], start_time:"22:00", end_time:"07:00", enabled}` | W | FF, LD | |
| PUT / DELETE | `{net}/power_saving/schedules/{id}` (or item `url`) | same fields | W | FF, LD | |
| PUT | `{net}/ddns/enable` | none | W $ | SX, FF, LD | eero DDNS. State in `ddns{enabled, subdomain}`. |
| PUT | `{net}/ddns/disable` | none | W $ | SX, FF, LD | |
| GET | `{net}/thread` | - | R | SX, FF, LD, ES | `{url, enabled, enable_credential_syncing, name, channel, pan_id, xpan_id, master_key, commissioning_credential, active_operational_dataset, border_agent{ip,port}}`. Contains secrets. Real (2026-11-13): no `active_operational_dataset`; `border_agent{ip: string, port: number}`. |
| PUT | `{net}/thread` | JSON `{thread_enable?: bool, enable_credential_syncing?: bool}` | W | FF, LD | FF corrected key to `thread_enable`. |
| PUT | `{net}/thread/enable` | JSON `{enabled: bool}` | W | SX | Older path used by SX. |
| POST | `{net}/thread` | none | **D** | FF, LD | **Regenerates Thread credentials**: every Thread device must re-pair. |
| GET | `{net}/radio_settings` | - | R | LD | Channel and power per eero radio. |
| GET | `/2.2/networks/{id}/safe_filter_levels?safeFilterType=SubnetFilter|ProfileFilter` | - | R | LD | |
| PUT | `{net}/business_guest_network`, `{net}/captive_portal/*`, `{net}/network_customer_type`, `{net}/holding_state`, `{net}/community`, `{net}/cobranding` | various | W | LD | eero for Business only. Skip. |

## 5. eero nodes

| Method | Path | Body / params | Returns | Kind | Clients | Notes |
|---|---|---|---|---|---|---|
| GET | `{net}/eeros` (`resources.eeros`) | - | `[eero]` (see [data-model.md](data-model.md)): `url, serial, location, model, model_number, gateway, is_primary_node, status (green/yellow/red), state (ONLINE...), os_version, update_available, update_status, ip_address, mac_address, ethernet_addresses, wifi_bssids, bands, bssids_with_bands, mesh_quality_bars, wired, connection_type, using_wan, connected_clients_count, connected_wired_clients_count, connected_wireless_clients_count, led_on, led_brightness, nightlight, last_reboot, uptime{since_last_reboot_s}, heartbeat_ok, last_heartbeat, ethernet_status{statuses[]}, radio_channel_stats{band:{channel,channel_width,tx_power,channel_utilization,client_count}}, power_info, wireless_upstream_node, resources{led_action,reboot,connections,...}` | R | all | Also embedded in network object `eeros.data`. |
| GET | `{eero}` | - | single eero | R | FF, LD, EH | |
| PUT | `{eero}` | form `location` | eero | W | FF, EH | Rename node's room label. |
| PUT | `resources.led_action` (normally `/2.2/eeros/{id}/led`) | **form** `led_on=true|false` or `led_brightness=0..100` | - | W | SX (JSON), FF (form, live-verified), LD (form) | FF found a JSON PUT to `{eero}` with `{led_on}` silently does nothing; use the `led_action` link. |
| POST | `/2.2/eeros/{serial}/led_cycle` | form `colors[]=blue&colors[]=white&duration=30&time_per_color=1` (colors: blue, green, white, off) | - | W | FF, LD | "Find this eero": flashes the LED. Harmless, nice UX. |
| GET | `{nightlight.url}` (normally `{eero}/nightlight/settings`) | - | `{enabled, brightness_percentage, schedule{enabled,on,off}}` | R | FF | Beacon only. |
| PUT | `{eero}/nightlight/settings` | JSON `{enabled, brightness_percentage 0-100, schedule{enabled, on:"20:00", off:"07:00"}}` | - | W | SX, FF, LD | Beacon only. SX modes: disabled / ambient (`schedule.enabled=false`) / schedule. |
| POST | `/2.2/eeros/{id}/nightlight/override` | form `brightness_percentage` | - | W | FF, LD | Brief preview, not saved. |
| POST | `resources.reboot` (normally `{eero}/reboot`) | empty-JSON / none | - (HTTP 201) | **D** | SX, FF, LD, MX, ES, EH, DC, ED | Reboots one node. FF verified only that node restarts. Rebooting the gateway takes the network down. |
| GET | `resources.connections` (normally `{eero}/connections`) | - | `{ports:{layout, interfaces:[{interface_number, name, port_status, negotiated_speed (P1000, P2500...), supported_speed, network_type, poe_status, ethernet_address, actions[{type}]}]}, node_actions[{type}], wireless_devices[{type, metadata{display_name, device_type}}], provide_device_power}` | R | FF, LD | Ethernet port map and what is attached. Great for a node detail view. Real shape (2026-11-13): `port_status` `DATA_CONNECTED`/`WAN`, `network_type` `UNKNOWN`, `is_upstream`, and attachments under `connection_status`; see the Connections table in [data-model.md](data-model.md). |
| POST | `{eero}/ports/{interface_number}/action` | JSON `{action: ENABLE_PORT|DISABLE_PORT|ENABLE_DATA|DISABLE_DATA|ENABLE_POE|DISABLE_POE|RESTART_POWER|ENABLE_PORT_SECURITY|DISABLE_PORT_SECURITY}` | - | **D** | FF, LD | Only offer actions listed in that port's `actions[]`. Can cut power/data to wired gear. |
| POST | `{eero}/action` | JSON `{action: "POWER_CYCLE_ALL_PORTS" | "POWER_CYCLE_ALL_PORTS_AND_REBOOT"}` | - | **D** | FF, LD | Only if listed in `node_actions`. |
| GET | `/2.2/eeros/{id}/firmware_update/history?limit=20&offset=0` | - | `{data: [{id, timestamp, firmware_version, previous_version, status, update_type, duration_seconds, outcome, update_status, failure_reason, finished_at}], meta: {has_more}}` | R | LD | Per-node firmware history, newest first (real capture, 2026-11-13: 50 rows with `has_more`; `status` `completed`, `outcome` `Success`, `update_type` `manual` or `automatic`). `firmware_version` is the eero's `os_version` plus a `+build` tail. Mesh UI drops the tail and failed rows and still sorts. |
| GET | `{eero}/support` | - | support diagnostics | R | FF | 404 on some nodes. |
| GET | `/2.2/eeros/{id}/authorization_status?network_id=`, `/2.2/eeros/{serial}/license_expiration?network=`, `/2.2/eeros/{serial}/pre_setup_config` | - | misc | R | LD | ISP-provisioned eeros. |
| POST / GET | `/2.3/networks/{id}/placement_test/{serial}` | POST none | placement results | R/W | LD | Node placement quality test. Version 2.3 only. |
| POST | `/2.3/networks/{id}/placement_rating/{serial}` | JSON `{rssi?, mcs?, freq?}` | rating | R-ish | LD | |
| GET | `/2.4/networks/{id}/placement/wifi_coverage_scan?allDevices=true` | - | coverage scan | R | LD | Version 2.4 only. |
| GET | `/2.4/networks/{id}/placement/wifi_generation_scan?allDevices=true` | - | "upgrade report" | R | LD | Version 2.4 only. |
| DELETE | `{eero}` | none | - | **D** | LD | **Removes the node from the network** (factory-reset-like). Removing the gateway kills the network. |
| POST | `/2.2/eeros?requireSession=true`, `{net}/node_setup`, `/2.2/eeros/networks/{id}/notify_swap`, `{net}/auto_discovered_eeros`, `{net}/auto_setup_mode`, `/2.3/networks/{id}/pending_eeros`, `{net}/packaged_eeros`, `/2.3/networks` (create network) | various | - | W | LD | Onboarding / add-a-node / create network. Out of scope. |
| GET | `/2.2/eero_models/capabilities?networkId={id}` | - | per-model capability matrix | R | FF, LD | Note camelCase `networkId`. |
| GET | `{net}/ouicheck?serial=&version=` | both required (404 otherwise) | `{can_add, must_update}` | R | FF, LD, ES | Can this eero join the network. |

No factory-reset endpoint was found in any client. Closest are `DELETE {eero}` and `DELETE {net}`.

## 6. Devices (clients)

| Method | Path | Body / params | Returns | Kind | Clients | Notes |
|---|---|---|---|---|---|---|
| GET | `{net}/devices` (`resources.devices`) | optional `?thread=true|false`, `?proxied_node=` | `[device]`: `url, mac, eui64, ip, ips[], ipv4, ipv6_addresses[], nickname, hostname, display_name, manufacturer, model_name, device_type, connected, wireless, connection_type, is_guest, is_private, paused, blocked/blacklisted, last_active, first_active, channel, ssid, subnet_kind, auth, profile{url,name,paused}, source{location, is_gateway, url, serial_number}, interface{frequency, frequency_unit}, connectivity{signal "-45 dBm", signal_avg, score, score_bars 0-5, rx_bitrate, frequency, rx_rate_info{rate_bps,mcs,nss,channel_width,phy_type}, tx_rate_info, snr, packet_stats{...}, ethernet_status}, usage{down_mbps, up_mbps} (live only after a burst), secondary_wan_deny_access, homekit, ring_lte` | R | all | Fields vary by firmware and app version (see User-Agent quirk). |
| GET | `{device}` | - | single device | R | FF, EH | |
| PUT | `/2.3/networks/{id}/devices/{mac}` | JSON `{paused: bool}` | device | W | SX, FF (live-verified), LD (uses `{device}`) | **Pause internet for one device.** FF: the same PUT on `/2.2/` returns 200 but silently does not persist. Use **2.3** for device writes. |
| PUT | `/2.3/networks/{id}/devices/{mac}` | JSON `{nickname: str}` | device | W | FF, LD | Rename device. Use 2.3. |
| PUT | `{device}` | JSON `{profile: {url: <profile url>}}` (FF sends a subset of `mac, nickname, paused, profile`) | device | W | FF, LD, EH | Assign device to a profile. LD offers no "none"; to remove use the profile's `devices` list. |
| PUT | `{net}/devices/{mac}` | JSON `{device_type: "phone"|"laptop_computer"|...}` | device | W | FF (live-verified), LD | Change icon/category. ~45 types (list in [data-model.md](data-model.md)). |
| PUT | `/2.3/networks/{id}/devices/{mac}` | JSON `{secondary_wan_deny_access: bool}` | device | W | SX, FF, LD | Allow device to use backup internet. 2.3 only. |
| PUT | `/2.3/networks/{id}/devices/secondary_wan_config` | JSON `{devices:[{mac, secondary_wan_deny_access}]}` | - | W | FF, LD | Bulk version. |
| GET | `{device}/labels` | - | `{make_label, model_label, version_label, type_label}` | R | FF | |
| PUT | `{device}/labels` | query params `make_label`, `model_label`, ... | - | W (no-op) | FF | FF verified this is currently a no-op. |
| GET | `{net}/blacklist` (`resources.device_blacklist`) | - | `[device]` blocked devices | R | FF, LD, ES | |
| POST | `{net}/blacklist` | **form** `mac=aa:bb:...` | - | W | FF (live-verified), LD | **Block device** (kicks it off Wi-Fi permanently). |
| DELETE | `{net}/blacklist/{mac}` | - | - | W | FF, LD | Unblock. MAC with or without colons accepted. |
| POST | `{net}/burst_reporters` | empty-JSON | `{next_burst: "<timestamp>"}` | W (benign) | FF, ES | **Requests live throughput.** ~12 s later `devices[].usage.down_mbps/up_mbps` are fresh. Max one per minute per network. Ideal for a "live bandwidth" view. |
| GET | `{net}/transfer` and `{net}/devices/{mac}/transfer` | - | transfer stats | R | FF | Note `{net}/transfer` is also the ownership-transfer resource in LD; FF treats it as stats. Ambiguous, verify before use. |
| GET | `{device}/activity`, `{net}/activity` | - | `{insights[], counts{blocked,allowed,inspected}}` | R? | EH only | Not corroborated by any other client. Treat as unverified; prefer `insights`. |
| GET | `{net}/data_usage/devices/{mac}` | `start, end, cadence` | usage series | R | FF, LD | See section 9. |
| GET | `{net}/insights/devices/{mac}` | `start, end, cadence, insight_type` | security series | R $ | FF, LD | See section 9. |

## 7. Profiles (people) and schedules

| Method | Path | Body / params | Returns | Kind | Clients | Notes |
|---|---|---|---|---|---|---|
| GET | `{net}/profiles` (`resources.profiles`) | - | `[profile]`: `url, name, paused, default, devices[{url, mac, nickname, connected,...}], schedule[{url?, name, days, start, end, enabled}], state{value, schedule}, premium_dns{blocked_applications[], dns_policies{...}, ad_block_settings{enabled}, advanced_content_filters{blocked_list,allowed_list}}, unified_content_filters{is_content_filters_set, dns_policies{...}}, resources{schedules}` | R | all | |
| GET | `{profile}` | - | profile | R | FF, LD, EH | |
| POST | `{net}/profiles` | JSON `{name, paused: false, devices: [{url}...]}` | profile | W | FF, LD | Create. |
| PUT | `{profile}` | JSON `{paused: bool}` | profile | W | SX, FF, LD | **Pause/resume every device in the profile.** |
| PUT | `{profile}` | JSON `{name}` | profile | W | FF, LD | Rename. |
| PUT | `{profile}` | JSON `{devices: [{url: <device url>}, ...]}` | profile | W | FF, LD | **Replaces** full membership list. |
| DELETE | `{profile}` | - | - | **D** | FF, LD | Devices become unassigned. |
| GET | `{profile}/schedules` (`resources.schedules`) | - | `[schedule]` | R | FF, LD | **404 on a real network (2026-11-13)** although `resources.schedules` names it: schedules come only from the profile's own `schedule[]`. |
| POST | `{profile}/schedules` | JSON `{name, days: ["MON","TUE",...] (LD) or lowercase names (FF), start: "22:00", end: "07:00", enabled: true}` | schedule | W | FF, LD | Scheduled pause ("Bedtime"). End before start wraps past midnight. Network timezone. |
| PUT / DELETE | `{schedule url}` | same fields | - | W | FF, LD | |
| PUT | `{profile}` | JSON `{schedule: ...}`, `{dns_policies: ...}`, `{blocked_applications: ...}` | - | (no-op) | EH | FF verified writing filters/schedules onto the profile object does nothing. Use `dns_policies` and `schedules` endpoints. |

## 8. eero Plus / Secure: DNS filtering, ad block, app blocking (out of scope)

All **$** (premium) and out of scope for Mesh UI, except `entitlements`, which is a free read Mesh UI may use to confirm a feature is free before showing it. Current state is mirrored in network `premium_dns` and profile `premium_dns` / `unified_content_filters`.

| Method | Path | Body | Kind | Clients | Notes |
|---|---|---|---|---|---|
| GET | `{net}/dns_policies/network` | - | R $ | LD | `{dns_policies{block_malware, ad_block, ...}, ad_block_settings{enabled, profiles[]}}` |
| POST | `{net}/dns_policies/network` | `{block_malware: bool}` and other keys below (JSON in SX/FF, form in LD) | W $ | SX, FF, LD | Network-wide threat blocking and content filters. |
| POST | `{net}/dns_policies/adblock` | JSON `{enable: bool, profiles?: [profile urls or ids]}` | W $ | SX, FF, LD | Ad block. `profiles` **replaces** the list; empty list + enable = network-wide. |
| GET | `{net}/dns_policies/profiles/{profile_id}` | - | R $ | LD | Per-profile filter state. |
| POST | `{net}/dns_policies/profiles/{profile_id}` | keys: `block_pornographic_content, block_illegal_content, block_violent_content, block_gaming_content, block_messaging_content, block_shopping_content, block_social_content, block_streaming_content, safe_search_enabled, youtube_restricted, block_malware, ad_block` (send only changed) | W $ | SX (JSON), LD (form) | Per-profile content filters. |
| POST | `{net}/dns_policies/profiles/{profile_id}/adblock` | JSON `{enable}` | W $ | LD | |
| GET | `{net}/dns_policies/profiles/{profile_id}/applications` | - | R $ | FF, LD | `{applications:[{name, display_name, is_blocked, categories[]}], categories_list:[{id,title}]}` |
| PUT | `{net}/dns_policies/profiles/{profile_id}/applications/blocked` | JSON `{applications: ["tiktok", ...]}` | W $ | SX, FF, LD | Replaces whole blocked-apps set. |
| GET | `{net}/dns_policies/advanced_content_filter` | - | R $ | FF, LD | `{blocked_list[], allowed_list[]}` |
| PUT | `{net}/dns_policies/network/blocked` | JSON `{domain, is_delete?: bool}` | W $ | FF, LD | Block a domain network-wide; `is_delete: true` removes (no DELETE verb). |
| PUT | `{net}/dns_policies/network/allowed` | JSON `{domain, is_delete?}` | W $ | FF, LD | Allow-list a domain. |
| PUT | `{net}/dns_policies/profiles/blocked` / `.../allowed` | JSON `{domain, profiles: [ids], is_delete?, override?}` | W $ | FF, LD | Per-profile domain rules. |
| PUT | `{net}/dns_policies/network/allowed/cnames`, `{net}/dns_policies/profiles/allowed/cnames` | JSON `{domains: [...], profiles?: [...]}` | W $ | FF, LD | CNAME allow list, replaces. |
| GET | `/2.2/entitlements/networks/{id}/features` | - | R | FF, LD | `{entitlements[{display_name "Eero Plus", state, source, renewal_info}], features{ad_blocking, block_apps, content_filter, dynamic_dns, internet_backup, historical_data_usage, channel_utilization, guardian_vpn, identity_protection, ...: {capability, actions}}}`. Best source for "which Plus features to show". |
| GET | `/2.2/entitlements/networks/{id}/upsell_features` | - | R | FF, LD | |
| GET | `/2.4/premium/plans/{id}`, `/2.2/partners/*`, `/2.2/license_keys`, `/2.2/subscription_referrals` | - | R/W | LD | Billing/partner offers. Skip. |
| various | `/2.2/partners/guardian/...` + Guardian hosts | - | W $ | LD | Guardian VPN. Skip. |

## 9. Activity, usage and insights (history charts)

All are GET with **query parameters only** (FF: a GET with a JSON body is rejected with 400; SX sends `json=` on GET and apparently works via requests, but use query params). Params: `start`, `end` (ISO-8601 UTC, e.g. `2026-11-05T00:00:00Z`), `cadence` = `hourly` | `daily`, optional `timezone` (IANA), and for insights `insight_type` = `blocked` | `inspected` | `adblock`.

Response shape (charts): `{network_id, start, end, series: [{type | insight_type, sum, values: [{time, value}]}]}`. Data usage series types are `download` / `upload` with byte values. SX reads `insights`, `series` or `values` depending on endpoint.

| Method | Path | Params | Kind | Clients | Notes |
|---|---|---|---|---|---|
| GET | `{net}/data_usage` | `start,end,cadence` (all required), `timezone?` | R | SX, FF, LD, YV | Network up/down bytes over time. |
| GET | `{net}/data_usage/breakdown` | `start,end` | R | FF, LD | Usage per device and profile ("who used the most"). Real shape (2026-11-13): `{start, end, upload, download, eeros: [{id, model_number, serial, location, url, upload, download}], devices: [device row], unprofiled: [device row], profiles: [{profile_id: number, profile_name, upload, download}]}`. Device rows: `{url, mac, nickname, hostname, display_name, manufacturer, device_type, connection_type, inferred_make, inferred_model, model_name, is_private, is_proxied_node, amazon_device_type_id, upload, download}`. Profile rows have no `url`, `id` or `name`; eero's default (Unassigned) profile has no row. |
| GET | `{net}/data_usage/devices` | `start,end,cadence` | R | SX, FF, ED, YV | Per-device totals. |
| GET | `{net}/data_usage/devices/{mac}` | `start,end,cadence` | R | SX, FF, LD | One device. |
| GET | `{net}/data_usage/eeros`, `/eeros/summary`, `/eeros/{eero_id}` | `start,end,cadence` | R | FF, LD | Per node. |
| GET | `{net}/data_usage/profiles` (SX) and `/profiles/{profile_id}` | `start,end,cadence` | R | SX, FF, LD | Per profile. |
| GET | `{net}/data_usage/unprofiled/devices`, `/unprofiled/summary` | `start,end[,cadence]` | R | FF, LD | Devices not in any profile. |
| GET / PUT | `{net}/data_usage/report_settings` | PUT JSON `{cadence: "weekly"|"monthly", notification_day: 1|31}` | R/W | FF, LD | Usage report emails. |
| GET | `{net}/insights` | `start,end,cadence,insight_type` | R $ | SX, FF, LD | Security activity (threats blocked, ads blocked, sites inspected). |
| GET | `{net}/insights/devices`, `/insights/devices/{mac}` | same | R $ | SX, FF, LD | `{insight_type, insights:[{nickname, hostname, manufacturer, device_type, sum, insights_url}]}` |
| GET | `{net}/insights/profiles`, `/insights/profiles/{id}`, `/insights/profiles/{id}/devices` | same | R $ | SX, FF, LD | |
| GET | `{net}/app_events` | `page_size=50`, `timestamp?` (paging cursor) | R | FF, LD | Network event log (`message/title, event_type, created`). Real shape (2026-11-13) differs: `{events: [{hash, timestamp_ms, description, category}]}`, no `event_type`, `title` or `created`. |
| GET | `{net}/notifications_history` | `limit=50`, `timestamp?` | R | FF, LD | Recent notifications `{uuid, title, body}`. LD polls this once a minute for desktop alerts. Real shape (2026-11-13): `{notifications: [{uuid, category, title, body, created_at, meta{device_url?, network_url}}]}`; no read flag per row. |
| GET | `{net}/channel_utilization` | `start,end` required; `eero_id?, band?, granularity?, busy_threshold?, gap_data_placeholder?` | R $ | FF, LD | `{utilization:[{eero_id, channel, band, frequency, channel_bandwidth, average_utilization, max_utilization, p99_utilization, minutes_over_busy_threshold, acs_events[], time_series_data[]}], bands[], eeros[{eero_id, role, location, wired}]}` |
| GET | `{net}/network_scan` | - | R | FF, LD | Neighbour/channel scan, e.g. `{conflicting_ssid: false}`. |

## 10. Speed tests, diagnostics, health

| Method | Path | Body / params | Returns | Kind | Clients | Notes |
|---|---|---|---|---|---|---|
| GET | `{net}/speedtest` (`resources.speedtest`) | `limit?`, `startTime?`, `endTime?` (camelCase) | `[{date, down_mbps, up_mbps}]` | R | FF, LD, ES, EH | History. Latest also in network `speed{status, date, down{value,units}, up{value,units}}`. |
| POST | `{net}/speedtest` | empty-JSON / none | `null` (HTTP 202) | W | SX, FF, LD, ES, EH | Result appears ~1 min later. Uses WAN bandwidth for ~30 s. |
| GET | `{net}/diagnostics` | - | `{status, issue_area, results[...]}` | R | FF, LD, ES, EH | Real (2026-11-13), no run yet: only `{status: string}`. |
| POST | `{net}/diagnostics` | none, or JSON `{symptom: "internet_slow"|"internet_offline"|"connection_drops"|"eeros_red", device?}` | - | W | FF, LD, EH | Runs cloud diagnostics. |
| POST | `{net}/dns_perf_test` | JSON `{servers: [{ip, port: 53}]}` (1-8) | `{action_uuid}` | W | LD | Compare resolver latency. |
| GET | `{net}/dns_perf_test/{action_uuid}` | - | results | R | LD | |
| GET | `{net}/support` | - | 2.2: `{support_phone, contact_url, help_url, email_web_form_url, name}`; 2.3: `{contacts:[...]}` | R | FF, ES | ISP/eero support info. FF pins to 2.2. |
| POST | `{net}/support` | JSON | - | W | FF | Request support. |
| POST | `/2.2/zendesk/create` | multipart | - | W | LD | Report an issue. |
| GET | `{net}/routing` | - | `{devices{url,data[]}, reservations{url,data[]}, forwards{url,data[]}, pinholes{url,data[]}}` | R | FF, LD, ES | One call for all reservations, forwards and IPv6 pinholes. FF pins to 2.2. |

## 11. Guest network and extra SSIDs

| Method | Path | Body | Kind | Clients | Notes |
|---|---|---|---|---|---|
| GET | `{net}/guestnetwork` (`resources.guestnetwork`) | - | R | FF, LD, ES, EH, DC | `{url, name, enabled, password, resources{password}}`. Also in network object `guest_network`. |
| PUT | `{net}/guestnetwork` | **form** `enabled=true|false` and optional `name` (SX sends JSON `{enabled}`) | W | SX, FF (live-verified), LD, EH, DC | Toggling disconnects guest clients. |
| GET | `{net}/guestnetwork/password` | - | R | LD | string or `{password}` |
| PUT | `{net}/guestnetwork/password` | form `password` | W | FF (live-verified), LD | |
| DELETE | `{net}/guestnetwork/password` | - | W | FF | Makes guest network open. |
| GET | `{net}/subnets_config` | - | R | FF, LD | Additional SSIDs (IoT, Kids, Business, Guest): `[{subnet_id, subnet_type main|A|B, subnet_kind, name, password, enabled, open_network, wan_access, lan_access, rate_limit_pct, vlan, dedicated_subnet{subnet_ip,start_ip,end_ip,subnet_mask}}]` |
| PUT | `{net}/subnets_config` | JSON `{name, enabled, open_network, wan_access, rate_limit_pct, password?, network_id, subnet_type, subnet_kind, subnet_id?, dedicated_subnet?}` | W **D** | FF, LD | Settings-class write, may restart. |
| DELETE | `{net}/subnets_config/{subnet_type}` | - | **D** | FF, LD | Only `A` / `B`. |
| GET | `{net}/subnets_config/{subnet_id}/dns_policies/content_filters` | - | R $ | FF, LD | |
| PUT | `{net}/subnets_config/dns_policies/content_filters` | JSON `{content_filters, subnets}` | W $ | FF, LD | |

## 12. Reservations, port forwards, IPv6 pinholes

| Method | Path | Body | Kind | Clients | Notes |
|---|---|---|---|---|---|
| GET | `{net}/reservations` | - | R | FF, ES, DC, ED | `[{url, description, mac, ip, public_static_ip}]` (also in `routing`) |
| POST | `{net}/reservations` | JSON `{description, mac, ip}` | W | FF, LD, DC | `error.reservation.ip.invalid`, `error.assignment.ip.unavailable` |
| PUT | `{reservation url}` | same | W | FF, LD | |
| DELETE | `{reservation url}?delete_forwards=true|false` | - | W | FF, LD, DC | `delete_forwards=true` also removes that IP's forwards. |
| GET | `{net}/forwards` | - | R | FF, ES, EH | `[{url, description, ip, gateway_port, client_port, protocol tcp|udp|both, enabled}]` |
| POST | `{net}/forwards` | JSON `{ip, gateway_port: "8000" or "8000-8010", client_port, protocol, description, enabled}` | W | FF, LD, EH | Range support gated by capability `port_forward_range`. Device needs a reservation first. |
| PUT / DELETE | `{forward url}` | same | W | FF, LD, EH | |
| POST | `{net}/ipv6/pinholes` | JSON `{device: <device url>, protocol, port: "N" or "N-M"}` | W | LD | IPv6 firewall allow rule. |
| PUT / DELETE | `{pinhole url}` | same | W | LD | |

## 13. Firmware updates

| Method | Path | Body | Kind | Clients | Notes |
|---|---|---|---|---|---|
| GET | `{net}/updates` (`resources.updates`) | - | R | FF, LD, ES, ED | `{has_update, update_required, can_update_now, target_firmware, update_to_firmware, min_required_firmware, update_status, scheduled_update_time, preferred_update_hour, last_update_started, last_user_update{unresponsive_eeros[], incomplete_eeros[]}, manifest_resource}`. Also embedded in network `updates`. |
| GET | `updates.manifest_resource` | - | R | SX | Absolute URL (not api-user host) with release notes JSON (`target{...}`, firmware `title, os_version, release_date, features`). Fetch without the session cookie. |
| POST | `{net}/updates` | empty-JSON | **D** | SX, FF, LD | **Installs firmware now; every node reboots.** Only when `can_update_now`. |
| POST | `{net}/updates/preferred_update_hour` | JSON `{preferred_update_hour: 0..23}` | W | SX, FF, LD | Auto-update window. |

## 14. Backup internet and multi-WAN

Backup internet (`$` rows) is eero Plus and out of scope. Multi-WAN and multi static IP are advanced ISP features with no Mesh UI command today.

| Method | Path | Body | Kind | Clients | Notes |
|---|---|---|---|---|---|
| GET / PUT | `{net}/backupinternet` | PUT JSON `{backup_internet_enabled: bool}` | R/W $ | SX, FF, LD | Also network `backup_internet_enabled`. |
| GET | `{net}/backup_access_points` | - | R $ | SX, FF, LD | `[{uuid, ssid, password, enabled, created, last_updated_at, connectivity{status success|failure, failure_reason, checked}}]`. SX only calls when `capabilities.backup_access_point` is capable and premium active. |
| POST | `{net}/backup_access_points` | JSON `{ssid, password, uuid: <client-generated>}` | W $ | FF, LD | Add backup Wi-Fi (e.g. phone hotspot). |
| PUT / DELETE | `{net}/backup_access_points/{uuid}` | JSON `{ssid, uuid, enabled, password?}` | W $ | SX, FF, LD | SX "auto join" toggle PUTs `{enabled, ssid, password}`. |
| POST | `{net}/backup_access_points/rearrange` | JSON `{rearranged_ids: [uuid...]}` | W $ | FF, LD | |
| POST / GET | `{net}/backup_access_points/ssid_discovery` | - | R/W $ | FF, LD | Scan for nearby SSIDs `{status, discovered_ssids[{ssid, rssi}]}`. |
| POST | `{net}/backup_access_points/connectivity_check` | none | W $ | SX, FF, LD | Test backup connection. |
| GET | `{net}/cellular_backup_usage`, `{net}/cellular_backup_events` | - | R | FF, LD | Ring/LTE backup. |
| GET | `{net}/wan/links`, `/wan/links/{link_id}`, `/wan/discover`, `/wan/limits` | - | R | LD | Multi-WAN `{wan_mode, links[{link_id, name, priority, connection_type, metadata}]}` |
| PUT | `{net}/wan/enable_multi_wan` | JSON `{wan_mode: MULTI_WAN_AUTOMATIC|MULTI_WAN_STRICT|MULTI_WAN_LEGACY}` | **D** | LD | |
| POST / PUT / DELETE | `{net}/wan/links[/{link_id}]` | see LD | **D** | LD | |
| GET / PUT | `/2.3/networks/{id}/multistaticip` | JSON `{enabled, type: PublicLAN|NATWithPortFwd, multistaticip_settings{...}, multistaticip_settings_nat_portfwd{...}}` | R/W **D** | FF, LD | 2.3 only. 404 `error.network.multistaticip_not_found` if unsupported. |

## 15. Notifications

| Method | Path | Body | Kind | Clients | Notes |
|---|---|---|---|---|---|
| GET | `{net}/notifications` | - | R | FF, LD | Map of event key to bool: `device.new, device.restrict.new.private, network.updated, network.dataUsageReport, network.scheduledUpdate.earlyNotification, network.scheduledUpdate.lateNotification, premium.activity.weeklyReport, permissions.updates, backup.internet.status.change, port.security.blocked` (keys contain dots). |
| PUT | `{net}/notifications` | JSON: send the whole map with the changed key | W | FF, LD | |
| GET | `{net}/notifications/has_unread` | - | R | FF, LD | `{has_unread: bool}` or bare bool |
| POST | `{net}/notifications/mark_read` | empty-JSON | W | FF, LD | |
| GET | `{net}/notifications_history` | `limit`, `timestamp` | R | FF, LD | (also listed in section 9) |
| PUT | `/2.2/account/push_settings` | JSON `{networkOffline, nodeOffline}` | W | FF, LD | Account-level push. |

## 16. Smart home and integrations (not planned)

| Method | Path | Kind | Clients | Notes |
|---|---|---|---|---|
| GET / PUT | `{net}/simple_setup/vendors[/{vendor_id}]` (form `enabled`) | R/W | LD | Connected-device setup vendors. |
| POST | `/2.2/amazon/networks/{id}/account_unlink` | **D** | LD | Unlink Amazon account. |
| POST | `/2.3/networks/{id}/shh/start_zigbee_discovery` | W | LD | Amazon smart home hub. |
| GET / DELETE | `{net}/accessories/setup/status`, `{net}/accessories/{serial}`, `{net}/sip_config_associations/{eero_id}` | R/W | LD | Accessories / cellular. |
| GET / POST / PUT | `/2.2/conversations*` | R/W | LD | eero AI assistant chat (streaming). |

## 17. Real captures for M3 (2026-11-13)

One read-only `GET` of each endpoint on the maintainer's network (owner, one
network, app-like User-Agent), recorded as key paths and types
only: no values were printed or kept. `[]` is an array element, `?` a field
seen only on some rows, `a or b` a field seen with both types. Shapes of empty
lists are not known from the capture; their element fields come from the
clients and are marked so in `src/core/eero/raw.ts`.

| Endpoint | Result | Key paths and types |
|---|---|---|
| `{net}` (settings fields) | 200 | `password`: string; `dns{mode: string, parent{ips: string[]}, custom: null, caching: bool, default_test_servers[]{name, ipv4[], ipv6[]}}`; `dhcp{mode: string, custom: null, custom_v2: null}`; `lease{mode, dhcp{ip, mask, router}, static: null}`; `connection{mode}`; `upnp`, `nat_port_randomization`, `ipv6_upstream`, `thread`, `sqm`, `band_steering`, `wpa3`, `power_saving`, `power_saving_schedule_enabled`, `enable_ndproxy`, `backup_internet_enabled`, `amazon_account_linked`, `ffs`, `alexa_skill`, `amazon_device_nickname`: bool; `wireless_mode`, `mlo_mode`, `auto_setup_mode`, `wan_type`, `network_customer_type`: string; `ipv6{name_servers{mode: string, custom: []}}`; `ipv6_lease`, `pppoe_username`, `pppoe_enabled`, `vlan`, `homekit`, `ipip6`, `cellular_backup`: null; `temporary_flags`: object (empty); `guest_network{url, name, password: string, enabled: bool, resources{password}}`; `proxied_nodes{enabled: bool, devices[]{url, client_device_url, mac_address, ip_address, display_name, model_name, manufacturer, status, enabled, is_meshing, is_guest, blocked, paused, serial, os, os_version, first_seen, first_active, connection{...}, profile{url, name}, warnings?, alert_info?}}`; `ddns{enabled: bool, subdomain: string}` ($); `timezone{value, geo_ip}` |
| `{net}/guestnetwork` | 200 | `url`, `name`, `password`: string; `enabled`: bool; `resources{password: string}` |
| `{net}/wpa3_per_band` | 200 | `band_2_4_ghz`, `band_5_ghz`: string (no 6 GHz key) |
| `{net}/fast_transition` | 200 | `fast_transition`: bool |
| `{net}/power_saving/schedules` | 200 | `schedules`: array (empty) |
| `{net}/power_saving` | 404 | (read from the network's `power_saving` fields) |
| `{net}/thread` | 200 | `url`, `name`, `xpan_id`, `pan_id`, `master_key`, `commissioning_credential`: string; `enabled`, `enable_credential_syncing`: bool; `channel`: number; `border_agent{ip: string, port: number}`. Two secrets; no dataset |
| `{net}/ac_compat` | 200 | `enabled`: bool |
| `{net}/routing` | 200 | `url`; `devices{url, data[]{url, mac, nickname: string or null}}`; `reservations{url, data[]{url, device, mac, description, ip}}`; `forwards{url, data[]{url, ip, description, gateway_port: string, client_port: string, protocol, enabled: bool, reservation}}`; `pinholes{url, data: []}` (empty) |
| `{net}/profiles` | 200 | array: `url`, `name`, `paused`, `default`, `resources{schedules}`, `devices[]` (device rows), `schedule`: [] (empty), `state{value: string, schedule: null}`, `proxied_nodes[]`, `premium_dns{...}` ($), `unified_content_filters{...}` ($) |
| `{profile}` | 200 | same object as one `{net}/profiles` row |
| `{profile}/schedules` | 404 | |
| `{net}/app_events` | 200 | `events[]{hash: string, timestamp_ms: number, description: string, category: string}` |
| `{net}/notifications_history` | 200 | `notifications[]{uuid, category, title, body, created_at: string, meta{device_url?: string, network_url: string}}` |
| `{net}/notifications` | 200 | flat map, keys with dots, all bool: `device.new`, `device.restrict.new.private`, `network.updated`, `network.dataUsageReport`, `permissions.updates`, `port.security.blocked`, `network.scheduledUpdate.earlyNotification`, `network.scheduledUpdate.lateNotification`, `premium.activity.weeklyReport` ($), `backup.internet.status.change` ($), `backup.wan.change` ($) |
| `{net}/diagnostics` | 200 | `status`: string |
| `{net}/support` | 200 | `support_phone`, `contact_url`, `help_url`, `email_web_form_url`, `name`: string |
| `{net}/members` | 200 | `members[]{user_id: number, user_role: string, user_name: string, user_tags: string[]}` |
| `{net}/invites` | 200 | bare array (empty) |
| `{net}/proxied_nodes` | 404 | (state is the network's embedded `proxied_nodes`) |
| `{net}/guestnetwork/devices` | 404 | (guests are devices with `is_guest`) |

## 18. Real captures for M4 (2026-11-13)

Before the M4 writes, one read-only `GET` of each object they change, on the
same network, recorded the same way (key paths and types, no values; `xN`
counts are left out). No write was sent: each write's request comes from the
rows above and the clients, and its real behaviour is a `MANUAL:` line in its
story.

| Endpoint | Result | Key paths and types | What it settles |
|---|---|---|---|
| `{net}/devices` | 200 | per row: `url`, `device_type`: string; `nickname`, `display_name`: string or null; `paused`, `is_guest`: bool; `blacklisted`: bool or null; `profile{url, name: string, paused: bool}` on **every** row; `source{location, is_gateway, model, display_name, serial_number, is_proxied_node, url}` | No device has `profile: null`: "no profile" is the `default: true` profile, so `device.setProfile(null)` sends that profile's url (M4.4) |
| `{net}/profiles` | 200 | per row: `url`, `name`: string; `paused`, `default`: bool; `resources{schedules: string}`; `devices[]`; `schedule`: array (empty on every row); `state{value: string, schedule: null}`; `proxied_nodes[]` | The default profile is a row like the others, so Unassigned pause is `PUT {default profile} {paused}` (M4.5). `schedule[]` is empty here, so the schedule row shape and day form still come from the clients (M4.12) |
| `{net}/guestnetwork` | 200 | `url`, `name`, `password`: string; `enabled`: bool; `resources{password: string}` | Unchanged since M3; the password has its own link (M4.6) |
| `{net}` (Wi-Fi fields) | 200 | `name`, `password`, `wireless_mode`: string; `wpa3`, `band_steering`: bool; `temporary_flags`: object with no keys while 2.4 GHz only is off; `guest_network{url, name, password, enabled, resources}`; `resources{password, guestnetwork, speedtest, reboot, eeros, devices, device_blacklist, profiles, settings, ...}`; no `hide_5g` key anywhere | `resources.password` and `resources.reboot` are published; the `hide_5g` shape while on is still from the clients (M4.7) |
| `{net}/wpa3_per_band` | 200 | `band_2_4_ghz`, `band_5_ghz`: string; no 6 GHz key | Unchanged since M3 (M4.7) |
| `{net}/eeros` | 200 | per row: `url`, `location`, `model`, `compact_model`: string; `led_on`: bool; `led_brightness`: number; `nightlight`: null on every row; `resources{led_action, reboot, connections}`: string | LED writes go to `resources.led_action`, restarts to `resources.reboot`; no `led_cycle` link is published, so find uses `/2.2/eeros/{id}/led_cycle`; the nightlight shape is from the clients (M4.8) |
| `{net}/speedtest` | 200 | array of `{date: string, down_mbps: number, up_mbps: number}` | History shape for after `POST {net}/speedtest` (M4.9) |
| `{net}/blacklist` | 200 | array (empty) | Block and unblock round-trips are fake-server only (M4.4) |

---

## API versions

- **2.2** is the default for nearly everything and is what `account`/`network` URLs come back as.
- **2.3** is required for: device writes (pause, nickname; 2.2 accepts and returns 200 but drops the change, FF issue #102), `secondary_wan_*`, `multistaticip`, `placement_test` / `placement_rating`, `pending_eeros`, creating networks, zigbee discovery.
- **2.4**: `placement/wifi_coverage_scan`, `placement/wifi_generation_scan`, `premium/plans`.
- With a current mobile User-Agent the network `resources` map publishes `forwards`, `routing` and `support` on 2.3. `forwards` and `routing` have the same shape on both. `support` differs (2.3 returns `contacts[]`). FF pins those three to 2.2.

## Destructive / disruptive operations (confirm in UI)

Reboots or outages: `POST {net}/reboot` (whole mesh), `POST {eero}/reboot`, `POST {eero}/action` (`POWER_CYCLE_ALL_PORTS_AND_REBOOT`), `POST {eero}/ports/{n}/action`, `POST {net}/updates` (install firmware), **any `PUT {net}/settings`** (DNS and DHCP confirmed to reboot the mesh for ~8 min), `PUT {net}/dns`, `subnets_config` writes, `multistaticip`, multi-WAN writes, `wpa3_per_band`, `mlo_mode`.

Credential changes that drop clients: `PUT/DELETE {net}/password`, guest network toggle/password, `POST {net}/thread` (Thread re-pair), `PUT {net}` / `settings` name change.

Irreversible deletes: `DELETE {net}` (network), `DELETE /2.2/account` (account), `DELETE {eero}` (remove node), `DELETE {profile}`, `DELETE {net}/admins/{id}`, network transfer endpoints, `DELETE {net}/subnets_config/{type}`.

Benign writes safe for one-click UI: speed test, burst reporter, LED on/off/brightness, `led_cycle` (find eero), nightlight, device pause/nickname/type/profile, profile pause/rename, block/unblock device, reservations, port forwards, notifications settings, `hide_5g`, diagnostics.

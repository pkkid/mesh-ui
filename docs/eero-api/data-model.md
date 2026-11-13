# eero cloud API: data model

Field reference for eero API responses, merged from typed models and test
fixtures in open source clients (see
[eero-client.md](../architecture/eero-client.md#prior-art)). Values are
invented examples. Treat every field as optional: shapes vary by firmware,
model, subscription, account role and the User-Agent sent.

This is the **raw eero shape**. Commands never return it; `src/core/model.ts`
maps it into the Mesh UI model, and only the eero client and the mapping code
read these fields. Endpoints are in [endpoints.md](endpoints.md).

**Scope.** Fields and objects that only exist for eero Plus subscribers
(`premium_*`, `ddns`, backup internet, insights, channel utilization, content
filters) are marked *out of scope*. Mesh UI ignores them apart from using
`capabilities` and `entitlements` to hide anything a free account cannot use.

Envelope for every call:

```json
{ "meta": { "code": 200, "server_time": "2026-11-12T18:00:00.000Z", "error": "error.session.refresh" }, "data": { } }
```

Objects link to each other through `url` strings (`/2.2/networks/123`, `/2.2/eeros/456`, `/2.2/networks/123/devices/aabbccddeeff`, `/2.2/networks/123/profiles/789`). IDs are the last path segment. Always store and reuse the `url`; do not assume the path shape (fixtures also show `/2.2/devices/1` style URLs).

---

## Account (`GET /2.2/account`)

| Field | Type | Example | UI use |
|---|---|---|---|
| `name` | str | "Alex Kim" | Header / settings |
| `email.value`, `email.verified` | str, bool | "j***@example.com" | Settings |
| `phone.value`, `.country_code`, `.national_number`, `.verified` | str, bool | "+1555..." | Settings |
| `log_id` | str | "A1B2C3" | Support ID |
| `networks.count`, `networks.data[]` | int, list | `[{url, name, created, nickname_label, access_expires_on, amazon_directed_id}]` | **Network picker** |
| `role` | str | "owner" | Gate admin actions |
| `premium_status` | str | "active", "trialing", "inactive" | Out of scope; read only to explain a missing feature |
| `premium_details` | obj | `{tier: "plus", interval, trial_ends, next_billing_event_date, has_payment_info, is_iap_customer, payment_method}` | Out of scope |
| `push_settings` | obj | `{networkOffline: true, nodeOffline: true}` | Notification settings |
| `consents.marketing_emails.consented` | bool | | |
| `auth` | obj | `{type: "email"|"phone"|"amazon", provider_id, service_id}` | |
| `can_transfer`, `is_premium_capable`, `payment_failed`, `can_migrate_to_amazon_login`, `eero_for_business`, `mdu_program` | bool | | Flags |
| `trust_certificates_etag` | str | | |

## Network (`GET {network_url}`)

The richest object; most dashboard tiles and settings toggles can be driven from this single call.

Identity and status

| Field | Type | Example | UI use |
|---|---|---|---|
| `url` | str | "/2.2/networks/123456" | key |
| `name` | str | "Maple Street" | SSID, title |
| `display_name`, `nickname_label` | str | | Friendly name |
| `password` | str | (secret) | Show/QR code (gate behind reveal) |
| `status` | str | "connected", "online", "offline", "updating" | Status badge |
| `health.internet.status`, `health.internet.isp_up` | str, bool | "connected", true | **Internet health** |
| `health.eero_network.status` | str | "connected" | Mesh health |
| `messages[]` | list | | Banners |
| `owner` | str | | |
| `last_reboot`, `rebooting` | datetime, any | | Uptime |
| `timezone.value`, `timezone.geo_ip` | str | "America/New_York" | Schedules |
| `created` | datetime | | |

Internet / WAN

| Field | Type | Example | UI use |
|---|---|---|---|
| `speed` | obj | `{status, date, down:{value: 940.2, units: "Mbps"}, up:{value: 38.1, units:"Mbps"}}` | **Last speed test tile** |
| `geo_ip` | obj | `{isp, org, asn, city, region, regionName, countryCode, countryName, postalCode, timezone}` | ISP / location card |
| `ip_settings` | obj | `{public_ip: "203.0.113.9", double_nat: false}` | Public IP, double-NAT warning |
| `gateway_ip`, `wan_ip`, `wan_type` | str | "192.0.2.1", "DHCP" | WAN card |
| `connection.mode` | str | "nat", "bridged", "ipPassthrough" | Mode; gates profiles/forwards |
| `lease` | obj | `{mode: "dhcp", dhcp:{ip, mask, router}, static}` | WAN lease |
| `ipv6_lease`, `upstream[]` | any | | |
| `pppoe_enabled`, `pppoe_username`, `vlan` | bool/str | | ISP settings |
| `backup_internet_enabled` | bool | | Out of scope (Plus) |
| `ring_lte` | obj | `{state, subscription_active, apn}` | Out of scope (backup internet) |

LAN and settings toggles

| Field | Type | UI use |
|---|---|---|
| `dhcp` | `{mode: "automatic"|"custom", custom:{subnet_ip, subnet_mask, start_ip, end_ip}}` | LAN settings |
| `dns` | `{mode: "automatic"|"custom", caching: bool, parent:{ips[]}, custom:{ips[]}}` | DNS settings |
| `ipv6` | `{name_servers:{mode, custom[]}}` | IPv6 DNS |
| `upnp`, `ipv6_upstream`, `band_steering`, `wpa3`, `sqm`, `thread`, `ffs`, `power_saving`, `nat_port_randomization` | bool | **Settings switches** |
| `mlo_mode`, `wireless_mode` | str | "disabled", "default" |
| `passpoint`, `proxied_nodes`, `power_saving_schedule_enabled` | bool/obj | |
| `ddns` | `{enabled, subdomain}` | Out of scope (Plus) |
| `guest_network` | `{url, name, password, enabled, resources:{password}}` | **Guest Wi-Fi card** |
| `flags[]` | `[{flag, value}]` | Debug |
| `temporary_flags.hide_5g` | `{value: true, expires_on}` or bool | "Hide 5 GHz" toggle with countdown |

Counts and embedded lists

| Field | Type | UI use |
|---|---|---|
| `eeros.count`, `eeros.data[]` | int, list of eero | Node count; full eero objects inline |
| `clients.count`, `clients.url` | int, str | **Connected device count** |
| `profiles.count`, `profiles.url` | | |

Firmware: `updates` = `{has_update, update_required, can_update_now, target_firmware, update_to_firmware, min_required_firmware, update_status, scheduled_update_time, preferred_update_hour, last_update_started, last_user_update:{last_update_started, unresponsive_eeros[], incomplete_eeros[]}, manifest_resource}`. Drives an "Update available" banner and auto-update hour picker.

Subscription / security (*out of scope*): `premium_status`, `premium_details`, `premium_dns` = `{dns_policies_enabled, any_policies_enabled_for_network, dns_provider, zscaler_location_enabled, dns_policies:{block_malware, ad_block}, ad_block_settings:{enabled, profiles[], business_subnets[]}, advanced_content_filters}`.

Amazon: `amazon_account_linked`, `amazon_directed_id`, `amazon_full_name`, `alexa_skill`, `amazon_device_nickname`, `homekit`.

Business: `network_customer_type` / `network_type`, `organization`, `image_assets`, `access_expires_on`.

`resources` map (string URL or `{url}`): known keys include `devices, eeros, profiles, settings, reboot, speedtest, guestnetwork, password, thread, updates, insights, diagnostics, device_blacklist, forwards, reservations, routing, support, transfer, ac_compat, burst_reporters, members, advanced_content_filter, ddns_enable, ddns_disable, fast_transition, passpoint, proxied_nodes, power_saving, subnets_config, multistaticip, insights_devices, insights_profiles, dns_policies_*`. Use these instead of hard-coded paths when present.

`capabilities` map: `{<name>: {capable: bool, requirements: {<req>: bool}, capable_with_user_remediations?}}`. Known names: `ac_compat, device_blacklist, device_management, diagnostics, led_action, device_usage, thread_network, thread_commissioning, premium, ad_block, ad_block_viewable, adblock_for_profiles, ipv6, ipv6_editable, sqm, band_steering, acs, dns_caching, wpa3, historical_insights, per_device_insights, historical_usage, software_end_of_life, udp_speed_tests, power_saving, unified_content_filters, dnsfilter_allowlist, dnsfilter_blocklist, dnsfilter_threat_categories, ffs, ddns_enabled, allow_block_edit, port_forward_range, vlan, ring_lte, block_apps, block_apps_categories, ownership_transfer, pppoe, backup_access_point, thread_keychain_sharing, ip_passthrough, homekit, smart_home_hub, alexa_skill, proxied_nodes_beta_*, eero_business_*`. **Use this to decide which settings to show.** The set returned depends on the User-Agent version string.

## eero node (`GET {network}/eeros`, `GET {eero_url}`)

| Field | Type | Example | UI use |
|---|---|---|---|
| `url` | str | "/2.2/eeros/456" | key |
| `serial` | str | "GGC1UC..." | Details, `led_cycle` |
| `location` | str | "Living Room" | **Node name** |
| `model`, `model_number` | str | "eero Pro 6E", "K010001" | Product image / label |
| `gateway`, `is_primary_node` | bool | true | Gateway badge |
| `status` | str | "green", "yellow", "red" | **Status dot** |
| `state` | str | "ONLINE" | |
| `heartbeat_ok`, `last_heartbeat` | bool, datetime | | Online check |
| `joined`, `last_reboot` | datetime | | |
| `uptime.since_last_reboot_s`, `uptime.since_cloud_connection_s` | int | 604800 | **Uptime** |
| `os`, `os_version` | str | "6.20.1" | Firmware |
| `update_available` | bool | | Per-node update badge |
| `update_status` | `{support_expired, support_expiration_string, support_expiration_date}` | | End-of-life warning |
| `ip_address`, `ipv6_addresses[{address, scope, interface}]` | | "192.168.4.1" | Details |
| `mac_address`, `ethernet_addresses[]`, `wifi_bssids[]`, `bssids_with_bands[{band, ethernet_address}]` | | | Details |
| `bands[]` | list | "band_2_4GHz", "band_5GHz_low", "band_5GHz_high", "band_6GHz" | Band chips |
| `wired`, `connection_type`, `using_wan` | bool, str | true, "WIRED" | **Backhaul type** |
| `mesh_quality_bars` | int 1-5 | 5 | **Mesh signal bars** (wireless backhaul) |
| `wireless_upstream_node` | obj | | **Topology**: parent node for wireless backhaul |
| `ethernet_status` | `{wiredInternet, segmentId, statuses:[{interfaceNumber, hasCarrier, speed "P1000", isWanPort, isLte, isLeafWiredToUpstream, power_saving, original_speed, derated_reason, lldpInfo[], neighbor:{type: "EERO", metadata:{location,...}}}]}` | | **Topology** for wired backhaul, port speeds |
| `port_details[]` | `[{ethernet_address, port_name, position}]` | | Port labels |
| `connected_clients_count`, `connected_wired_clients_count`, `connected_wireless_clients_count` | int | 5, 2, 3 | **Clients per node** |
| `radio_channel_stats` | `{band_2_4GHz:{channel, channel_width, tx_power, channel_utilization, client_count}, band_5GHz_low:{...}, band_5GHz_high:{...}, band_6GHz:{...}}` | | **Channel / utilization panel** |
| `led_on`, `led_brightness` | bool, int 0-100 | | LED switch / slider |
| `nightlight` | `{url, enabled, brightness_percentage, schedule:{enabled, on, off}}` or null | | Beacon nightlight controls |
| `power_info` | `{power_source: "USB"|"POE"..., power_source_metadata}` | | |
| `power_saving.schedule` | `{active, start, end}` | | |
| `provides_wifi`, `client_ap_disabled` | bool | | "Backhaul only" |
| `backup_wan`, `extended_border_agent_address`, `provide_device_power` | any | | |
| `messages[]` | list | | Warnings |
| `network` | `{url, name, created}` | | |
| `resources` | `{led_action, reboot, connections, ...}` | | Action URLs |

Connections (`GET resources.connections`): `ports.interfaces[]` with `interface_number, name, port_status, negotiated_speed, supported_speed, network_type, poe_status, ethernet_address, actions[{type}]`, plus `node_actions[{type}]` and `wireless_devices[{type, metadata{display_name, device_type}}]`. Drives a per-node **port map** and "what's plugged in".

## Device / client (`GET {network}/devices`)

| Field | Type | Example | UI use |
|---|---|---|---|
| `url` | str | "/2.2/networks/123/devices/aabbccddeeff" | key |
| `mac` | str | "aa:bb:cc:dd:ee:ff" | key / details |
| `eui64` | str | | |
| `nickname`, `hostname`, `display_name`, `manufacturer`, `model_name` | str | "Kitchen iPad", "Apple" | **Name** (nickname > display_name > hostname > mac) |
| `device_type` | str | see list below | **Icon** |
| `manufacturer_device_type_id` | str | | |
| `ip`, `ipv4`, `ips[]`, `ipv6_addresses[]` | str / list | "192.168.4.23" | Details |
| `connected` | bool | | **Online filter** |
| `wireless`, `connection_type` | bool, str | true, "wireless"/"wired" | Connection icon |
| `source` | `{location, is_gateway, url, model, display_name, serial_number, is_proxied_node}` | "Office" | **Which node it is on** (topology) |
| `interface` | `{frequency: "5", frequency_unit: "GHz"}` | | Band chip |
| `channel` | int | 149 | |
| `ssid`, `subnet_kind` | str | "main", "guest", "IoT" | Which SSID |
| `is_guest`, `is_private` | bool | | Guest / private-MAC badges |
| `auth` | str | "wpa2" | |
| `connectivity.signal`, `.signal_avg` | str | "-45 dBm" | **Signal strength** |
| `connectivity.score`, `.score_bars` | float, int 0-5 | 0.9, 5 | **Signal bars** |
| `connectivity.rx_bitrate` | str | "866.7 Mbit/s" | Link rate |
| `connectivity.rx_rate_info`, `.tx_rate_info` | `{rate_bps, mcs, nss, guard_interval, channel_width, phy_type}` | | Advanced Wi-Fi details (Wi-Fi 6/7 "he"/"eht") |
| `connectivity.snr`, `.inactive_time_ms`, `.frequency` | num | | |
| `connectivity.packet_stats` | `{rx_packets, tx_packets, rx_drops, tx_retries, tx_retransmit_ppm, tx_fail_ppm, rx_drop_ppm}` | | Health diagnostics |
| `connectivity.ethernet_status` | `{has_carrier, interface_number, speed, is_wan_port, port_name}` | | Wired port |
| `usage` | `{down_mbps, up_mbps}` or null | | **Live bandwidth** (refresh via `burst_reporters`) |
| `last_active`, `first_active`, `first_seen` | datetime | | "Last seen" |
| `paused` | bool | | **Pause switch** |
| `blocked` / `blacklisted` | bool | | Block button |
| `profile` | `{url, name, paused}` or null | | **Profile chip** |
| `secondary_wan_deny_access` | bool | | Backup-internet access |
| `homekit` | `{registered, protection_mode}` | | |
| `ring_lte` | `{is_not_pausable, ring_managed, lte_enabled}` | | |
| `amazon_devices_detail` | `{model_name_internal}` | | |
| `is_proxied_node` | bool | | |

`device_type` values: air_conditioner, air_purifier, alarm_system, audio, bed, cable_box, car, cash_register, coffee_maker, credit_card_terminal, desktop_computer, digital_assistant, door_bell, door_lock, e_reader, exercise_bike, fan, game_console, garage_door, generic, hard_drive, hub, laptop_computer, light, media_streamer, network_equipment, oven, pet_device, phone, plug, printer, refrigerator, remote, scale, security_camera, smoke_detector, sprinkler, tablet, television, thermostat, toaster, unknown_computer, vacuum, washer_dryer, watch. SX groups them into categories: computers_personal, entertainment, home, other.

## Profile (`GET {network}/profiles`)

| Field | Type | UI use |
|---|---|---|
| `url`, `name` | str | Profile card |
| `paused` | bool | **Pause all** switch |
| `default` | bool | |
| `state` | `{value: "paused"|"active"|"schedule"..., schedule}` | Current state incl. scheduled pause |
| `devices[]` | device summaries (`url, mac, nickname, display_name, connected, ...`) | Member list |
| `schedule[]` | `[{url?, name, days[], start, end, enabled}]` (fixtures also show `{day: "monday", start, end}`) | Bedtime schedules |
| `resources.schedules` | str | Create schedule URL |
| `premium_dns` | `{dns_policies:{block_pornographic_content, block_illegal_content, block_violent_content, safe_search_enabled, ...}, advanced_content_filters:{blocked_list[], allowed_list[]}, ad_block_settings:{enabled, enabled_for_network}, blocked_applications[], dns_provider, zscaler_location_enabled}` | Out of scope (Plus) |
| `unified_content_filters` | `{is_content_filters_set, dns_policies:{block_*_content, safe_search_enabled, youtube_restricted, ...}}` | Out of scope (Plus) |
| `proxied_nodes[]` | | |

Writable fields on the profile itself are only `name`, `paused`, `devices` (FF verified others are ignored). Filters go through `dns_policies`, schedules through `schedules`.

## Guest network (`GET {network}/guestnetwork`)

`{url, name, password, enabled, resources:{password}}`. Drives a guest card with QR code (`WIFI:T:WPA;S:<name>;P:<password>;;`).

## Additional SSID / subnet (`GET {network}/subnets_config`)

`{subnet_id, network_id, name, password, subnet_type: "main"|"A"|"B", subnet_kind: "main"|"IoT"|"Kids"|"Business"|"Guest", subnet_label, enabled, wan_access, lan_access, open_network, rate_limit_pct, nat_port_randomization, igmp_snooping_enable, vlan, dedicated_subnet:{subnet_ip, start_ip, end_ip, subnet_mask}}`.

## Speed test (`GET {network}/speedtest`)

`[{date: "2026-11-10T03:00:00+0000", down_mbps: 912.4, up_mbps: 40.2}]`. Speed history chart.

## Thread (`GET {network}/thread`)

`{url, enabled, enable_credential_syncing, name, channel, pan_id, xpan_id, master_key, commissioning_credential, active_operational_dataset, border_agent:{ip, port}}`. Secrets: show only on explicit reveal.

## Routing (`GET {network}/routing`)

`{url, devices:{url, data[{url, mac, nickname}]}, reservations:{url, data[Reservation]}, forwards:{url, data[Forward]}, pinholes:{url, data[{url, device, protocol, port}]}}`

- Reservation: `{url, description, mac, ip, public_static_ip}`
- Forward: `{url, description, ip, gateway_port, client_port, protocol: "tcp"|"udp"|"both", enabled}`

## Updates (`GET {network}/updates`)

Same as network `updates` object (see above). Release notes JSON from `manifest_resource`: `{target:{...}}` and per-firmware `{title, os_version, release_date, features}`.

## Backup access point (`GET {network}/backup_access_points`) (out of scope)

`{uuid, network_id, ssid, password, enabled, created, last_updated_at, connectivity:{backup_access_point_id, status: "success"|"failure", failure_reason, checked}}`

## Charts: data usage and insights

```json
{ "network_id": 123, "start": "...", "end": "...",
  "series": [ { "type": "download", "sum": 123456789,
                "values": [ { "time": "2026-11-11T00:00:00Z", "value": 4567890 } ] } ] }
```

Insights (*out of scope*, eero Plus) use `insight_type` (`blocked`, `inspected`, `adblock`) instead of `type`, values are counts. Device/profile insight lists: `{insight_type, insights:[{nickname|name, hostname, manufacturer, device_type, num_devices?, sum, insights_url}]}`.

## Channel utilization (`GET {network}/channel_utilization`) (out of scope)

`{utilization:[{eero_id, channel, band, frequency, center_channel, channel_bandwidth, minutes_over_busy_threshold, average_utilization, max_utilization, p99_utilization, acs_events[], time_series_data[]}], bands[], eeros:[{eero_id, role, location, wired, ring_lte_state}]}`. Wi-Fi radio analytics are eero Plus; Mesh UI shows the free per-eero `radio_channel_stats` instead.

## Permissions (`GET {network}/permissions`)

`{role: "owner"|"standard-admin"|..., permissions:{"eeros":{create,read,update,delete}, "network":{...}, "network.admin_invites":{...}, "network.transfer":{...}, "network.subnets.main.password":{...}, "network.multi_ssid":{...}, "network.multistatic_ip":{...}, "amazon.account":{...}, "user.conversations_token":{...}, per_eero:[...]}}`. **Use to disable controls the user cannot change.**

## Members (`GET {network}/members`)

`{members:[{user_id, user_role: "owner"|"admin"|..., user_name, user_email?, user_tags[]}]}`

## Notifications (`GET {network}/notifications`)

Flat map of dotted keys to bool (see endpoints section 15).

## Entitlements (`GET /2.2/entitlements/networks/{id}/features`)

A free read. Mesh UI uses it only to confirm a feature is not paywalled; the paid features it lists are out of scope.


`{entitlements:[{id, display_name: "Eero Plus", state: "Active", source: "APPLE", branding_id, product, renewal_info, created_at}], features:{ad_blocking, block_and_allow_sites, block_apps, content_filter, dynamic_dns, internet_backup, historical_data_usage, channel_utilization, event_stream, guardian_vpn, identity_protection, malwarebytes, multi_ssid, one_password: {capability, actions}}}`

---

## Suggested mapping to Mesh UI pages

Raw calls behind each area. Pages call commands, never these endpoints; see the command catalogue in [architecture/eero-client.md](../architecture/eero-client.md).

| Screen | Calls | Key fields |
|---|---|---|
| Overview | `account`, `{net}` | `health`, `status`, `speed`, `clients.count`, `eeros.count`, `ip_settings.public_ip`, `geo_ip.isp`, `updates.has_update`, `premium_status` |
| Topology / nodes | `{net}/eeros` (+ `connections` per node on demand) | `gateway`, `wired`, `mesh_quality_bars`, `wireless_upstream_node`, `ethernet_status.statuses[].neighbor`, `status`, `uptime`, client counts, `radio_channel_stats` |
| Devices list | `{net}/devices` (+ `burst_reporters` for live rates) | name chain, `device_type`, `connected`, `source.location`, `connectivity.score_bars`, `signal`, `interface.frequency`, `usage`, `paused`, `profile.name`, `is_guest` |
| Device detail | same + `data_usage/devices/{mac}` | rate info, packet stats, history charts, pause/block/rename/type/profile actions |
| Profiles | `{net}/profiles`, `{profile}/schedules` | pause, schedules (filters and blocked apps are Plus) |
| Activity | `data_usage`, `data_usage/breakdown`, `app_events`, `notifications_history` | charts (Day and Week only) and event log |
| Settings | `{net}` booleans + `fast_transition`, `wpa3_per_band`, `thread`, `routing`, `guestnetwork`, `subnets_config`, `notifications`, `updates` | gated by `capabilities` and `permissions` |

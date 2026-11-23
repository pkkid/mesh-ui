/**
 * Every page of the app: its hash route, title, sidebar entry and, once
 * built, its component. Navigation is view state, never a command. See
 * docs/ux/overview.md#navigation and #sidebar.
 *
 * This is a registration file: page stories add one line to PAGES, nothing
 * else. Routes without a page render ComingSoon.
 */
import {
  Activity,
  ArrowLeftRight,
  Download,
  Globe,
  LayoutDashboard,
  type LucideIcon,
  MessagesSquare,
  MonitorSmartphone,
  Router,
  Settings,
  Signal,
  SlidersHorizontal,
  Stethoscope,
  Ticket,
  UserRound,
  Users,
  Wifi,
} from "lucide-react";
import { type ComponentType, type LazyExoticComponent, lazy } from "react";

export type RouteId =
  | "overview"
  | "internet"
  | "eeros"
  | "eero"
  | "devices"
  | "device"
  | "profiles"
  | "profile"
  | "activity"
  | "guest"
  | "signal"
  | "wifi"
  | "advanced"
  | "ports"
  | "updates"
  | "troubleshooting"
  | "conversations"
  | "settings"
  | "account"
  | "dev-charts";

export type RouteDef = {
  id: RouteId;
  /** Hash path; `:name` segments become params. */
  path: string;
  title: string;
  icon: LucideIcon;
  /** Sidebar group; detail routes have none. */
  nav?: "network" | "settings";
  /** Sidebar count, from `network.get` counts. */
  count?: "eeros" | "devices" | "profiles";
  /** Detail routes: the list page, shown as the first crumb. */
  parent?: RouteId;
  /** Hidden when the network is in bridge mode. */
  natOnly?: boolean;
  /** Page doc, shown on the ComingSoon placeholder. */
  doc: string;
  /** Other words the palette's Places finds the page by (an old name, a common synonym). */
  keywords?: string;
};

/** Props every page gets from the router. */
export type PageProps = { params: Readonly<Record<string, string>> };

// One route per line, in sidebar order.
export const ROUTES: ReadonlyArray<RouteDef> = [
  { id: "overview", path: "/overview", title: "Overview", icon: LayoutDashboard, nav: "network", doc: "overview.md" },
  { id: "internet", path: "/internet", title: "Internet", icon: Globe, nav: "network", doc: "internet.md" },
  // Deep links to an Internet section (#/internet/history): the same page, no sidebar entry.
  { id: "internet", path: "/internet/:section", title: "Internet", icon: Globe, doc: "internet.md" },
  { id: "eeros", path: "/eeros", title: "eeros", icon: Router, nav: "network", count: "eeros", doc: "eeros.md" },
  { id: "eero", path: "/eeros/:eeroId", title: "eero", icon: Router, parent: "eeros", doc: "eero-detail.md" },
  { id: "devices", path: "/devices", title: "Devices", icon: MonitorSmartphone, nav: "network", count: "devices", doc: "devices.md" },
  { id: "device", path: "/devices/:deviceId", title: "Device", icon: MonitorSmartphone, parent: "devices", doc: "device-detail.md" },
  { id: "profiles", path: "/profiles", title: "Profiles", icon: Users, nav: "network", count: "profiles", natOnly: true, doc: "profiles.md" },
  { id: "profile", path: "/profiles/:profileId", title: "Profile", icon: Users, parent: "profiles", natOnly: true, doc: "profile-detail.md" },
  { id: "signal", path: "/signal", title: "Signal", icon: Signal, nav: "network", doc: "signal.md" },
  { id: "activity", path: "/activity", title: "Activity", icon: Activity, nav: "network", doc: "activity.md" },
  { id: "wifi", path: "/settings/wifi", title: "Wi-Fi network", icon: Wifi, nav: "settings", doc: "wifi.md" },
  { id: "guest", path: "/guest", title: "Guest network", icon: Ticket, nav: "settings", doc: "guest.md" },
  { id: "advanced", path: "/settings/advanced", title: "Advanced networking", icon: SlidersHorizontal, nav: "settings", doc: "advanced-networking.md" },
  { id: "ports", path: "/settings/ports", title: "Reservations & ports", icon: ArrowLeftRight, nav: "settings", natOnly: true, doc: "reservations-ports.md" },
  { id: "updates", path: "/settings/updates", title: "Updates & admins", icon: Download, nav: "settings", doc: "updates-admins.md" },
  { id: "troubleshooting", path: "/troubleshooting", title: "Troubleshooting", icon: Stethoscope, nav: "settings", doc: "troubleshooting.md" },
  { id: "conversations", path: "/conversations", title: "Conversations", icon: MessagesSquare, nav: "settings", keywords: "Chat Assistant Ask eero Support AI", doc: "conversations.md" },
  // Mesh UI's own settings. Titled Application, not Settings: it sits in the Settings group (#376). The id and path stay.
  { id: "settings", path: "/settings", title: "Application", icon: Settings, nav: "settings", keywords: "Settings Preferences", doc: "settings.md" },
  // Deep links to an Application section (#/settings/theme). After the other /settings/* pages, which match first.
  { id: "settings", path: "/settings/:section", title: "Application", icon: Settings, doc: "settings.md" },
  // Account opens from the sidebar footer (the signed-in name), not a nav item.
  { id: "account", path: "/account", title: "Account", icon: UserRound, doc: "account.md" },
  // Deep links to an Account section (#/account/notifications): the same page.
  { id: "account", path: "/account/:section", title: "Account", icon: UserRound, doc: "account.md" },
  ...(import.meta.env.DEV ? [{ id: "dev-charts", path: "/dev/charts", title: "Chart kit", icon: LayoutDashboard, doc: "../../design/design-system.md" } satisfies RouteDef] : []),
];

type Page = LazyExoticComponent<ComponentType<PageProps>>;

/** Loads a named export as a lazy page, so each page stays one line below. */
export const page = (load: () => Promise<Record<string, unknown>>, name: string): Page =>
  lazy(async () => ({ default: (await load())[name] as ComponentType<PageProps> }));

// Built pages, one per line, e.g.
//   overview: page(() => import("~/features/overview/OverviewView"), "OverviewView"),
export const PAGES: Partial<Record<RouteId, Page>> = {
  overview: page(() => import("~/features/overview/OverviewView"), "OverviewView"),
  account: page(() => import("~/features/account/AccountPage"), "AccountPage"),
  settings: page(() => import("~/features/account/SettingsPage"), "SettingsPage"),
  devices: page(() => import("~/features/devices/DevicesPage"), "DevicesPage"),
  internet: page(() => import("~/features/internet/InternetPage"), "InternetPage"),
  eeros: page(() => import("~/features/eeros/EerosPage"), "EerosPage"),
  device: page(() => import("~/features/device/DevicePage"), "DevicePage"),
  eero: page(() => import("~/features/eero/EeroPage"), "EeroPage"),
  guest: page(() => import("~/features/guest/GuestPage"), "GuestPage"),
  signal: page(() => import("~/features/signal/SignalPage"), "SignalPage"),
  advanced: page(() => import("~/features/advanced/AdvancedPage"), "AdvancedPage"),
  updates: page(() => import("~/features/updates/UpdatesPage"), "UpdatesPage"),
  profiles: page(() => import("~/features/profiles/ProfilesPage"), "ProfilesPage"),
  activity: page(() => import("~/features/activity/ActivityPage"), "ActivityPage"),
  profile: page(() => import("~/features/profile/ProfilePage"), "ProfilePage"),
  ports: page(() => import("~/features/ports/PortsPage"), "PortsPage"),
  wifi: page(() => import("~/features/wifi/WifiPage"), "WifiPage"),
  troubleshooting: page(() => import("~/features/troubleshooting/TroubleshootingPage"), "TroubleshootingPage"),
  conversations: page(() => import("~/features/conversations/ConversationsPage"), "ConversationsPage"),
  ...(import.meta.env.DEV ? { "dev-charts": page(() => import("~/components/charts/ChartGallery"), "ChartGallery") } : {}),
};

export const DEFAULT_ROUTE: RouteId = "overview";

export const routeById = (id: RouteId): RouteDef => ROUTES.find((r) => r.id === id) ?? (ROUTES[0] as RouteDef);

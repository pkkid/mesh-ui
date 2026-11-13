/**
 * The one map from a device's type (and, failing that, its category) to an
 * icon. Every page that shows a device (Overview, Devices, device detail,
 * profiles) uses `deviceIcon`, so a device looks the same everywhere. Do not
 * map device types to icons anywhere else.
 */
import {
  Bell,
  Bike,
  BookOpen,
  Camera,
  Cast,
  CircleHelp,
  Cpu,
  Fan,
  Gamepad2,
  HardDrive,
  House,
  Laptop,
  Lightbulb,
  type LucideIcon,
  Monitor,
  Plug,
  Printer,
  Radar,
  Router,
  Smartphone,
  Speaker,
  Tablet,
  Thermometer,
  Tv,
  Warehouse,
  Watch,
} from "lucide-react";

import type { Device, DeviceCategory } from "../../../core/model";

const TYPE_ICONS: Record<string, LucideIcon> = {
  phone: Smartphone,
  tablet: Tablet,
  watch: Watch,
  ereader: BookOpen,
  laptop: Laptop,
  desktop: Monitor,
  nas: HardDrive,
  printer: Printer,
  tv: Tv,
  media_streamer: Cast,
  game_console: Gamepad2,
  speaker: Speaker,
  camera: Camera,
  thermostat: Thermometer,
  light: Lightbulb,
  plug: Plug,
  garage: Warehouse,
  sensor: Radar,
  smoke_alarm: Bell,
  doorbell: Bell,
  smart_hub: Router,
  air_purifier: Fan,
  fitness: Bike,
  microcontroller: Cpu,
};

const CATEGORY_ICONS: Record<DeviceCategory, LucideIcon> = {
  phones_tablets: Smartphone,
  computers: Laptop,
  entertainment: Tv,
  smart_home: House,
  other: CircleHelp,
};

/** The icon for a device; a generic one when the device is not known (yet). */
export function deviceIcon(d: Pick<Device, "type" | "category"> | null | undefined): LucideIcon {
  if (!d) return CircleHelp;
  return TYPE_ICONS[d.type] ?? CATEGORY_ICONS[d.category] ?? CircleHelp;
}

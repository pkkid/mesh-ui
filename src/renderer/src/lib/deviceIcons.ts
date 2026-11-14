/**
 * The one map from a device's type (and, failing that, its category) to an
 * icon. Every page that shows a device (Overview, Devices, device detail,
 * profiles) uses `deviceIcon`, so a device looks the same everywhere. Do not
 * map device types to icons anywhere else.
 */
import {
  AirVent,
  AlarmSmoke,
  Bed,
  BellRing,
  Bike,
  BookOpen,
  Calculator,
  Car,
  Cast,
  Cctv,
  CircleHelp,
  Coffee,
  Computer,
  CookingPot,
  CreditCard,
  Droplets,
  Fan,
  Gamepad2,
  HardDrive,
  House,
  Laptop,
  Lightbulb,
  Lock,
  type LucideIcon,
  Mic,
  Monitor,
  Network,
  PawPrint,
  Plug,
  Printer,
  RadioReceiver,
  Refrigerator,
  RobotVacuum,
  Router,
  Sandwich,
  Siren,
  Smartphone,
  Speaker,
  Tablet,
  Thermometer,
  Tv,
  Warehouse,
  WashingMachine,
  Watch,
  Weight,
  Wind,
} from "lucide-react";

import type { Device, DeviceCategory } from "../../../core/model";

/**
 * Every eero `device_type` (docs/eero-api/data-model.md) to its icon. Types
 * lucide has nothing for (remote) and "generic" use the category icon.
 */
export const TYPE_ICONS: Record<string, LucideIcon> = {
  phone: Smartphone,
  tablet: Tablet,
  watch: Watch,
  e_reader: BookOpen,
  laptop_computer: Laptop,
  desktop_computer: Monitor,
  unknown_computer: Computer,
  hard_drive: HardDrive,
  printer: Printer,
  network_equipment: Network,
  television: Tv,
  media_streamer: Cast,
  game_console: Gamepad2,
  audio: Speaker,
  cable_box: RadioReceiver,
  security_camera: Cctv,
  door_bell: BellRing,
  door_lock: Lock,
  thermostat: Thermometer,
  light: Lightbulb,
  plug: Plug,
  hub: Router,
  digital_assistant: Mic,
  smoke_detector: AlarmSmoke,
  alarm_system: Siren,
  garage_door: Warehouse,
  sprinkler: Droplets,
  vacuum: RobotVacuum,
  air_conditioner: AirVent,
  air_purifier: Wind,
  fan: Fan,
  refrigerator: Refrigerator,
  oven: CookingPot,
  washer_dryer: WashingMachine,
  coffee_maker: Coffee,
  toaster: Sandwich,
  scale: Weight,
  bed: Bed,
  pet_device: PawPrint,
  exercise_bike: Bike,
  car: Car,
  cash_register: Calculator,
  credit_card_terminal: CreditCard,
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

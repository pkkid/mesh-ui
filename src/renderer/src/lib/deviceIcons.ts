/**
 * The one map from a device or an eero to an icon. Every page that shows a
 * device (Overview, Devices, device detail, profiles) uses `deviceIcon`, and
 * every page that shows an eero uses `eeroIcon`, so a thing looks the same
 * everywhere. Do not map devices or eeros to icons anywhere else.
 *
 * eero reports most devices as `generic`. Core guesses a type for those from
 * the model, hostname or manufacturer (`Device.inferredType`), and the icon
 * uses that guess. Amazon Echos are recognised by their model name first. The product glyphs live in
 * `productIcons.ts`; the full product list is in
 * docs/design/design-system.md#product-icons.
 */
import {
  AirVent,
  AlarmSmoke,
  Bed,
  BellRing,
  Bike,
  BookOpen,
  Calculator,
  Camera,
  Car,
  Cast,
  Cctv,
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
  MonitorSmartphone,
  Network,
  PawPrint,
  Phone,
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

import type { Device, DeviceCategory, Eero } from "../../../core/model";
import {
  EchoCylinder,
  EchoDisplay,
  EchoFlex,
  EchoPop,
  EchoPuck,
  EchoSphere,
  EchoSpot,
  EeroBeacon,
  EeroCeiling,
  EeroGateway,
  EeroOutdoor,
  EeroPuck,
  EeroUpright,
} from "./productIcons";

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
  // A neutral device, not a question mark: "we don't know" is not an error.
  other: MonitorSmartphone,
};

/**
 * Every eero `model_number` (eero's support article "What are the model
 * numbers for each eero?"). eero Signal (RG4U, RG4W, RG5W) is left out: it is
 * eero Plus Internet Backup.
 */
export const EERO_MODEL_ICONS: Record<string, LucideIcon> = {
  A010001: EeroPuck, // eero (1st gen)
  J010001: EeroPuck, // eero (2nd gen)
  N010001: EeroPuck, // eero 6
  Q010001: EeroPuck, // eero 6 Extender
  R010001: EeroPuck, // eero 6+
  B010001: EeroPuck, // eero Pro
  K010001: EeroPuck, // eero Pro 6
  S010001: EeroPuck, // eero Pro 6E
  V010001: EeroUpright, // eero Max 7
  PA10001: EeroUpright, // eero 7
  ME10001: EeroUpright, // eero Pro 7
  SN10001: EeroOutdoor, // eero Outdoor 7
  D010001: EeroBeacon, // eero Beacon
  T010001: EeroCeiling, // eero PoE 6
  NV01: EeroCeiling, // eero PoE 7
  U010001: EeroGateway, // eero PoE Gateway
};

/** The icon for an eero: by model number, then by model name, then the puck. */
export function eeroIcon(e: Partial<Pick<Eero, "model" | "modelNumber">> | null | undefined): LucideIcon {
  const byNumber = e?.modelNumber ? EERO_MODEL_ICONS[e.modelNumber.trim().toUpperCase()] : undefined;
  if (byNumber) return byNumber;
  const m = (e?.model ?? "").toLowerCase();
  if (m.includes("beacon")) return EeroBeacon;
  if (m.includes("outdoor")) return EeroOutdoor;
  if (m.includes("poe gateway")) return EeroGateway;
  if (m.includes("poe")) return EeroCeiling;
  if (/\b7\b/.test(m)) return EeroUpright;
  return EeroPuck;
}

/** "Echo Dot (3rd Gen)", "(3rd generation)", "3. Gen" -> 3. */
function generation(model: string): number | null {
  const n = /(\d+)\s*(?:st|nd|rd|th|\.)?\s*gen/.exec(model);
  return n ? Number(n[1]) : null;
}

/**
 * The icon for an Amazon Echo from its model name, or null when the model
 * is not an Echo. eero's wording varies ("(3rd Gen) with Clock", "(3rd
 * generation)"), so this matches the family, then the generation.
 */
export function echoIcon(model: string | null | undefined): LucideIcon | null {
  const m = (model ?? "").toLowerCase();
  if (!/\becho\b|amazon tap/.test(m)) return null;
  const gen = generation(m);
  if (/\bshow\b|\bhub\b/.test(m)) return EchoDisplay;
  if (/\bspot\b|echo time/.test(m)) return EchoSpot;
  if (/\bpop\b/.test(m)) return EchoPop;
  if (/\bflex\b/.test(m)) return EchoFlex;
  if (/\bstudio\b|\bsub\b|\bplus\b/.test(m)) return EchoCylinder;
  if (/\binput\b/.test(m)) return EchoPuck;
  if (/\blink\b|amazon tap/.test(m)) return Speaker;
  if (/\blook\b/.test(m)) return Camera;
  if (/\bconnect\b/.test(m)) return Phone;
  if (/\bdot\b/.test(m)) return gen !== null && gen <= 3 ? EchoPuck : EchoSphere;
  if (gen !== null && gen <= 3) return EchoCylinder;
  return EchoSphere;
}

/**
 * The icon for a device: an Echo by its model, else by eero's type or the
 * guessed one, then the category; a neutral device when it is not known (yet).
 */
export function deviceIcon(d: (Pick<Device, "type" | "category"> & Partial<Pick<Device, "model" | "inferredType">>) | null | undefined): LucideIcon {
  if (!d) return CATEGORY_ICONS.other;
  return echoIcon(d.model) ?? TYPE_ICONS[d.type] ?? (d.inferredType ? TYPE_ICONS[d.inferredType] : undefined) ?? CATEGORY_ICONS[d.category] ?? CATEGORY_ICONS.other;
}

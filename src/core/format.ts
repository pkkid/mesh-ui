/**
 * Shared formatters, so the same quantity looks the same on every surface.
 * Pure functions with no Node or DOM imports: the renderer may import this
 * file. A missing value is always "-", never "0" or blank.
 */

export const MISSING = "-";

type Num = number | null | undefined;

const isNum = (n: Num): n is number => typeof n === "number" && Number.isFinite(n);

/** Rounds to 1 decimal below 10 (or 100 for bytes), else to a whole number. */
function round(n: number, decimalsBelow: number): string {
  const digits = Math.abs(n) < decimalsBelow && n !== 0 ? 1 : 0;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export type Parts = { value: string; unit: string };

/** A rate in Mbps split into value and unit, e.g. { value: "186", unit: "Mbps" }. */
export function mbpsParts(mbps: Num): Parts {
  if (!isNum(mbps)) return { value: MISSING, unit: "" };
  return { value: round(mbps, 10), unit: "Mbps" };
}

/** "186 Mbps", "4.2 Mbps", "2,500 Mbps", "-". */
export function formatMbps(mbps: Num): string {
  const p = mbpsParts(mbps);
  return p.unit ? `${p.value} ${p.unit}` : p.value;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/** A volume in bytes (decimal units, like eero) split into value and unit. */
export function bytesParts(bytes: Num): Parts {
  if (!isNum(bytes)) return { value: MISSING, unit: "" };
  let n = bytes;
  let i = 0;
  while (Math.abs(n) >= 1000 && i < BYTE_UNITS.length - 1) {
    n /= 1000;
    i++;
  }
  return { value: i === 0 ? String(Math.round(n)) : round(n, 100), unit: BYTE_UNITS[i] ?? "B" };
}

/** "412 GB", "41.2 GB", "4.1 MB", "0 B", "-". */
export function formatBytes(bytes: Num): string {
  const p = bytesParts(bytes);
  return p.unit ? `${p.value} ${p.unit}` : p.value;
}

/** Percent 0 to 100: "42%", "<1%" for small non-zero values, "-". */
export function formatPercent(pct: Num, digits = 0): string {
  if (!isNum(pct)) return MISSING;
  if (pct > 0 && pct < 1 && digits === 0) return "<1%";
  return `${pct.toFixed(digits)}%`;
}

/** A plain count with separators: "1,284", "-". */
export function formatCount(n: Num): string {
  return isNum(n) ? Math.round(n).toLocaleString("en-US") : MISSING;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A duration in seconds: "45 s", "12 min", "3 h 20 min", "5 d 3 h", "-". */
export function formatDuration(seconds: Num): string {
  if (!isNum(seconds) || seconds < 0) return MISSING;
  const s = Math.floor(seconds);
  if (s < MINUTE) return `${s} s`;
  if (s < HOUR) return `${Math.floor(s / MINUTE)} min`;
  if (s < DAY) {
    const h = Math.floor(s / HOUR);
    const m = Math.floor((s % HOUR) / MINUTE);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(s / DAY);
  const h = Math.floor((s % DAY) / HOUR);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/**
 * Time relative to `now` (epoch ms): "just now", "5 min ago", "3 h ago",
 * "2 d ago", "in 5 min", and a short date ("Nov 3") beyond a week.
 */
export function formatRelative(iso: string | null | undefined, now: number, timeZone = "UTC"): string {
  if (!iso) return MISSING;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return MISSING;
  const diff = Math.round((now - at) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs >= 7 * DAY) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(at);
  }
  const text = abs < HOUR ? `${Math.max(1, Math.round(abs / MINUTE))} min` : abs < DAY ? `${Math.round(abs / HOUR)} h` : `${Math.round(abs / DAY)} d`;
  return diff >= 0 ? `${text} ago` : `in ${text}`;
}

// ---------------------------------------------------------------------------
// Network clock: times and dates in the network's time zone (eero reports an
// IANA zone such as "America/New_York"), never the viewer's.

/** Clock and date labels for one time zone. Every method takes an ISO time or epoch ms. */
export type Clock = {
  /** "9:41 AM" */
  time: (at: At) => string;
  /** "Oct 20, 9:41 AM" */
  dateTime: (at: At) => string;
  /** "Sat Nov 8" */
  day: (at: At) => string;
  /** "Saturday, Nov 8" */
  longDate: (at: At) => string;
  /** Hour labels for charts: "9 AM", "12 PM". */
  hour: (at: At) => string;
  /** "Sat" */
  weekday: (at: At) => string;
  /** "Saturday" */
  longWeekday: (at: At) => string;
  /** Local weekday (0 = Monday to 6 = Sunday) and hour (0 to 23), for day-by-hour grids. */
  parts: (at: At) => { weekday: number; hour: number };
};

type At = string | number;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const clocks = new Map<string, Clock>();

/** Builds a formatter set from Intl options, falling back to UTC for an unknown zone. */
function makeClock(timeZone: string): Clock {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const fmt = (options: Intl.DateTimeFormatOptions) => {
    const f = new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone });
    return (at: At) => {
      const ms = typeof at === "number" ? at : Date.parse(at);
      // ICU puts a narrow no-break space before AM/PM; use a plain one everywhere.
      return Number.isFinite(ms) ? f.format(ms).replace(/\u202f/g, " ") : MISSING;
    };
  };
  const dayParts = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone });
  const gridParts = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "2-digit", hourCycle: "h23", timeZone: zone });
  const toMs = (at: At) => (typeof at === "number" ? at : Date.parse(at));
  return {
    time: fmt({ hour: "numeric", minute: "2-digit" }),
    dateTime: fmt({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    day: (at) => {
      const ms = toMs(at);
      if (!Number.isFinite(ms)) return MISSING;
      // en-US puts a comma after the weekday ("Sat, Nov 8"); the UI drops it.
      const p = Object.fromEntries(dayParts.formatToParts(ms).map((x) => [x.type, x.value]));
      return `${p.weekday} ${p.month} ${p.day}`;
    },
    longDate: fmt({ weekday: "long", month: "short", day: "numeric" }),
    hour: fmt({ hour: "numeric" }),
    weekday: fmt({ weekday: "short" }),
    longWeekday: fmt({ weekday: "long" }),
    parts: (at) => {
      const ms = toMs(at);
      if (!Number.isFinite(ms)) return { weekday: -1, hour: -1 };
      const p = gridParts.formatToParts(ms);
      return {
        weekday: WEEKDAYS.indexOf(p.find((x) => x.type === "weekday")?.value ?? ""),
        hour: Number(p.find((x) => x.type === "hour")?.value),
      };
    },
  };
}

/** The (cached) clock for a network time zone. A missing or unknown zone reads as UTC. */
export function networkClock(timeZone: string | null | undefined): Clock {
  const key = timeZone || "UTC";
  let c = clocks.get(key);
  if (!c) clocks.set(key, (c = makeClock(key)));
  return c;
}

// ---------------------------------------------------------------------------
// CSV (every Export CSV button and `format: "csv"` result)

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | boolean | null | undefined };

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Names come from the network; stop spreadsheets reading them as formulas.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with a header row and CRLF line endings. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

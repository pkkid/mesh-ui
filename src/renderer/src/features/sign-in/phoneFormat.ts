/**
 * Groups a mobile number as it is typed on the sign-in screen
 * (docs/ux/sign-in.md, Welcome): "555 010 0142" for +1, "7700 900123" for
 * +44, and so on, one usual mobile grouping per country in the picker. Only
 * the view changes; the engine drops the spaces (`normaliseLogin`).
 *
 * Countries that dial a leading 0 at home (the UK, France, ...) keep a typed
 * 0 on the first group ("07700 900123"), and `phoneLogin` drops it, since
 * E.164 has no trunk 0. A number typed with its own `+` or `00` is left as
 * typed.
 */

type Plan = {
  /** Digit groups of the national number; extra digits join the last group. */
  groups: number[];
  /** A leading 0 at home is a trunk prefix, not part of the number. */
  trunk: boolean;
  /** An example number for the placeholder (invented, national form). */
  example: string;
};

const PLANS: Record<string, Plan> = {
  "+1": { groups: [3, 3, 4], trunk: false, example: "5550100142" },
  "+44": { groups: [4, 6], trunk: true, example: "7700900123" },
  "+61": { groups: [3, 3, 3], trunk: true, example: "412345678" },
  "+64": { groups: [2, 3, 4], trunk: true, example: "211234567" },
  "+353": { groups: [2, 3, 4], trunk: true, example: "851234567" },
  "+49": { groups: [3, 4, 4], trunk: true, example: "15123456789" },
  "+33": { groups: [1, 2, 2, 2, 2], trunk: true, example: "612345678" },
  "+34": { groups: [3, 3, 3], trunk: false, example: "612345678" },
  "+39": { groups: [3, 3, 4], trunk: false, example: "3123456789" },
  "+31": { groups: [1, 4, 4], trunk: true, example: "612345678" },
  "+46": { groups: [2, 3, 2, 2], trunk: true, example: "701234567" },
  "+52": { groups: [2, 4, 4], trunk: false, example: "5512345678" },
  "+55": { groups: [2, 5, 4], trunk: false, example: "11912345678" },
  "+81": { groups: [2, 4, 4], trunk: true, example: "9012345678" },
  "+91": { groups: [5, 5], trunk: true, example: "9876543210" },
};

/** E.164 allows 15 digits in all, so a national number never needs more. */
const MAX_DIGITS = 15;

const isInternational = (input: string) => /^\s*(\+|00)/.test(input);

/** The number as it should show in the field. */
export function formatPhone(country: string, input: string): string {
  if (isInternational(input)) return input;
  const plan = PLANS[country];
  let digits = input.replace(/\D/g, "").slice(0, MAX_DIGITS);
  if (!plan) return digits;
  let prefix = "";
  if (plan.trunk && digits.startsWith("0")) {
    prefix = "0";
    digits = digits.slice(1);
  }
  const parts: string[] = [];
  let at = 0;
  plan.groups.forEach((size, i) => {
    if (at >= digits.length) return;
    const last = i === plan.groups.length - 1;
    parts.push(digits.slice(at, last ? undefined : at + size));
    at += size;
  });
  return prefix + parts.join(" ");
}

/** The number for `auth.login.start`: country code plus digits, without a trunk 0. */
export function phoneLogin(country: string, input: string): string {
  if (isInternational(input)) return input.trim();
  let digits = input.replace(/\D/g, "");
  if (PLANS[country]?.trunk) digits = digits.replace(/^0/, "");
  return `${country}${digits}`;
}

/** How the number reads back to the user ("+44 7700 900123"). */
export function phoneDisplay(country: string, input: string): string {
  if (isInternational(input)) return input.trim();
  return `${country} ${formatPhone(country, phoneLogin(country, input).slice(country.length))}`;
}

/** The placeholder for the field: the country's example in its grouping. */
export function phonePlaceholder(country: string): string {
  const plan = PLANS[country];
  return plan ? formatPhone(country, plan.example) : "";
}

/** The caret position in `text` just after its `count`th digit (0 is the start). */
export function caretAfterDigits(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\d/.test(text[i] as string) && ++seen === count) return i + 1;
  }
  return text.length;
}

/** How many digits come before `pos` in `text`. */
export function digitsBefore(text: string, pos: number): number {
  return text.slice(0, pos).replace(/\D/g, "").length;
}

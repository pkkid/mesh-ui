/** Pure helpers for the Troubleshooting page (no React or path aliases, so tests import them directly). */
import type { HealthReport } from "../../../../core/model";

/** The newer of two reports by their `at`, so a later poll answered from the cache never hides a fresh Run again. */
export function newerReport(a: HealthReport | undefined, b: HealthReport | undefined): HealthReport | undefined {
  if (!a || !b) return a ?? b;
  return Date.parse(b.at) > Date.parse(a.at) ? b : a;
}

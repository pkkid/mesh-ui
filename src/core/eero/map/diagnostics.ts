/**
 * Maps `GET {net}/diagnostics` and `GET {net}/support` (`/2.2/`) to the
 * model. Pure: no requests. A real network that has not run diagnostics
 * sends only `{status}`; the 2.2 support object carries eero's contacts and
 * no ISP. Shapes: docs/eero-api/endpoints.md sections 10 and 17.
 */

import type * as M from "../../model";
import type { RawDiagnostics, RawSupport } from "../raw";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export function mapDiagnostics(raw: RawDiagnostics | null | undefined): M.DiagnosticsResult {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  return {
    status: str(raw?.status),
    issueArea: str(raw?.issue_area),
    results: results.flatMap((r) => {
      const name = str(r?.name);
      return name ? [{ name, status: str(r.status) ?? "unknown", detail: str(r.detail) }] : [];
    }),
  };
}

/** eero's 2.2 support object has no ISP contacts, so `isp` is null; core may name the ISP. */
export function mapSupport(raw: RawSupport | null | undefined): Omit<M.SupportInfo, "supportId"> {
  return {
    eero: {
      name: str(raw?.name),
      phone: str(raw?.support_phone),
      email: null,
      helpUrl: str(raw?.help_url),
      contactUrl: str(raw?.contact_url),
      emailFormUrl: str(raw?.email_web_form_url),
    },
    isp: null,
  };
}

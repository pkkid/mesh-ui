/**
 * demo: switches the demo backend's fixtures to a named scenario (signed
 * out, no networks, offline, ...) for tests, screenshots and UI work.
 * Registered only when the demo backend is active, so a live session never
 * lists it. See docs/architecture/commands.md#demo and docs/testing.md.
 */

import { z } from "zod";
import { isDemoBackend, SCENARIO_NAMES, SCENARIOS, type ScenarioName } from "../demo";
import { CommandError } from "../errors";
import { type AnyCommand, defineCommand } from "../spec";
import { ALL_TOPICS } from "./auth";

export type ScenarioResult = { scenario: ScenarioName; description: string; signedIn: boolean };

export const commands: AnyCommand[] = [
  defineCommand({
    id: "demo.scenario.set",
    label: "Demo scenario",
    description: `Resets the demo fixtures to a scenario: ${SCENARIO_NAMES.join(", ")}. Demo mode only.`,
    icon: "flask-conical",
    params: z.object({
      scenario: z.enum(SCENARIO_NAMES as [ScenarioName, ...ScenarioName[]]).describe("Scenario name."),
    }),
    effect: "write",
    scope: "app",
    backend: "demo",
    run: async (ctx, { scenario }): Promise<ScenarioResult> => {
      const backend = ctx.backend;
      if (!isDemoBackend(backend)) throw new CommandError("bad_params", "demo.scenario.set only works in demo mode.");
      const before = (await backend.auth.status()).signedIn;
      backend.setScenario(scenario);
      ctx.invalidate(ALL_TOPICS);
      const signedIn = (await backend.auth.status()).signedIn;
      if (signedIn !== before) ctx.emit({ type: "session.changed", state: signedIn ? "signed_in" : "signed_out", storage: "memory" });
      return { scenario, description: SCENARIOS[scenario], signedIn };
    },
  }),
];

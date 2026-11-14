/**
 * Saves a text export (CSV, JSON) through the host's native save dialog,
 * `window.mesh.saveFile`. The dialog, the path and the write all stay in the
 * main process; the renderer only learns the chosen file name. Not a command:
 * the text comes from a command first (for example `speedtest.history
 * {format: "csv"}`). docs/architecture/ui.md#the-bridge-windowmesh.
 *
 * The outcome shows as a toast ("Saved speed-tests-2026-11-13.csv", or the
 * error); a cancelled dialog shows nothing.
 */
import type { SaveFileResult } from "@shared/types";
import { toast } from "../components/ui/toast";

export type { SaveFileResult };

export async function saveTextFile(name: string, text: string): Promise<SaveFileResult> {
  const res = await saveRaw(name, text);
  if (res.status === "saved") toast.success(`Saved ${res.name}`);
  else if (res.status === "failed") toast.error("Couldn't save the file", { detail: res.message });
  return res;
}

async function saveRaw(name: string, text: string): Promise<SaveFileResult> {
  const save = (window as { mesh?: { saveFile?: (n: string, t: string) => Promise<SaveFileResult> } }).mesh?.saveFile;
  if (typeof save !== "function") return { status: "failed", message: "Saving files needs the desktop app." };
  try {
    return await save(name, text);
  } catch {
    return { status: "failed", message: "The file could not be saved." };
  }
}

/** A file name with today's local date: `datedName("speed-tests", "csv")` is `speed-tests-2026-11-13.csv`. */
export function datedName(stem: string, ext: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${stem}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${ext}`;
}

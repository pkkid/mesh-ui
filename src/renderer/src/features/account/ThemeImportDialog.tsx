/**
 * Add theme, modelled on T3 Code's ThemeImportDialog: drop or choose VS Code
 * (or Mesh UI / T3 Code) theme files, or paste one. Several files from one
 * theme ("X Light", "X Dark", ...) become one card, paired into light and
 * dark. Themes are saved in localStorage on this computer only.
 */
import { FileUp, Plus } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { toast } from "~/components/ui/toast";
import { installThemes } from "~/lib/themeLibrary";
import type { ThemeDefinition } from "~/lib/themePalettes";
import { pickThemeEverywhere } from "~/lib/themes";
import { cn } from "~/lib/utils";
import { buildThemeCollection, parseThemeText, themeIdFromName } from "~/lib/vscodeTheme";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 40;

type Picked = { name: string; text: string };

/** The words every label starts with ("Gruvbox" for "Gruvbox Hard", "Gruvbox Soft"). */
function sharedPrefix(labels: ReadonlyArray<string>): string {
  const words = labels.map((label) => label.split(/\s+/));
  const first = words[0] ?? [];
  const n = first.findIndex((word, i) => words.some((w) => w[i]?.toLowerCase() !== word.toLowerCase()));
  return first.slice(0, n === -1 ? first.length : n).join(" ");
}

/** Parses picked files into themes, paired and grouped. Throws with every file's problem. */
export function themesFromFiles(files: ReadonlyArray<Picked>): ReadonlyArray<ThemeDefinition> {
  const parsed: ThemeDefinition[] = [];
  const failures: string[] = [];
  for (const file of files) {
    try {
      parsed.push(parseThemeText(file.text, file.name));
    } catch (cause) {
      failures.push(`${file.name}: ${cause instanceof Error ? cause.message : "not a theme"}`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join(" "));
  const label = sharedPrefix(parsed.map((t) => t.label)) || parsed[0]?.label || "Imported";
  return buildThemeCollection(parsed, { id: `import:${themeIdFromName(label)}`, label: label.slice(0, 48) });
}

export function ThemeImportDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** More ways to add a theme, shown above the file import (search). */
  children?: React.ReactNode;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const reset = () => {
    setFiles([]);
    setJson("");
    setError(null);
  };
  // Each opening starts empty, however the last one ended.
  useEffect(() => {
    if (open) reset();
  }, [open]);
  const close = () => {
    reset();
    onOpenChange(false);
  };

  const readFiles = async (list: ReadonlyArray<File>) => {
    setError(null);
    if (list.length > MAX_FILES) return setError(`Choose up to ${MAX_FILES} files at a time.`);
    const tooBig = list.find((file) => file.size > MAX_FILE_BYTES);
    if (tooBig) return setError(`${tooBig.name} is larger than 512 KB, too big for a theme file.`);
    const picked = await Promise.all(list.map(async (file) => ({ name: file.name, text: await file.text() })));
    setFiles(picked);
    setJson(picked.length === 1 ? (picked[0]?.text ?? "") : "");
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropping(false);
    void readFiles([...event.dataTransfer.files]);
  };

  const add = () => {
    try {
      const sources = files.length > 1 ? files : [{ name: files[0]?.name ?? "theme.json", text: json }];
      const installed = installThemes(themesFromFiles(sources));
      const first = installed[0];
      pickThemeEverywhere(...installed);
      toast.success(`${first?.collection?.label ?? first?.label ?? "Theme"} added`);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That theme file is invalid.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogPopup className="max-w-lg gap-4 p-5">
        <div className="flex flex-col gap-1 pe-8">
          <DialogTitle className="text-base">Add theme</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            VS Code color themes work, as do Mesh UI and T3 Code theme files.
          </DialogDescription>
        </div>

        {children && (
          <>
            {children}
            <div aria-hidden className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-2xs uppercase tracking-wider text-muted-foreground">or import a file</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-3 transition-colors",
            dropping ? "border-ring bg-accent/20" : "border-border/80 bg-muted/20",
          )}
          onDragEnter={(e) => (e.preventDefault(), setDropping(true))}
          onDragOver={(e) => (e.preventDefault(), setDropping(true))}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
          onDrop={onDrop}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">Theme files</p>
            <p className="truncate text-xs text-muted-foreground">
              {files.length > 1
                ? `${files.length} files: ${files.map((f) => f.name).join(", ")}`
                : (files[0]?.name ?? "Drop .json files here")}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
            <FileUp />
            Choose files
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const list = [...(e.currentTarget.files ?? [])];
              e.currentTarget.value = "";
              void readFiles(list);
            }}
          />
        </div>

        {files.length <= 1 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="theme-json" className="text-xs text-muted-foreground">
              Or paste the theme JSON
            </label>
            <textarea
              id="theme-json"
              rows={files.length === 1 ? 6 : 3}
              value={json}
              spellCheck={false}
              onChange={(e) => {
                setJson(e.target.value);
                setError(null);
              }}
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground outline-none placeholder:text-placeholder focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 dark:bg-input/32"
              placeholder={'{ "name": "My Theme", "type": "dark", "colors": { "editor.background": "#1e1e1e" } }'}
            />
          </div>
        )}

        {error && (
          <p aria-live="polite" className="text-xs text-destructive-foreground">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" disabled={files.length < 2 && !json.trim()} onClick={add}>
            <Plus />
            Add theme
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

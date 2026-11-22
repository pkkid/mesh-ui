/**
 * Theme search in the Add theme sheet, modelled on T3 Code's
 * ThemeSearchSection: colour themes on Open VSX (the open VS Code extension
 * registry) with a permissive licence. Main does the fetching, checksum and
 * unzip (src/main/open-vsx.ts); this turns the themes it returns into a card
 * the same way a dropped file is.
 */
import { Package, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ThemeExtension, ThemeSearchSort } from "@shared/types";

import { formatCount } from "../../../../core/format";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { toast } from "~/components/ui/toast";
import { installThemes } from "~/lib/themeLibrary";
import { pickThemeEverywhere } from "~/lib/themes";
import { cn } from "~/lib/utils";
import { themesFromExtension } from "~/lib/vscodeTheme";

const SORTS = [
  { value: "downloadCount", label: "Most popular" },
  { value: "rating", label: "Top rated" },
  { value: "timestamp", label: "Newest" },
] as const;

export function ThemeSearch({ onInstalled }: { onInstalled: () => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ThemeSearchSort>("downloadCount");
  const [results, setResults] = useState<ThemeExtension[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const latest = useRef(0);
  const available = typeof window.mesh?.searchThemes === "function";

  useEffect(() => {
    if (!available) return;
    const request = ++latest.current;
    setLoading(true);
    const timer = setTimeout(
      async () => {
        const res = await window.mesh.searchThemes(query, sort);
        if (request !== latest.current) return; // A newer search is on its way.
        setLoading(false);
        if (res.ok) {
          setResults(res.extensions);
          setError(null);
        } else {
          setError(res.message);
        }
      },
      query ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, sort, available]);

  const install = async (extension: ThemeExtension) => {
    setInstalling(extension.id);
    setError(null);
    try {
      const res = await window.mesh.downloadThemes(extension.id);
      if (!res.ok) throw new Error(res.message);
      const installed = installThemes(themesFromExtension(res.extension, res.themes));
      pickThemeEverywhere(...installed);
      toast.success(`${extension.name} added`, { detail: `${installed.length} ${installed.length === 1 ? "theme" : "themes"} from Open VSX` });
      onInstalled();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The theme could not be added.");
    } finally {
      setInstalling(null);
    }
  };

  if (!available) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          icon={<Search />}
          value={query}
          placeholder="Search Open VSX themes"
          aria-label="Search Open VSX themes"
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
          // Inside the Add theme sheet's form: Enter searches as you type already, never adds a pasted theme.
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        />
        {/* A dropdown, not a Segmented toggle (design-system.md, Dropdowns, not pill toggles). */}
        <Select items={SORTS} value={sort} onValueChange={(v) => v && setSort(v)}>
          <SelectTrigger aria-label="Sort" className="w-36 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {SORTS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      {/* The border sits outside the scroll box so the edge fades (scroll-fade-y, a mask) never eat it. */}
      <div className="overflow-hidden rounded-xl border border-border/70">
      <div
        aria-busy={loading}
        className={cn(
          "scroll-fade-y flex max-h-64 min-h-24 flex-col overflow-y-auto transition-opacity",
          loading && results === null && "opacity-40 delay-150",
        )}
      >
        {results === null ? (
          <p className="m-auto text-xs text-muted-foreground">Searching Open VSX...</p>
        ) : results.length === 0 ? (
          <p className="m-auto text-xs text-muted-foreground">No color themes found.</p>
        ) : (
          results.map((extension) => (
            <div
              key={extension.id}
              className="flex items-center gap-3 border-b border-border/50 px-3 py-2 last:border-b-0 hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground text-sm">{extension.name}</p>
                <p className="truncate text-xs text-muted-foreground">{extension.publisher}</p>
                <p className="truncate text-xs text-muted-foreground" title={extension.description || undefined}>
                  {extension.description || "-"}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {extension.themeCount} {extension.themeCount === 1 ? "theme" : "themes"} ·{" "}
                  {formatCount(extension.downloadCount)} downloads · {extension.license}
                </p>
              </div>
              <Button
                size="xs"
                variant="outline"
                className="[&_svg]:text-muted-foreground"
                disabled={installing !== null}
                aria-label={`Install ${extension.name}`}
                onClick={() => void install(extension)}
              >
                {installing === extension.id ? <Spinner className="size-3.5" /> : <Package />}
                Install
              </Button>
            </div>
          ))
        )}
      </div>
      </div>
      {error && (
        <p aria-live="polite" className="text-xs text-destructive-foreground">
          {error}
        </p>
      )}
      <p className="text-2xs text-muted-foreground">
        From open-vsx.org, permissively licensed themes only. The download is checked against its published checksum.
      </p>
    </div>
  );
}

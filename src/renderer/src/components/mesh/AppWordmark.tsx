/**
 * The app name as a two-tone wordmark, modelled on T3 Code's sidebar brand
 * ("T3" bold in the text colour, "Code" quieter in muted text): "Mesh" bold in
 * the current text colour, "UI" medium weight in `text-muted-foreground`.
 * Size it with a `text-*` class. The words are plain text with a real space,
 * so it reads and copies as "Mesh UI".
 */
import { cn } from "~/lib/utils";

export function AppWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("min-w-0 truncate tracking-tight", className)}>
      <span className="font-bold">Mesh</span> <span className="font-medium text-muted-foreground">UI</span>
    </span>
  );
}

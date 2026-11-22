/**
 * Settings, Keyboard shortcuts (docs/ux/pages/settings.md), after T3 Code's
 * KeybindingsSettings: one row per rebindable action with its keys on the
 * right as a pill that looks like a button on hover. Clicking it turns it
 * into a "Press shortcut" field that records the next key combination (Esc,
 * Tab or clicking away cancels). A ⋯ menu beside it, shown on row hover,
 * has Reset to default (once changed) and Remove. A refused combination (no
 * modifier, taken by another action, kept by the app or the system) shows
 * why under the row and is not saved. Reset all in the header when anything
 * is changed. Each action has one combination or none; the registry and its
 * rules are lib/shortcuts.ts. Fixed shortcuts are not listed.
 */
import { Menu } from "@base-ui/react/menu";
import { Ellipsis } from "lucide-react";
import { useEffect, useState } from "react";

import { comboKeys, comboText } from "@shared/shortcuts";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import { Row } from "~/features/advanced/SettingsGroups";
import { menuClasses } from "~/features/devices/BulkBar";
import {
  bindingFor,
  isChanged,
  isMac,
  recordNextCombo,
  removeBinding,
  resetAllBindings,
  resetBinding,
  SHORTCUTS,
  type ShortcutAction,
  type ShortcutId,
  setBinding,
  useAnyChanged,
  useBinding,
} from "~/lib/shortcuts";
import { cn } from "~/lib/utils";

function KeyCaps({ combo }: { combo: string }) {
  return (
    <span className="flex items-center gap-1">
      {comboKeys(combo, isMac()).map((k, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the caps of one combination never reorder.
        <Kbd key={i} className="text-foreground">
          {k}
        </Kbd>
      ))}
    </span>
  );
}

type Recording = { id: ShortcutId; pressed: string | null; problem: string | null };

/** The ⋯ menu: Reset to default once the keys differ, Remove while the action has keys. Shown on row hover or focus. */
function RowMenu({ action, combo }: { action: ShortcutAction; combo: string }) {
  const changed = isChanged(action.id);
  if (!changed && !combo) return null;
  return (
    <span className="flex items-center opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
      <Menu.Root>
        <Menu.Trigger render={<Button variant="ghost-muted" size="icon-sm" aria-label={`Actions for ${action.label}`} />}>
          <Ellipsis className="size-3.5" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
            <Menu.Popup className={menuClasses.popup}>
              {changed && (
                <Menu.Item className={menuClasses.item} onClick={() => resetBinding(action.id)}>
                  Reset to default
                </Menu.Item>
              )}
              {combo && (
                <Menu.Item className={cn(menuClasses.item, "text-destructive-foreground")} onClick={() => removeBinding(action.id)}>
                  Remove
                </Menu.Item>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </span>
  );
}

function ShortcutRow({ action, recording, onRecord, onCancel }: { action: ShortcutAction; recording: Recording | null; onRecord: () => void; onCancel: () => void }) {
  const combo = useBinding(action.id);
  return (
    <div className="group/row">
      <Row
        title={action.label}
        control={
          <div className="flex items-center justify-end gap-1.5">
            <RowMenu action={action} combo={combo} />
            {recording ? (
              <Input
                autoFocus
                readOnly
                aria-label={`Keyboard shortcut for ${action.label}`}
                aria-invalid={recording.problem ? true : undefined}
                value={recording.pressed ? comboText(recording.pressed, isMac()) : ""}
                placeholder="Press shortcut"
                className="w-44 font-mono [&_input]:h-[26px] [&_input]:text-xs"
                onBlur={onCancel}
              />
            ) : (
              <button
                type="button"
                onClick={onRecord}
                aria-label={`Edit shortcut for ${action.label}: ${combo ? comboText(combo, isMac()) : "Unassigned"}`}
                className="-me-1.5 inline-flex h-7 cursor-pointer items-center rounded-md border border-transparent px-1.5 outline-none transition-colors hover:border-border/70 hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/24"
              >
                {combo ? <KeyCaps combo={combo} /> : <span className="text-muted-foreground text-sm">Unassigned</span>}
              </button>
            )}
          </div>
        }
      >
        {recording?.problem && (
          <p role="alert" className="-mt-1 text-warning-foreground text-xs">
            {recording.problem}
          </p>
        )}
      </Row>
    </div>
  );
}

export function KeyboardShortcuts({ id }: { id?: string }) {
  const [recording, setRecording] = useState<Recording | null>(null);
  const anyChanged = useAnyChanged();

  const recordingId = recording?.id ?? null;
  useEffect(() => {
    if (!recordingId) return;
    const stop = recordNextCombo((combo) => {
      if (combo === null) {
        setRecording(null);
        return;
      }
      if (combo === bindingFor(recordingId)) {
        setRecording(null);
        return;
      }
      const problem = setBinding(recordingId, combo);
      setRecording(problem ? { id: recordingId, pressed: combo, problem } : null);
    });
    return stop;
  }, [recordingId]);

  return (
    <Section
      id={id}
      title="Keyboard shortcuts"
      description="Saved on this computer."
      className="gap-[15px]"
      tools={
        anyChanged && (
          <Button variant="ghost-muted" onClick={resetAllBindings}>
            Reset all
          </Button>
        )
      }
    >
      <Card className="divide-y divide-border/50">
        {SHORTCUTS.map((a) => (
          <ShortcutRow
            key={a.id}
            action={a}
            recording={recording?.id === a.id ? recording : null}
            onRecord={() => setRecording({ id: a.id, pressed: null, problem: null })}
            onCancel={() => setRecording((r) => (r?.id === a.id ? null : r))}
          />
        ))}
      </Card>
    </Section>
  );
}

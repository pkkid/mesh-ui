/**
 * Settings, Keyboard shortcuts (docs/ux/pages/settings.md): one row per
 * rebindable action with its keys as key caps, Change (records the next key
 * combination in the row, Esc cancels) and Reset once changed. A refused
 * combination (no modifier, taken by another action, kept by the app or the
 * system) shows why under the row and is not saved. Reset all in the header
 * when anything is changed. Each action has exactly one combination; the
 * registry and its rules are lib/shortcuts.ts. Fixed shortcuts are not
 * listed.
 */
import { useEffect, useState } from "react";

import { comboKeys } from "@shared/shortcuts";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { Kbd } from "~/components/ui/kbd";
import { Row } from "~/features/advanced/SettingsGroups";
import {
  bindingFor,
  isChanged,
  isMac,
  recordNextCombo,
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

function ShortcutRow({ action, recording, onRecord, onCancel }: { action: ShortcutAction; recording: Recording | null; onRecord: () => void; onCancel: () => void }) {
  const combo = useBinding(action.id);
  const changed = isChanged(action.id);
  return (
    <div className={cn(recording && "bg-muted/40")}>
      <Row
        title={action.label}
        control={
          recording ? (
            <>
              {recording.pressed ? <KeyCaps combo={recording.pressed} /> : <span className="text-foreground text-xs italic">Press keys, Esc to cancel</span>}
              <Button variant="outline" size="xs" onClick={onCancel}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <KeyCaps combo={combo} />
              {changed && (
                <Button variant="ghost-muted" size="xs" onClick={() => resetBinding(action.id)} title="Back to the default keys">
                  Reset
                </Button>
              )}
              <Button variant="outline" size="xs" onClick={onRecord} aria-label={`Change the ${action.label} shortcut`}>
                Change
              </Button>
            </>
          )
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
            onCancel={() => setRecording(null)}
          />
        ))}
      </Card>
    </Section>
  );
}

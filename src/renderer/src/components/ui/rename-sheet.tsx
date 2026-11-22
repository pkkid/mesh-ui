// The Rename sheet opened by the Rename… button in a detail page's hero
// (device, eero, profile): one name field in a clean sheet (no divider
// lines), up to 32 characters with a live count. The page passes the write:
// `onSave` resolves to the execute result, and the sheet closes on `ok`.
// A `bad_params` message from the command shows under the field.
import { useId, useState } from "react";

import { Input } from "~/components/ui/input";
import { Sheet, SheetField } from "~/components/ui/sheet";

type RenameSheetProps = {
  open: boolean;
  onClose: () => void;
  /** "Rename Kitchen Echo". */
  title: string;
  /** What the name is for: "Shown everywhere in Mesh UI and the eero app". */
  subtitle?: string;
  label?: string;
  /** The name now ("" for none). */
  value: string;
  /** Shown while empty, e.g. the device's own name. */
  placeholder?: string;
  /** False: an empty name cannot be saved. */
  allowEmpty?: boolean;
  /** Under the field while there is no error. */
  helper?: (name: string) => string;
  error?: string | null;
  onSave: (name: string) => Promise<unknown>;
};

export const NAME_MAX = 32;

export function RenameSheet({ open, ...props }: RenameSheetProps) {
  // Remount on open, so the field starts from the current name each time.
  return open ? <RenameBody {...props} /> : null;
}

function RenameBody({ onClose, title, subtitle, label = "Name", value, placeholder, allowEmpty = false, helper, error, onSave }: Omit<RenameSheetProps, "open">) {
  const id = useId();
  const [name, setName] = useState(value);
  const trimmed = name.trim();
  const tooLong = trimmed.length > NAME_MAX;
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      dirty={trimmed !== value.trim()}
      valid={!tooLong && (allowEmpty || trimmed.length > 0)}
      onSave={() => onSave(trimmed)}
      saveLabel="Rename"
    >
      <SheetField
        label={label}
        htmlFor={id}
        error={tooLong ? `Use ${NAME_MAX} characters or fewer.` : (error ?? undefined)}
        helper={helper ? helper(trimmed) : `${trimmed.length} / ${NAME_MAX}`}
      >
        <Input
          id={id}
          value={name}
          placeholder={placeholder}
          maxLength={NAME_MAX + 8}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(e.target.value)}
        />
      </SheetField>
    </Sheet>
  );
}

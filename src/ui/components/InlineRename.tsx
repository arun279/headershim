import { useEffect, useId, useRef } from "preact/hooks";
import { copy } from "../copy";

interface InlineRenameProps {
  value: string;
  onCommit: (name: string) => void;
  onClose: (restoreFocus: boolean) => void;
}

/**
 * The one inline rename field: a name well that selects on open and names both
 * keys beneath itself. Mounted by the popup switcher and the Profiles list so a
 * rename works and reads the same on both. A trimmed value that differs from the
 * original commits when editing ends by any exit but Escape, so blur, Enter, an
 * outside click, and the menu closing all keep the typed name; only Escape
 * reverts. `onClose` runs whenever an exit is driven from here, with
 * `restoreFocus` set for the keyboard exits (Enter, Escape).
 */
export function InlineRename({ value, onCommit, onClose }: InlineRenameProps) {
  const input = useRef<HTMLInputElement>(null);
  const draft = useRef(value);
  const cancelled = useRef(false);
  const hintId = useId();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    return () => {
      const next = draft.current.trim();
      if (!cancelled.current && next.length > 0 && next !== value) {
        onCommit(next);
      }
    };
  }, []);

  return (
    <div class="inline-rename">
      <input
        class="profile-name-input inset-field"
        type="text"
        aria-label={copy.options.profiles.nameLabel}
        aria-describedby={hintId}
        defaultValue={value}
        ref={input}
        onInput={(event) => {
          draft.current = event.currentTarget.value;
        }}
        onBlur={() => onClose(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onClose(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancelled.current = true;
            onClose(true);
          }
        }}
      />
      <span class="inline-rename-hint" id={hintId}>
        {copy.options.profiles.renameHint}
      </span>
    </div>
  );
}

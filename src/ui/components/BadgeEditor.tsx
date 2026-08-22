import { useEffect, useId, useRef, useState } from "preact/hooks";
import { BADGE_COLORS, type BadgeColor } from "../../core/model";
import { copy as optionsCopy } from "../copy.options";
import "./BadgeEditor.css";

interface BadgeEditorProps {
  badgeText: string;
  color: BadgeColor;
  /** Commits badge text and colour together as either changes. */
  onChange: (badgeText: string, color: BadgeColor) => void;
}

/**
 * The per-profile badge editor: a two-character text field and the fixed
 * eight-colour palette as a native radiogroup (the browser handles arrow-key
 * selection and roving tabindex). The field caps its own length and commits on
 * every keystroke, so what it shows is always what the badge will carry.
 */
export function BadgeEditor({ badgeText, color, onChange }: BadgeEditorProps) {
  const [text, setText] = useState(badgeText);
  const input = useRef<HTMLInputElement>(null);
  const groupName = useId();

  // A rename re-derives the badge; follow it in the field and preview, but never
  // over the value the user is mid-way through typing (that is their own commit
  // echoing back through the store).
  useEffect(() => {
    if (input.current !== document.activeElement) setText(badgeText);
  }, [badgeText]);

  const editText = (next: string) => {
    setText(next);
    onChange(next, color);
  };

  return (
    <div class="badge-editor">
      <span
        class="badge-preview badge-glyph"
        aria-hidden="true"
        style={{ background: `var(--badge-${color})` }}
      >
        {text}
      </span>
      <label class="badge-text-field">
        <span class="silk">{optionsCopy.options.badge.textLabel}</span>
        <input
          ref={input}
          class="badge-text-input inset-field mono"
          type="text"
          maxLength={2}
          value={text}
          onInput={(event) => editText(event.currentTarget.value)}
        />
      </label>
      <div
        class="badge-swatches"
        role="radiogroup"
        aria-label={optionsCopy.options.badge.colorLabel}
      >
        {BADGE_COLORS.map((swatch) => (
          <label
            key={swatch}
            class="badge-swatch"
            style={{ background: `var(--badge-${swatch})` }}
          >
            <input
              class="badge-swatch-input"
              type="radio"
              name={groupName}
              value={swatch}
              checked={swatch === color}
              aria-label={optionsCopy.options.badge.colorNames[swatch]}
              onChange={() => onChange(text, swatch)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

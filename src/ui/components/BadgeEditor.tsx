import { useId, useState } from "preact/hooks";
import { BADGE_COLORS, type BadgeColor } from "../../core/model";
import { copy } from "../copy";
import "./BadgeEditor.css";

interface BadgeEditorProps {
  badgeText: string;
  color: BadgeColor;
  /** Commits badge text (on blur/Enter) and colour (on selection) together. */
  onChange: (badgeText: string, color: BadgeColor) => void;
}

/**
 * The per-profile badge editor: a two-character text field and the fixed
 * eight-colour palette as a native radiogroup (the browser handles arrow-key
 * selection and roving tabindex). Colour commits on selection; text commits on
 * blur or Enter so a keystroke never spams the lock.
 */
export function BadgeEditor({ badgeText, color, onChange }: BadgeEditorProps) {
  const [text, setText] = useState(badgeText);
  const groupName = useId();

  const commitText = () => {
    if (text !== badgeText) {
      onChange(text, color);
    }
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
        <span class="silk">{copy.options.badge.textLabel}</span>
        <input
          class="badge-text-input inset-field mono"
          type="text"
          maxLength={2}
          value={text}
          onInput={(event) => setText(event.currentTarget.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitText();
            }
          }}
        />
      </label>
      <div
        class="badge-swatches"
        role="radiogroup"
        aria-label={copy.options.badge.colorLabel}
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
              aria-label={copy.options.badge.colorNames[swatch]}
              onChange={() => onChange(text, swatch)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

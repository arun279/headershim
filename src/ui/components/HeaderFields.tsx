import type { Direction, HeaderOp } from "../../core/model";
import { copy } from "../copy";

interface HeaderDraft {
  direction: Direction;
  operation: HeaderOp;
}

/**
 * Direction and operation: the same "pick one of N" job, so the same control.
 * Native radios under the segment paint keep one tab stop and arrow-key
 * movement while reading as the segmented control the rest of the product uses.
 */
export function HeaderFields<D extends HeaderDraft>({
  idBase,
  draft,
  errors,
  update,
}: {
  idBase: string;
  draft: D;
  errors: { operation?: string };
  update: (transform: (draft: D) => D) => void;
}) {
  return (
    <div class="editor-primary-grid">
      <Segments
        name={`${idBase}-dir`}
        label={copy.editor.labels.direction}
        options={["request", "response"]}
        selected={draft.direction}
        optionLabel={(value) => copy.editor.direction[value]}
        onPick={(direction) => update((current) => ({ ...current, direction }))}
      />

      <Segments
        name={`${idBase}-op`}
        label={copy.editor.labels.operation}
        options={["set", "append", "remove"]}
        selected={draft.operation}
        optionLabel={(value) => copy.editor.operation[value]}
        error={errors.operation}
        onPick={(operation) => update((current) => ({ ...current, operation }))}
      />
    </div>
  );
}

function Segments<V extends string>({
  name,
  label,
  options,
  selected,
  optionLabel,
  error,
  onPick,
}: {
  name: string;
  label: string;
  options: readonly V[];
  selected: V;
  optionLabel: (value: V) => string;
  error?: string | undefined;
  onPick: (value: V) => void;
}) {
  return (
    <fieldset class="editor-primary-field">
      <legend class="editor-label" id={name}>
        {label}
      </legend>
      <div
        class="segments editor-segments"
        role="radiogroup"
        aria-labelledby={name}
      >
        {options.map((value) => (
          <label
            class={selected === value ? "segment checked" : "segment"}
            key={value}
          >
            <input
              class="sr-only"
              type="radio"
              name={name}
              value={value}
              checked={selected === value}
              onChange={() => onPick(value)}
            />
            {optionLabel(value)}
          </label>
        ))}
      </div>
      {error !== undefined && (
        <p class="editor-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

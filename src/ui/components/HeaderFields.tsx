import type { Direction, HeaderOp } from "../../core/model";
import { copy } from "../copy";

interface HeaderDraft {
  direction: Direction;
  operation: HeaderOp;
}

/**
 * The direction and operation controls shared by both editors. Native radios
 * retain one-tab-stop keyboard behavior while the operation labels carry the
 * compact segmented-control paint.
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
      <fieldset class="editor-primary-field">
        <legend class="editor-label" id={`${idBase}-dir`}>
          {copy.editor.labels.direction}
        </legend>
        <div
          class="editor-radios"
          role="radiogroup"
          aria-labelledby={`${idBase}-dir`}
        >
          {(["request", "response"] as const).map((value) => (
            <label class="editor-radio" key={value}>
              <input
                type="radio"
                name={`${idBase}-dir`}
                value={value}
                checked={draft.direction === value}
                onChange={() =>
                  update((current) => ({ ...current, direction: value }))
                }
              />
              {copy.editor.direction[value]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset class="editor-primary-field">
        <legend class="editor-label" id={`${idBase}-op`}>
          {copy.editor.labels.operation}
        </legend>
        <div
          class="segments operation-segments"
          role="radiogroup"
          aria-labelledby={`${idBase}-op`}
        >
          {(["set", "append", "remove"] as const).map((value) => (
            <label
              class={draft.operation === value ? "segment checked" : "segment"}
              key={value}
            >
              <input
                class="sr-only"
                type="radio"
                name={`${idBase}-op`}
                value={value}
                checked={draft.operation === value}
                onChange={() =>
                  update((current) => ({ ...current, operation: value }))
                }
              />
              {copy.editor.operation[value]}
            </label>
          ))}
        </div>
        {errors.operation !== undefined && (
          <p class="editor-error" role="alert">
            {errors.operation}
          </p>
        )}
      </fieldset>
    </div>
  );
}

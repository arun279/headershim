import type { Direction, HeaderOp } from "../../core/model";
import { copy } from "../copy";
import { HeaderNameInput } from "./HeaderNameInput";

interface HeaderDraft {
  direction: Direction;
  operation: HeaderOp;
  header: string;
}

/**
 * The direction / operation / header-name trio shared by the rule editor and
 * the This-tab composer, so both speak one control grammar. It reads and folds
 * the three fields straight into the caller's draft via `update`, keeping the
 * two editors' field markup in exactly one place. `idBase` keys the labels and
 * the radio group and must be unique on the page.
 */
export function HeaderFields<D extends HeaderDraft>({
  idBase,
  draft,
  errors,
  nameInputRef,
  update,
}: {
  idBase: string;
  draft: D;
  errors: { name?: string; operation?: string };
  nameInputRef?: ((element: HTMLInputElement | null) => void) | undefined;
  update: (transform: (draft: D) => D) => void;
}) {
  return (
    <>
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

        <label class="editor-primary-field" for={`${idBase}-op`}>
          <span class="editor-label">{copy.editor.labels.operation}</span>
          <select
            id={`${idBase}-op`}
            class="field editor-select"
            value={draft.operation}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "set" || value === "append" || value === "remove") {
                update((current) => ({ ...current, operation: value }));
              }
            }}
          >
            {(["set", "append", "remove"] as const).map((value) => (
              <option value={value} key={value}>
                {copy.editor.operation[value]}
              </option>
            ))}
          </select>
          {errors.operation !== undefined && (
            <p class="editor-error" role="alert">
              {errors.operation}
            </p>
          )}
        </label>
      </div>

      <HeaderNameInput
        value={draft.header}
        error={errors.name}
        autoFocus
        inputRef={nameInputRef}
        onInput={(value) =>
          update((current) => ({ ...current, header: value }))
        }
      />
    </>
  );
}

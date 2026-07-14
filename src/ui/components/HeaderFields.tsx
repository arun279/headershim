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
  broadScope,
  update,
}: {
  idBase: string;
  draft: D;
  errors: { name?: string; operation?: string };
  /** The rule's scope reaches every site: escalates the sensitive-header advisory. */
  broadScope?: boolean | undefined;
  update: (transform: (draft: D) => D) => void;
}) {
  return (
    <>
      <div class="editor-field">
        <span class="editor-label" id={`${idBase}-dir`}>
          {copy.editor.labels.direction}
        </span>
        <div
          class="editor-control editor-radios"
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
      </div>

      <div class="editor-field">
        <label class="editor-label" for={`${idBase}-op`}>
          {copy.editor.labels.operation}
        </label>
        <div class="editor-control">
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
        </div>
      </div>

      <HeaderNameInput
        value={draft.header}
        direction={draft.direction}
        operation={draft.operation}
        broadScope={broadScope}
        error={errors.name}
        autoFocus
        onInput={(value) =>
          update((current) => ({ ...current, header: value }))
        }
      />
    </>
  );
}

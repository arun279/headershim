import { useState } from "preact/hooks";
import type { Direction, HeaderOp, TabOverride } from "../../../core/model";
import type { Result } from "../../../core/result";
import { copy } from "../../copy";
import {
  type HeaderFieldError,
  headerErrorToFieldError,
  headerValueEmptyErrors,
} from "../../state/header-errors";
import type {
  OverrideDraft,
  SessionMutationError,
} from "../../state/session-mutations";
import { parseHeaderLine } from "../headerLine";
import { OpGlyph, TabGlyph } from "./glyphs";

/**
 * A this-tab change lives or dies with the host grant it rides on, so the
 * decline is one of the ways the commit can fail, alongside the store's own.
 */
export type ThisTabError =
  | SessionMutationError
  | { readonly kind: "grant-declined"; readonly host: string };

interface ThisTabComposerProps {
  onSubmit: (
    draft: OverrideDraft,
  ) => Promise<Result<TabOverride, ThisTabError>>;
  onClose: () => void;
  onCommitted: () => void;
}

const DIRECTIONS: readonly Direction[] = ["request", "response"];
const OPERATIONS: readonly HeaderOp[] = ["set", "append", "remove"];

/**
 * The ephemeral author. A this-tab change is temporary by construction, so it
 * asks for only what a temporary change needs: a direction, an operation, and
 * the wire bytes. The host grant fires inside the same commit.
 */
export function ThisTabComposer({
  onSubmit,
  onClose,
  onCommitted,
}: ThisTabComposerProps) {
  const [direction, setDirection] = useState<Direction>("request");
  const [operation, setOperation] = useState<HeaderOp>("set");
  const [header, setHeader] = useState("");
  const [value, setValue] = useState("");
  const [pastedLineSplit, setPastedLineSplit] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const commit = () => {
    const empty = headerValueEmptyErrors({ operation, header, value });
    if (empty !== undefined) {
      setError(firstMessage(empty));
      return;
    }
    const draft: OverrideDraft = {
      direction,
      operation,
      header: header.trim(),
      ...(operation === "remove" ? {} : { value }),
    };
    void onSubmit(draft).then((outcome) => {
      if (outcome.ok) {
        onCommitted();
        onClose();
      } else if (outcome.error.kind === "session-override-limit-exceeded") {
        setError(copy.errors.sessionCap);
      } else if (outcome.error.kind === "grant-declined") {
        setError(copy.errors.thisTabDeclined(outcome.error.host));
      } else {
        setError(firstMessage(headerErrorToFieldError(outcome.error)));
      }
    });
  };

  return (
    <section class="compose" aria-label={copy.readout.newChange}>
      <div class="c-tag silk">
        <TabGlyph />
        {copy.readout.thisTabTag}
      </div>
      <div class="cseg-row">
        <div class="cseg">
          {DIRECTIONS.map((option) => (
            <button
              type="button"
              key={option}
              class={option === direction ? "on" : ""}
              aria-pressed={option === direction}
              onClick={() => setDirection(option)}
            >
              {copy.readout.direction[option]}
            </button>
          ))}
        </div>
        <div class="cseg">
          {OPERATIONS.map((option) => (
            <button
              type="button"
              key={option}
              class={option === operation ? "on" : ""}
              aria-pressed={option === operation}
              onClick={() => setOperation(option)}
            >
              <OpGlyph operation={option} />
              {copy.editor.operation[option]}
            </button>
          ))}
        </div>
      </div>
      <div class="cfields">
        <input
          class="cin name mono"
          value={header}
          placeholder={copy.editor.placeholders.headerName}
          aria-label={copy.editor.labels.headerName}
          spellcheck={false}
          autocomplete="off"
          autofocus
          onInput={(event) => {
            setPastedLineSplit(false);
            setHeader(event.currentTarget.value);
          }}
          onPaste={(event) => {
            const text = event.clipboardData?.getData("text/plain") ?? "";
            const line = parseHeaderLine(text);
            if (line !== undefined) {
              event.preventDefault();
              setHeader(line.name);
              setValue(line.value);
              setPastedLineSplit(true);
            }
          }}
          onKeyDown={commitOnEnter(commit)}
        />
        {operation !== "remove" && (
          <span class="val-wrap">
            <span class="colon mono" aria-hidden="true">
              :
            </span>
            <input
              class="cin val mono"
              value={value}
              placeholder={copy.editor.placeholders.value}
              aria-label={copy.editor.labels.value}
              spellcheck={false}
              autocomplete="off"
              onInput={(event) => setValue(event.currentTarget.value)}
              onKeyDown={commitOnEnter(commit)}
            />
          </span>
        )}
      </div>
      {pastedLineSplit && (
        <p class="c-note" role="status">
          {copy.editor.pastedLineSplit}
        </p>
      )}
      {error !== undefined && (
        <p class="c-error" role="alert">
          {error}
        </p>
      )}
      <div class="cfoot">
        <button type="button" class="btng" onClick={onClose}>
          {copy.actions.cancel}
        </button>
        <button type="button" class="commit" onClick={commit}>
          {copy.readout.addThisTab} <span class="kbd mono">↵</span>
        </button>
      </div>
    </section>
  );
}

// The composer has one error line, in field order: the shared field-error copy
// arrives keyed by field, and the first one set is the one that speaks.
function firstMessage(fields: HeaderFieldError): string | undefined {
  return fields.name ?? fields.value ?? fields.operation;
}

function commitOnEnter(commit: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };
}

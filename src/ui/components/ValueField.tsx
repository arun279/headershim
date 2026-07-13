import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Rule } from "../../core/model";
import { copy } from "../copy";
import "./ValueField.css";

interface ValueFieldProps {
  value: string;
  /** Present while the value is a generated literal; hand-editing clears it. */
  generated?: Rule["generated"] | undefined;
  /** Formatted freeze time when the generated value is the one already saved. */
  frozenAt?: string | undefined;
  error?: string | undefined;
  onInput: (value: string) => void;
  onGenerate: (kind: "uuid" | "timestamp") => void;
}

/**
 * Value input with the Insert menu for generated values. Inserting writes the
 * actual string — never a token — and the note under the field says exactly
 * what that means: frozen at save, not per request.
 */
export function ValueField(props: ValueFieldProps) {
  const id = useId();
  const describedBy = [
    ...(props.generated === undefined ? [] : [`${id}-note`]),
    ...(props.error === undefined ? [] : [`${id}-error`]),
  ].join(" ");

  return (
    <div class="editor-field">
      <label class="editor-label" for={`${id}-input`}>
        {copy.editor.labels.value}
      </label>
      <div class="editor-control">
        <div class="value-row">
          <input
            id={`${id}-input`}
            class="field mono"
            type="text"
            aria-invalid={props.error !== undefined ? true : undefined}
            aria-describedby={describedBy === "" ? undefined : describedBy}
            value={props.value}
            onInput={(event) => props.onInput(event.currentTarget.value)}
          />
          <InsertMenu onGenerate={props.onGenerate} />
        </div>
        {props.generated !== undefined && (
          <p class="editor-micro" id={`${id}-note`}>
            {props.frozenAt === undefined
              ? copy.generatedValue.note
              : `${copy.generatedValue.frozen(props.frozenAt)} · `}{" "}
            <button
              type="button"
              class="link-btn"
              onClick={() => props.onGenerate(props.generated?.kind ?? "uuid")}
            >
              {copy.actions.regenerate}
            </button>
          </p>
        )}
        {props.error !== undefined && (
          <p class="editor-error" role="alert" id={`${id}-error`}>
            {props.error}
          </p>
        )}
      </div>
    </div>
  );
}

function InsertMenu({
  onGenerate,
}: {
  onGenerate: (kind: "uuid" | "timestamp") => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const pick = (kind: "uuid" | "timestamp") => {
    onGenerate(kind);
    setOpen(false);
    buttonRef.current?.focus();
  };

  // Focus moves into the opened menu; Esc and item activation restore it.
  useEffect(() => {
    if (open) {
      menuRef.current?.querySelector("button")?.focus();
    }
  }, [open]);

  return (
    <div class="insert">
      <button
        type="button"
        class="insert-btn"
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {copy.editor.insert} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          class="menu-pop insert-menu"
          role="menu"
          aria-label={copy.editor.insert}
          ref={menuRef}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              buttonRef.current?.focus();
              return;
            }
            const items = [
              ...(menuRef.current?.querySelectorAll("button") ?? []),
            ];
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next = {
              ArrowDown: index + 1,
              ArrowUp: index - 1,
              Home: 0,
              End: -1,
            }[event.key];
            if (next !== undefined) {
              event.preventDefault();
              items[(next + items.length) % items.length]?.focus();
            }
          }}
          onFocusOut={(event) => {
            const into = event.relatedTarget;
            if (
              !(into instanceof Node) ||
              (menuRef.current?.contains(into) !== true &&
                into !== buttonRef.current)
            ) {
              setOpen(false);
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            class="menu-item"
            onClick={() => pick("uuid")}
          >
            {copy.editor.insertUuid}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            class="menu-item"
            onClick={() => pick("timestamp")}
          >
            {copy.editor.insertTimestamp}
          </button>
        </div>
      )}
    </div>
  );
}

import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Rule } from "../../core/model";
import { copy as editorCopy } from "../copy.editor";
import { closePopover, openPositionedPopover } from "./popover";
import "./ValueField.css";

interface ValueFieldProps {
  value: string;
  /** Present while the value is a generated literal; hand-editing clears it. */
  generated?: Rule["generated"] | undefined;
  error?: string | undefined;
  onInput: (value: string) => void;
  onGenerate?: ((kind: "uuid" | "timestamp") => void) | undefined;
}

/**
 * Value input with the Generate menu for frozen values. Both the typed and the
 * generated case carry a standing note under the field, so it is never silent
 * about what the value is: a hand-typed value is used verbatim, and Generate
 * writes an actual string — never a token — frozen at that moment, so neither is
 * a template that fills in per request. The field grows with its content so a
 * long credential reads from its start, and a pasted value is trimmed of the
 * surrounding whitespace the clipboard adds: that is a clipboard artifact, not
 * something the user typed.
 */
export function ValueField(props: ValueFieldProps) {
  const id = useId();
  const { generated, onGenerate } = props;
  const [newlineRemoved, setNewlineRemoved] = useState(false);
  const describedBy = [
    `${id}-note`,
    ...(newlineRemoved ? [`${id}-newline-note`] : []),
    ...(props.error === undefined ? [] : [`${id}-error`]),
  ].join(" ");

  return (
    <div class="editor-field">
      <label class="editor-label" for={`${id}-input`}>
        {editorCopy.editor.labels.value}
      </label>
      <div class="editor-control">
        <div class="value-row">
          <textarea
            id={`${id}-input`}
            class="field mono value-input"
            rows={2}
            wrap="soft"
            spellcheck={false}
            autocomplete="off"
            value={props.value}
            aria-invalid={props.error !== undefined ? true : undefined}
            aria-describedby={describedBy === "" ? undefined : describedBy}
            onInput={(event) => {
              const raw = event.currentTarget.value;
              if (/\r|\n/.test(raw)) {
                setNewlineRemoved(true);
                props.onInput(stripLineBreaks(raw));
              } else {
                setNewlineRemoved(false);
                props.onInput(raw);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !(event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData?.getData("text/plain") ?? "";
              const cleaned = stripLineBreaks(pasted.trim());
              if (cleaned === pasted) {
                return;
              }
              event.preventDefault();
              const field = event.currentTarget;
              const start = field.selectionStart;
              const end = field.selectionEnd;
              props.onInput(
                `${props.value.slice(0, start)}${cleaned}${props.value.slice(end)}`,
              );
              setNewlineRemoved(/\r|\n/.test(pasted.trim()));
            }}
          />
          {onGenerate !== undefined && <GenerateMenu onGenerate={onGenerate} />}
        </div>
        <p class="editor-micro" id={`${id}-note`}>
          {generated === undefined
            ? editorCopy.valueNote.literal
            : editorCopy.valueNote.frozen(generated.at)}
          {generated !== undefined && onGenerate !== undefined && (
            <>
              {" · "}
              <button
                type="button"
                class="link-btn"
                onClick={() => onGenerate(generated.kind)}
              >
                {editorCopy.actions.regenerate}
              </button>
            </>
          )}
        </p>
        {newlineRemoved && (
          <p class="editor-micro value-newline-note" id={`${id}-newline-note`}>
            {editorCopy.editor.newlineRemoved}
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

function stripLineBreaks(value: string): string {
  return value.replace(/(?:\r\n|\r|\n)+/g, " ");
}

function GenerateMenu({
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
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = buttonRef.current;
    if (!open || menu === null || trigger === null) {
      return;
    }
    openPositionedPopover(menu, trigger, "end");
    menu.querySelector("button")?.focus();
    return () => closePopover(menu);
  }, [open]);

  return (
    <div class="generate">
      <button
        type="button"
        class="generate-btn"
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {editorCopy.editor.generate} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          class="menu-pop generate-menu"
          popover="manual"
          role="menu"
          aria-label={editorCopy.editor.generate}
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
              Tab: event.shiftKey ? index - 1 : index + 1,
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
            {editorCopy.editor.generateUuid}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            class="menu-item"
            onClick={() => pick("timestamp")}
          >
            {editorCopy.editor.generateTimestamp}
          </button>
        </div>
      )}
    </div>
  );
}

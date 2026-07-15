import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Rule } from "../../core/model";
import { copy } from "../copy";
import {
  closePopover,
  openPositionedPopover,
  trapPopoverFocus,
} from "./popover";
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
  const [newlineRemoved, setNewlineRemoved] = useState(false);
  const describedBy = [
    ...(props.generated === undefined ? [] : [`${id}-note`]),
    ...(newlineRemoved ? [`${id}-newline-note`] : []),
    ...(props.error === undefined ? [] : [`${id}-error`]),
  ].join(" ");

  return (
    <div class="editor-field">
      <label class="editor-label" for={`${id}-input`}>
        {copy.editor.labels.value}
      </label>
      <div class="editor-control">
        <div class="value-row">
          <textarea
            id={`${id}-input`}
            class="field mono value-input"
            rows={4}
            wrap="soft"
            aria-invalid={props.error !== undefined ? true : undefined}
            aria-describedby={describedBy === "" ? undefined : describedBy}
            value={props.value}
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
              if (!/\r|\n/.test(pasted)) {
                return;
              }
              event.preventDefault();
              const field = event.currentTarget;
              const start = field.selectionStart;
              const end = field.selectionEnd;
              props.onInput(
                `${props.value.slice(0, start)}${stripLineBreaks(pasted)}${props.value.slice(end)}`,
              );
              setNewlineRemoved(true);
            }}
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
        {newlineRemoved && (
          <p class="editor-micro value-newline-note" id={`${id}-newline-note`}>
            {copy.editor.newlineRemoved}
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
          popover="manual"
          role="menu"
          aria-label={copy.editor.insert}
          ref={menuRef}
          onKeyDown={(event) => {
            if (event.key === "Tab" && menuRef.current !== null) {
              trapPopoverFocus(event, menuRef.current);
              return;
            }
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

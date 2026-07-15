import { useState } from "preact/hooks";
import { focusOnRemoval } from "../a11y/focus";
import { Truncate } from "./Truncate";
import "./ChipField.css";

interface ChipFieldProps {
  id: string;
  label?: string | undefined;
  inputLabel: string;
  placeholder: string;
  values: readonly string[];
  variant: "domain" | "grant";
  invalid?: boolean | undefined;
  removeLabel: (value: string) => string;
  onChange: (values: string[]) => void;
  onEnter?: (() => void) | undefined;
}

/** Shared host-chip input with one keyboard and focus-removal contract. */
export function ChipField(props: ChipFieldProps) {
  const [pending, setPending] = useState("");

  const commit = (raw: string) => {
    const value = raw.trim().toLowerCase();
    setPending("");
    if (value !== "" && !props.values.includes(value)) {
      props.onChange([...props.values, value]);
    }
  };
  const remove = (value: string) =>
    props.onChange(props.values.filter((candidate) => candidate !== value));

  return (
    <div class={`chip-field-wrap ${props.variant}-field`}>
      {props.label !== undefined && (
        <span class="chip-field-label" id={`${props.id}-label`}>
          {props.label}
        </span>
      )}
      <div class={`chip-field ${props.variant}-chips`}>
        {props.values.map((value) => (
          <span class={`chip-field-chip ${props.variant}-chip`} key={value}>
            <Truncate mode="middle" value={value} maxChars={40} class="mono" />
            <button
              type="button"
              class={`chip-field-x ${props.variant}-chip-x`}
              aria-label={props.removeLabel(value)}
              onClick={(event) => {
                focusOnRemoval(event.currentTarget);
                remove(value);
              }}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          class={`chip-field-input ${props.variant}-chip-input mono${
            props.onEnter === undefined ? "" : " editor-commit-field"
          }`}
          type="text"
          aria-label={props.inputLabel}
          aria-describedby={
            props.label === undefined ? undefined : `${props.id}-label`
          }
          aria-invalid={props.invalid === true ? true : undefined}
          placeholder={props.placeholder}
          value={pending}
          onInput={(event) => setPending(event.currentTarget.value)}
          onKeyDown={(event) => {
            const last = props.values.at(-1);
            if (event.key === "Backspace" && pending === "" && last) {
              remove(last);
              return;
            }
            if (event.key !== "Enter" && event.key !== ",") {
              return;
            }
            if (event.key === ",") {
              event.preventDefault();
              commit(pending);
              return;
            }
            if (props.onEnter !== undefined) {
              event.preventDefault();
              commit(pending);
              props.onEnter();
              return;
            }
            if (pending.trim() !== "") {
              event.preventDefault();
              commit(pending);
            }
          }}
          onBlur={() => commit(pending)}
        />
      </div>
    </div>
  );
}

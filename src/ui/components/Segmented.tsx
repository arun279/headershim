import type { ComponentChildren } from "preact";
import "./Segmented.css";

interface SegmentedOption<Value extends string> {
  value: Value;
  label: ComponentChildren;
}

interface SharedProps<Value extends string> {
  value: Value;
  options: readonly SegmentedOption<Value>[];
  label?: string | undefined;
  labelledBy?: string | undefined;
  onChange: (value: Value) => void;
}

type SegmentedProps<Value extends string> = SharedProps<Value> &
  (
    | { semantics: "radio"; name: string }
    | { semantics: "pressed"; name?: never }
  );

/** One inset-track skin, with the calling control's existing selection model. */
export function Segmented<Value extends string>(props: SegmentedProps<Value>) {
  if (props.semantics === "radio") {
    return (
      <div
        class="segmented"
        role="radiogroup"
        aria-label={props.label}
        aria-labelledby={props.labelledBy}
      >
        {props.options.map((option) => (
          <label class="segmented-option" key={option.value}>
            <input
              class="sr-only"
              type="radio"
              name={props.name}
              value={option.value}
              checked={props.value === option.value}
              onChange={() => props.onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  }

  return (
    <fieldset
      class="segmented"
      aria-label={props.label}
      aria-labelledby={props.labelledBy}
    >
      {props.options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={props.value === option.value}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

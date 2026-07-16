import type { Rule } from "../../core/model";
import { copy } from "../copy";
import { HeaderNameInput } from "./HeaderNameInput";
import { ValueField } from "./ValueField";

interface HeaderLineFieldsProps {
  header: string;
  value: string;
  remove: boolean;
  generated?: Rule["generated"] | undefined;
  frozenAt?: string | undefined;
  nameError?: string | undefined;
  valueError?: string | undefined;
  generatedActions?: boolean | undefined;
  nameInputRef?: ((element: HTMLInputElement | null) => void) | undefined;
  onHeaderInput: (value: string) => void;
  onValueInput: (value: string) => void;
  onGenerate?: ((kind: "uuid" | "timestamp") => void) | undefined;
}

/** The product's signature control: a header is authored as `name: value`. */
export function HeaderLineFields(props: HeaderLineFieldsProps) {
  return (
    <div class="editor-field header-line-field">
      <span class="editor-label">{copy.editor.labels.header}</span>
      <div class={props.remove ? "header-compose remove" : "header-compose"}>
        <HeaderNameInput
          value={props.header}
          error={props.nameError}
          autoFocus
          composed
          inputRef={props.nameInputRef}
          onInput={props.onHeaderInput}
        />
        {!props.remove && (
          <>
            <span class="header-seam" aria-hidden="true">
              :
            </span>
            <ValueField
              value={props.value}
              generated={props.generated}
              frozenAt={props.frozenAt}
              error={props.valueError}
              composed
              generatedActions={props.generatedActions}
              onInput={props.onValueInput}
              onGenerate={props.onGenerate}
            />
          </>
        )}
      </div>
    </div>
  );
}

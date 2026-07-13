import type { HeaderValidationError } from "../../core/headers";
import type { HeaderOp } from "../../core/model";
import { copy } from "../copy";

/**
 * Header/value field errors shared by the rule editor and the This-tab
 * composer: the required-field checks run before the store is asked, and the
 * save-time header validation errors map to the same inline copy in both.
 */
export interface HeaderFieldError {
  name?: string;
  operation?: string;
  value?: string;
}

export function headerValueEmptyErrors(draft: {
  operation: HeaderOp;
  header: string;
  value: string;
}): HeaderFieldError | undefined {
  const errors: HeaderFieldError = {};
  if (draft.header.trim() === "") {
    errors.name = copy.errors.headerNameRequired;
  }
  if (draft.operation !== "remove" && draft.value === "") {
    errors.value = copy.errors.valueRequired;
  }
  return Object.keys(errors).length === 0 ? undefined : errors;
}

export function headerErrorToFieldError(
  error: HeaderValidationError,
): HeaderFieldError {
  switch (error.kind) {
    case "name-required":
      return { name: copy.errors.headerNameRequired };
    case "name-invalid":
      return { name: copy.errors.headerNameInvalid };
    case "name-not-modifiable":
      return { name: copy.errors.headerNotModifiable };
    case "value-required":
      return { value: copy.errors.valueRequired };
    case "value-line-break":
      return { value: copy.errors.valueLineBreak };
    case "request-append-not-allowed":
      return { operation: copy.errors.appendDisallowed(error.header) };
  }
}

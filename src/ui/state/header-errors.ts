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

/**
 * What the save was refused for, in one reading. Editors route it to the field
 * that owns it; surfaces with no field to point at raise the same words in a
 * toast, so the two can never explain the same refusal differently.
 */
export function headerErrorMessage(error: HeaderValidationError): string {
  switch (error.kind) {
    case "name-required":
      return copy.errors.headerNameRequired;
    case "name-invalid":
      return copy.errors.headerNameInvalid;
    case "name-not-modifiable":
      return copy.errors.headerNotModifiable;
    case "value-required":
      return copy.errors.valueRequired;
    case "value-line-break":
      return copy.errors.valueLineBreak;
    case "request-append-not-allowed":
      return copy.errors.appendDisallowed(error.header);
  }
}

export function headerErrorToFieldError(
  error: HeaderValidationError,
): HeaderFieldError {
  const message = headerErrorMessage(error);
  switch (error.kind) {
    case "name-required":
    case "name-invalid":
    case "name-not-modifiable":
      return { name: message };
    case "value-required":
    case "value-line-break":
      return { value: message };
    case "request-append-not-allowed":
      return { operation: message };
  }
}

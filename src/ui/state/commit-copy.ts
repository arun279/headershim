import { copy } from "../copy";
import { headerErrorMessage } from "./header-errors";
import type { MutationError } from "./mutations";

/**
 * Maps a blocking save-time error to the toast copy the popup and options
 * surfaces both raise. Every kind is answered rather than defaulted: a save
 * that refuses without words is a save that looks like it worked, so the
 * compiler holds this switch to a reading for each one. The stale ids a
 * concurrent edit leaves behind are the exception — the re-rendered list is
 * already their answer.
 */
export function blockedCommitCopy(error: MutationError): string | undefined {
  switch (error.kind) {
    case "name-required":
    case "name-invalid":
    case "name-not-modifiable":
    case "value-required":
    case "value-line-break":
    case "request-append-not-allowed":
      return headerErrorMessage(error);
    case "enabled-rule-limit-exceeded":
      return copy.errors.ruleCap;
    case "regex-rule-limit-exceeded":
      return copy.errors.regexRuleCap;
    case "session-override-limit-exceeded":
      return copy.errors.sessionCap;
    case "doc-byte-limit-exceeded":
      return copy.errors.storageBudget;
    case "regex-invalid":
      // Chrome's validator distinguishes an oversized compilation from a
      // dialect error; the fix directions differ.
      return error.reason === "memoryLimitExceeded"
        ? copy.errors.regexOversize
        : copy.errors.regexInvalid;
    case "pattern-invalid":
      return copy.errors.patternInvalid;
    // A toast has no scope field to point at, so it names the gap, not the type.
    case "scope-empty":
      return copy.errors.scopeEmpty.all;
    case "profile-name-unavailable":
      return copy.options.profiles.nameTaken(error.name);
    case "store-unavailable":
      return copy.errors.saveFailed;
    case "not-found":
      return undefined;
  }
}

import { copy } from "../copy";
import type { MutationError } from "./mutations";

/**
 * Maps a blocking save-time error to the toast copy the popup and options
 * surfaces both raise. Errors without a shared surface (stale ids from a
 * concurrent edit) return undefined and resolve themselves on the next render.
 */
export function blockedCommitCopy(error: MutationError): string | undefined {
  switch (error.kind) {
    case "enabled-rule-limit-exceeded":
      return copy.errors.ruleCap;
    case "regex-rule-limit-exceeded":
      return copy.errors.regexRuleCap;
    case "doc-byte-limit-exceeded":
      return copy.errors.storageBudget;
    case "regex-invalid":
      // Chrome's validator distinguishes an oversized compilation from a
      // dialect error; the fix directions differ.
      return error.reason === "memoryLimitExceeded"
        ? copy.errors.regexOversize
        : copy.errors.regexInvalid;
    case "profile-name-unavailable":
      return copy.options.profiles.nameTaken(error.name);
    default:
      return undefined;
  }
}

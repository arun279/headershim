import type { ImportPlanWarning } from "../../core/codec/modheader";
import { copy, type Sentence } from "../copy";

/**
 * Maps one warning from an import plan to its display parts: a name (the rule it
 * concerns, or the dropped item it names) and the itemized sentence shown beside
 * it on the pre-apply summary.
 */
export function importWarningCopy(warning: ImportPlanWarning): {
  readonly name: string;
  readonly detail: Sentence;
} {
  const strings = copy.options.importExport.warnings;
  switch (warning.kind) {
    case "credential":
      return {
        name: warning.ruleName,
        detail: strings.credentialHeader(warning.header),
      };
    case "security-response":
      return {
        name: warning.ruleName,
        detail: strings.securityResponseHeader(warning.header),
      };
    case "request-append-degraded":
      return {
        name: warning.ruleName,
        detail: strings.appendDegraded(warning.header),
      };
    case "cookie-semantics-degraded":
      return { name: warning.ruleName, detail: [strings.cookieSemantics] };
    case "set-cookie-semantics-degraded":
      return { name: warning.ruleName, detail: [strings.setCookieSemantics] };
    case "csp-semantics-degraded":
      return { name: warning.ruleName, detail: [strings.cspSemantics] };
    case "invalid-regex":
      return {
        name: warning.ruleName,
        detail: strings.invalidRegex(warning.pattern),
      };
    case "dynamic-token":
      return { name: warning.ruleName, detail: [strings.dynamicToken] };
    case "exclude-url-filter-dropped":
      return { name: warning.value, detail: [strings.droppedExcludeUrl] };
    case "initiator-domain-filter-dropped":
      return { name: warning.value, detail: [strings.droppedInitiatorDomain] };
    case "tab-filter-dropped":
    case "tab-group-filter-dropped":
    case "window-filter-dropped":
    case "time-filter-dropped":
      return { name: warning.value, detail: [strings.droppedTab] };
    case "url-replacement-dropped":
      return { name: warning.value, detail: [strings.droppedUrlReplacement] };
  }
}

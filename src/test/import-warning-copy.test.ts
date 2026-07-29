import { describe, expect, it } from "vitest";
import type { ModHeaderImportWarning } from "../core/codec/modheader";
import { copy, sentenceText } from "../ui/copy";
import { importWarningCopy } from "../ui/state/import-warning-copy";

const strings = copy.options.importExport.warnings;

const cases: {
  warning: ModHeaderImportWarning;
  name: string;
  detail: string;
}[] = [
  {
    warning: {
      kind: "request-append-degraded",
      ruleName: "auth",
      header: "x-token",
    },
    name: "auth",
    detail: sentenceText(strings.appendDegraded("x-token")),
  },
  {
    warning: { kind: "cookie-semantics-degraded", ruleName: "session" },
    name: "session",
    detail: strings.cookieSemantics,
  },
  {
    warning: { kind: "set-cookie-semantics-degraded", ruleName: "theme" },
    name: "theme",
    detail: strings.setCookieSemantics,
  },
  {
    warning: { kind: "csp-semantics-degraded", ruleName: "policy" },
    name: "policy",
    detail: strings.cspSemantics,
  },
  {
    warning: { kind: "invalid-regex", ruleName: "r-04", pattern: "(?=x)" },
    name: "r-04",
    detail: sentenceText(strings.invalidRegex("(?=x)")),
  },
  {
    warning: {
      kind: "dynamic-token",
      ruleName: "token rule",
      profileIndex: 0,
      ruleIndex: 0,
      tokens: ["uuid"],
    },
    name: "token rule",
    detail: strings.dynamicToken,
  },
  {
    warning: {
      kind: "exclude-url-filter-dropped",
      ruleName: "x",
      value: "logout",
    },
    name: "logout",
    detail: strings.droppedExcludeUrl,
  },
  {
    warning: {
      kind: "initiator-domain-filter-dropped",
      ruleName: "x",
      value: "app.example.com",
    },
    name: "app.example.com",
    detail: strings.droppedInitiatorDomain,
  },
  {
    warning: { kind: "tab-filter-dropped", ruleName: "x", value: "42" },
    name: "42",
    detail: strings.droppedTab,
  },
  {
    warning: { kind: "tab-group-filter-dropped", ruleName: "x", value: "7" },
    name: "7",
    detail: strings.droppedTab,
  },
  {
    warning: { kind: "window-filter-dropped", ruleName: "x", value: "3" },
    name: "3",
    detail: strings.droppedTab,
  },
  {
    warning: {
      kind: "time-filter-dropped",
      ruleName: "x",
      value: "business hours",
    },
    name: "business hours",
    detail: strings.droppedTab,
  },
  {
    warning: {
      kind: "url-replacement-dropped",
      ruleName: "x",
      value: "https://old.example.com/",
    },
    name: "https://old.example.com/",
    detail: strings.droppedUrlReplacement,
  },
];

describe("importWarningCopy", () => {
  it.each(cases)("names $warning.kind", ({ warning, name, detail }) => {
    const result = importWarningCopy(warning);
    expect(result.name).toBe(name);
    expect(sentenceText(result.detail)).toBe(detail);
  });
});

import type { DnrRule } from "../core/compile";
import type { DnrAdapter } from "../platform/dnr";

const baseRule: DnrRule = {
  id: 910_001,
  priority: 1,
  action: {
    type: "modifyHeaders",
    requestHeaders: [{ header: "x-contract", operation: "set", value: "yes" }],
  },
  condition: { resourceTypes: ["xmlhttprequest"] },
};

export interface DnrContractCase {
  readonly name: string;
  readonly rule: DnrRule;
  readonly additionalRules?: readonly DnrRule[];
  readonly accepted: boolean;
  readonly browserOnly?: true;
}

export const DNR_CONTRACT_CASES: readonly DnrContractCase[] = [
  {
    name: "accepts an ASCII anchored URL filter",
    rule: {
      ...baseRule,
      condition: {
        ...baseRule.condition,
        urlFilter: "||example.com^",
      },
    },
    accepted: true,
  },
  {
    name: "rejects an invalid header name",
    rule: {
      ...baseRule,
      id: baseRule.id + 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "invalid header", operation: "set", value: "yes" },
        ],
      },
    },
    accepted: false,
  },
  {
    name: "rejects a line break in a header value",
    rule: {
      ...baseRule,
      id: baseRule.id + 2,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "x-contract", operation: "set", value: "yes\r\nno" },
        ],
      },
    },
    accepted: false,
  },
  {
    name: "rejects append for a request header outside the allowlist",
    rule: {
      ...baseRule,
      id: baseRule.id + 3,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "x-contract", operation: "append", value: "yes" },
        ],
      },
    },
    accepted: false,
  },
  {
    name: "rejects a non-ASCII URL filter",
    rule: {
      ...baseRule,
      id: baseRule.id + 4,
      condition: {
        ...baseRule.condition,
        urlFilter: "||exämple.com^",
      },
    },
    accepted: false,
  },
  {
    name: "rejects a wildcard after a domain anchor",
    rule: {
      ...baseRule,
      id: baseRule.id + 5,
      condition: { ...baseRule.condition, urlFilter: "||*" },
    },
    accepted: false,
  },
  {
    name: "rejects an empty resource type list",
    rule: {
      ...baseRule,
      id: baseRule.id + 6,
      condition: { resourceTypes: [] },
    },
    accepted: false,
  },
  {
    name: "rejects a non-ASCII request domain",
    rule: {
      ...baseRule,
      id: baseRule.id + 7,
      condition: {
        ...baseRule.condition,
        requestDomains: ["exämple.com"],
      },
    },
    accepted: false,
  },
  {
    name: "rejects a regular expression with lookahead",
    rule: {
      ...baseRule,
      id: baseRule.id + 8,
      condition: {
        ...baseRule.condition,
        regexFilter: "^https://(?=example)",
      },
    },
    accepted: false,
    browserOnly: true,
  },
  {
    name: "rejects an empty regular expression filter",
    rule: {
      ...baseRule,
      id: baseRule.id + 9,
      condition: {
        ...baseRule.condition,
        regexFilter: "",
      },
    },
    accepted: false,
  },
  {
    name: "rejects a non-ASCII regular expression filter",
    rule: {
      ...baseRule,
      id: baseRule.id + 10,
      condition: {
        ...baseRule.condition,
        regexFilter: "é",
      },
    },
    accepted: false,
  },
  {
    name: "accepts an uppercase allowlisted request header for append",
    rule: {
      ...baseRule,
      id: baseRule.id + 11,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Cookie", operation: "append", value: "yes" },
        ],
      },
    },
    accepted: true,
  },
  {
    name: "rejects a null byte in a header value",
    rule: {
      ...baseRule,
      id: baseRule.id + 12,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "x-contract", operation: "set", value: "yes\0no" },
        ],
      },
    },
    accepted: false,
  },
  {
    name: "rejects a zero rule identifier",
    rule: { ...baseRule, id: 0 },
    accepted: false,
  },
  {
    name: "rejects a fractional rule identifier",
    rule: { ...baseRule, id: 1.5 },
    accepted: false,
  },
  {
    name: "rejects duplicate rule identifiers",
    rule: { ...baseRule, id: baseRule.id + 15 },
    additionalRules: [{ ...baseRule, id: baseRule.id + 15 }],
    accepted: false,
  },
  {
    name: "rejects a zero priority",
    rule: { ...baseRule, id: baseRule.id + 16, priority: 0 },
    accepted: false,
  },
  {
    name: "rejects an empty header modification list",
    rule: {
      ...baseRule,
      id: baseRule.id + 17,
      action: { type: "modifyHeaders", requestHeaders: [] },
    },
    accepted: false,
  },
  {
    name: "rejects an empty request domain list",
    rule: {
      ...baseRule,
      id: baseRule.id + 18,
      condition: { ...baseRule.condition, requestDomains: [] },
    },
    accepted: false,
  },
  {
    name: "rejects an empty initiator domain list",
    rule: {
      ...baseRule,
      id: baseRule.id + 19,
      condition: { ...baseRule.condition, initiatorDomains: [] },
    },
    accepted: false,
  },
  {
    name: "rejects a non-ASCII initiator domain",
    rule: {
      ...baseRule,
      id: baseRule.id + 20,
      condition: {
        ...baseRule.condition,
        initiatorDomains: ["exämple.com"],
      },
    },
    accepted: false,
  },
  {
    name: "rejects combined URL and regular expression filters",
    rule: {
      ...baseRule,
      id: baseRule.id + 21,
      condition: {
        ...baseRule.condition,
        urlFilter: "example",
        regexFilter: "example",
      },
    },
    accepted: false,
  },
  {
    name: "rejects a rule without header modifications",
    rule: {
      ...baseRule,
      id: baseRule.id + 22,
      action: { type: "modifyHeaders" },
    },
    accepted: false,
  },
  {
    name: "rejects a remove operation with a value",
    rule: {
      ...baseRule,
      id: baseRule.id + 23,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "x-contract", operation: "remove", value: "yes" },
        ],
      },
    },
    accepted: false,
  },
  {
    name: "rejects a set operation without a value",
    rule: {
      ...baseRule,
      id: baseRule.id + 24,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "x-contract", operation: "set" }],
      },
    },
    accepted: false,
  },
  {
    name: "accepts an escaped hyphen in a regular expression",
    rule: {
      ...baseRule,
      id: baseRule.id + 25,
      condition: { regexFilter: "^https://api\\-v1\\.example\\.com/" },
    },
    accepted: true,
  },
  {
    name: "accepts a regular expression inline case flag",
    rule: {
      ...baseRule,
      id: baseRule.id + 26,
      condition: { regexFilter: "(?i)^https://example" },
    },
    accepted: true,
  },
  {
    name: "rejects a fractional priority",
    rule: { ...baseRule, id: baseRule.id + 27, priority: 1.5 },
    accepted: false,
  },
  {
    name: "rejects an empty response header modification list",
    rule: {
      ...baseRule,
      id: baseRule.id + 28,
      action: { type: "modifyHeaders", responseHeaders: [] },
    },
    accepted: false,
  },
  {
    name: "rejects an invalid response header name",
    rule: {
      ...baseRule,
      id: baseRule.id + 29,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "invalid header", operation: "set", value: "yes" },
        ],
      },
    },
    accepted: false,
  },
  {
    name: "rejects a line break in a response header value",
    rule: {
      ...baseRule,
      id: baseRule.id + 30,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-contract", operation: "set", value: "yes\r\nno" },
        ],
      },
    },
    accepted: false,
  },
  {
    name: "rejects a response header remove operation with a value",
    rule: {
      ...baseRule,
      id: baseRule.id + 31,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-contract", operation: "remove", value: "yes" },
        ],
      },
    },
    accepted: false,
  },
  {
    name: "accepts append for an arbitrary response header",
    rule: {
      ...baseRule,
      id: baseRule.id + 32,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-contract", operation: "append", value: "yes" },
        ],
      },
    },
    accepted: true,
  },
  {
    name: "accepts an empty request domain",
    rule: {
      ...baseRule,
      id: baseRule.id + 33,
      condition: { ...baseRule.condition, requestDomains: [""] },
    },
    accepted: true,
  },
  {
    name: "accepts an empty initiator domain",
    rule: {
      ...baseRule,
      id: baseRule.id + 34,
      condition: { ...baseRule.condition, initiatorDomains: [""] },
    },
    accepted: true,
  },
  {
    name: "rejects an empty URL filter",
    rule: {
      ...baseRule,
      id: baseRule.id + 35,
      condition: { ...baseRule.condition, urlFilter: "" },
    },
    accepted: false,
  },
  {
    name: "rejects tab identifiers in a dynamic rule",
    rule: {
      ...baseRule,
      id: baseRule.id + 36,
      condition: { ...baseRule.condition, tabIds: [1] },
    },
    accepted: false,
  },
  {
    name: "rejects a regular expression with a backreference",
    rule: {
      ...baseRule,
      id: baseRule.id + 37,
      condition: { ...baseRule.condition, regexFilter: "(a)\\1" },
    },
    accepted: false,
    browserOnly: true,
  },
  {
    name: "rejects an unclosed regular expression character class",
    rule: {
      ...baseRule,
      id: baseRule.id + 38,
      condition: { ...baseRule.condition, regexFilter: "[" },
    },
    accepted: false,
    browserOnly: true,
  },
  {
    name: "rejects a regular expression with a bare quantifier",
    rule: {
      ...baseRule,
      id: baseRule.id + 40,
      condition: { ...baseRule.condition, regexFilter: "*" },
    },
    accepted: false,
    browserOnly: true,
  },
  {
    name: "rejects a regular expression with a reversed repetition range",
    rule: {
      ...baseRule,
      id: baseRule.id + 41,
      condition: { ...baseRule.condition, regexFilter: "a{2,1}" },
    },
    accepted: false,
    browserOnly: true,
  },
  {
    name: "rejects a regular expression over the repetition-size limit",
    rule: {
      ...baseRule,
      id: baseRule.id + 42,
      condition: {
        ...baseRule.condition,
        regexFilter: "(?:a{100}){100}",
      },
    },
    accepted: false,
    browserOnly: true,
  },
  {
    name: "accepts a named regular expression group",
    rule: {
      ...baseRule,
      id: baseRule.id + 39,
      condition: { ...baseRule.condition, regexFilter: "(?<name>a)" },
    },
    accepted: true,
    browserOnly: true,
  },
];

export interface DnrRegexContractCase {
  readonly name: string;
  readonly regex: string;
  readonly supported: boolean;
  readonly reason?: "memoryLimitExceeded" | "syntaxError";
}

export const DNR_REGEX_CONTRACT_CASES: readonly DnrRegexContractCase[] = [
  {
    name: "accepts an anchored regular expression",
    regex: "^https://example\\.com/",
    supported: true,
  },
  {
    name: "accepts an empty regular expression in preflight",
    regex: "",
    supported: true,
  },
  {
    name: "accepts a Unicode regular expression in preflight",
    regex: "é",
    supported: true,
  },
  {
    name: "rejects lookahead in preflight",
    regex: "(?=unsupported)",
    supported: false,
    reason: "syntaxError",
  },
  {
    name: "rejects a backreference in preflight",
    regex: "(a)\\1",
    supported: false,
    reason: "syntaxError",
  },
  {
    name: "rejects an oversized regular expression in preflight",
    regex: "[0-9]+".repeat(1_000),
    supported: false,
    reason: "memoryLimitExceeded",
  },
  {
    name: "rejects an unclosed character class in preflight",
    regex: "[",
    supported: false,
    reason: "syntaxError",
  },
  {
    name: "rejects a bare quantifier in preflight",
    regex: "*",
    supported: false,
    reason: "syntaxError",
  },
  {
    name: "rejects a reversed repetition range in preflight",
    regex: "a{2,1}",
    supported: false,
    reason: "syntaxError",
  },
  {
    name: "rejects a compact expression over the repetition-size limit",
    regex: "(?:a{100}){100}",
    supported: false,
    reason: "syntaxError",
  },
  {
    name: "accepts a named group in preflight",
    regex: "(?<name>a)",
    supported: true,
  },
  {
    name: "rejects a 128-character literal in preflight",
    regex: "a".repeat(128),
    supported: false,
    reason: "memoryLimitExceeded",
  },
];

export function contractRuleBatch(contractCase: DnrContractCase): DnrRule[] {
  return structuredClone([
    contractCase.rule,
    ...(contractCase.additionalRules ?? []),
  ]);
}

export async function exerciseDnrContract(
  adapter: DnrAdapter,
  contractCase: DnrContractCase,
): Promise<void> {
  const update = { addRules: contractRuleBatch(contractCase) };
  if (contractCase.accepted) {
    await adapter.updateDynamicRules(update);
    const installed = await adapter.getDynamicRules();
    if (
      update.addRules.some(
        (rule) => !installed.some((candidate) => candidate.id === rule.id),
      )
    ) {
      throw new Error(`DNR discarded accepted rule: ${contractCase.name}`);
    }
    return;
  }
  await adapter.updateDynamicRules(update).then(
    () => {
      throw new Error(`DNR accepted invalid rule: ${contractCase.name}`);
    },
    () => undefined,
  );
}

export function contractBaseRule(id: number): DnrRule {
  return { ...baseRule, id };
}

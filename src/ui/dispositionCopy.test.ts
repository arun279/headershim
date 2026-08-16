import { describe, expect, it } from "vitest";
import { ALL_SITES_ORIGIN } from "../core/grants";
import type { HeaderOp } from "../core/model";
import type { AbsentReason, UncompilableReason } from "../core/verdict";
import { copy, siteAccessCopy } from "./copy";
import {
  caveatNote,
  controlTone,
  grantAction,
  outcomeReason,
  outcomeTone,
  type Tone,
  verb,
} from "./dispositionCopy";
import type {
  Caveat,
  FleetOutcome,
  TabOutcome,
  Undecidable,
} from "./state/project";

type Outcome = TabOutcome | FleetOutcome;

const OUTCOMES = {
  runs: { kind: "runs" },
  "runs-if-matched": {
    kind: "runs-if-matched",
    undecidable: "url-filter",
  },
  shadowed: {
    kind: "shadowed",
    by: "rule:winner",
    label: "winning rule",
  },
  elsewhere: { kind: "elsewhere" },
  pending: { kind: "pending", scope: { kind: "broad" } },
  absent: { kind: "absent", reason: { kind: "off" } },
  placed: {
    kind: "placed",
    scope: { kind: "broad" },
  },
  partial: {
    kind: "partial",
    scope: { kind: "broad" },
    reason: {
      kind: "ungranted",
      missing: ["*://*.example.com/*"],
    },
  },
} as const satisfies Record<Outcome["kind"], Outcome>;

const ABSENT_REASONS = {
  off: { kind: "off" },
  "other-profile": {
    kind: "other-profile",
    profileName: "Staging",
  },
  refused: { kind: "refused", reason: "header" },
  ungranted: {
    kind: "ungranted",
    missing: ["*://*.example.com/*"],
  },
  "ungranted-initiator": {
    kind: "ungranted-initiator",
    missing: ["*://*.initiator.example/*"],
  },
  "over-limit": { kind: "over-limit", limit: "dynamic" },
} as const satisfies Record<AbsentReason["kind"], AbsentReason>;

const OUTCOME_TONE_CASES = {
  runs: { outcome: OUTCOMES.runs, expected: "live" },
  "runs-if-matched": {
    outcome: OUTCOMES["runs-if-matched"],
    expected: "doubt",
  },
  shadowed: { outcome: OUTCOMES.shadowed, expected: "rest" },
  elsewhere: { outcome: OUTCOMES.elsewhere, expected: "rest" },
  pending: { outcome: OUTCOMES.pending, expected: "amber" },
  absent: { outcome: OUTCOMES.absent, expected: "rest" },
  placed: { outcome: OUTCOMES.placed, expected: "live" },
  partial: { outcome: OUTCOMES.partial, expected: "amber" },
} as const satisfies Record<
  Outcome["kind"],
  { readonly outcome: Outcome; readonly expected: Tone }
>;

const ABSENT_TONE_CASES = {
  off: { reason: ABSENT_REASONS.off, expected: "rest" },
  "other-profile": {
    reason: ABSENT_REASONS["other-profile"],
    expected: "rest",
  },
  refused: { reason: ABSENT_REASONS.refused, expected: "stop" },
  ungranted: { reason: ABSENT_REASONS.ungranted, expected: "amber" },
  "ungranted-initiator": {
    reason: ABSENT_REASONS["ungranted-initiator"],
    expected: "amber",
  },
  "over-limit": {
    reason: ABSENT_REASONS["over-limit"],
    expected: "stop",
  },
} as const satisfies Record<
  AbsentReason["kind"],
  {
    readonly reason: AbsentReason;
    readonly expected: Tone;
  }
>;

const UNDECIDABLE_OUTCOMES = {
  "url-filter": {
    kind: "runs-if-matched",
    undecidable: "url-filter",
  },
  "regex-filter": {
    kind: "runs-if-matched",
    undecidable: "regex-filter",
  },
  "initiator-domains": {
    kind: "runs-if-matched",
    undecidable: "initiator-domains",
  },
} as const satisfies Record<
  Undecidable,
  Extract<TabOutcome, { readonly kind: "runs-if-matched" }>
>;

const REFUSAL_CASES = {
  header: {
    reason: "header",
    expected: copy.readout.refusedReason.header,
  },
  append: {
    reason: "append",
    expected: copy.readout.refusedReason.append,
  },
  value: {
    reason: "value",
    expected: copy.readout.refusedReason.value,
  },
  pattern: {
    reason: "pattern",
    expected: copy.readout.refusedReason.pattern,
  },
  regex: {
    reason: "regex",
    expected: copy.readout.refusedReason.regex,
  },
  domains: {
    reason: "domains",
    expected: copy.readout.refusedReason.domains,
  },
} as const satisfies Record<
  UncompilableReason,
  { readonly reason: UncompilableReason; readonly expected: string }
>;

type Limit = Extract<AbsentReason, { readonly kind: "over-limit" }>["limit"];

const LIMIT_CASES = {
  dynamic: {
    limit: "dynamic",
    expected: copy.errors.dynamicRuleCap,
  },
  regex: {
    limit: "regex",
    expected: copy.errors.regexRuleCap,
  },
  session: {
    limit: "session",
    expected: copy.errors.sessionCap,
  },
} as const satisfies Record<
  Limit,
  { readonly limit: Limit; readonly expected: string }
>;

const CAVEAT_CASES = {
  transport: {
    caveat: "transport",
    expected: copy.readout.refusedReason.host,
  },
  "network-managed": {
    caveat: "network-managed",
    expected: copy.readout.managedReason,
  },
  "security-response": {
    caveat: "security-response",
    expected: copy.advisories.securityResponse,
  },
} as const satisfies Record<
  Caveat,
  { readonly caveat: Caveat; readonly expected: string }
>;

const VERB_CASES = {
  set: {
    operation: "set",
    active: copy.readout.verb.set,
    held: copy.readout.heldVerb.set,
  },
  append: {
    operation: "append",
    active: copy.readout.verb.append,
    held: copy.readout.heldVerb.append,
  },
  remove: {
    operation: "remove",
    active: copy.readout.verb.remove,
    held: copy.readout.heldVerb.remove,
  },
} as const satisfies Record<
  HeaderOp,
  {
    readonly operation: HeaderOp;
    readonly active: string;
    readonly held: string;
  }
>;

const ACTIVE_OUTCOMES = {
  runs: OUTCOMES.runs,
  "runs-if-matched": OUTCOMES["runs-if-matched"],
  placed: OUTCOMES.placed,
  partial: OUTCOMES.partial,
} as const satisfies Record<
  Extract<Outcome["kind"], "runs" | "runs-if-matched" | "placed" | "partial">,
  Outcome
>;

const HELD_OUTCOMES = {
  shadowed: OUTCOMES.shadowed,
  elsewhere: OUTCOMES.elsewhere,
  pending: OUTCOMES.pending,
  absent: OUTCOMES.absent,
} as const satisfies Record<
  Exclude<Outcome["kind"], keyof typeof ACTIVE_OUTCOMES>,
  Outcome
>;

const BROAD_GRANT_CASES = [
  { reason: { kind: "ungranted", missing: [ALL_SITES_ORIGIN] } },
  { reason: { kind: "ungranted-initiator", missing: [ALL_SITES_ORIGIN] } },
  { reason: { kind: "ungranted", missing: ["<all_urls>"] } },
  {
    reason: {
      kind: "ungranted-initiator",
      missing: ["*://*.example.com/*", ALL_SITES_ORIGIN],
    },
  },
] as const satisfies readonly {
  readonly reason: Extract<
    AbsentReason,
    { readonly kind: "ungranted" | "ungranted-initiator" }
  >;
}[];

function absent(reason: AbsentReason): Outcome {
  return { kind: "absent", reason };
}

describe("outcomeTone", () => {
  it.each(Object.values(OUTCOME_TONE_CASES))(
    "maps $outcome.kind to $expected",
    ({ outcome, expected }) => {
      expect(outcomeTone(outcome)).toBe(expected);
    },
  );

  it.each(Object.values(ABSENT_TONE_CASES))(
    "maps absent:$reason.kind to $expected",
    ({ reason, expected }) => {
      expect(outcomeTone(absent(reason))).toBe(expected);
    },
  );
});

describe("outcomeReason", () => {
  it.each([
    OUTCOMES.runs,
    OUTCOMES.elsewhere,
    OUTCOMES.placed,
    OUTCOMES.absent,
  ] satisfies readonly Outcome[])("omits a reason for $kind", (outcome) => {
    expect(outcomeReason(outcome, false)).toBeUndefined();
  });

  it.each(Object.values(UNDECIDABLE_OUTCOMES))(
    "uses the matcher reason for $undecidable",
    (outcome) => {
      expect(outcomeReason(outcome, false)).toEqual({
        tone: "doubt",
        label: copy.readout.unconfirmedReason,
      });
    },
  );

  it("names the rule that shadows this one", () => {
    expect(outcomeReason(OUTCOMES.shadowed, false)).toEqual({
      tone: "rest",
      label: copy.readout.overriddenBy("winning rule"),
    });
  });

  it("states that a partial installation runs on its installed scope", () => {
    expect(outcomeReason(OUTCOMES.partial, false)).toEqual({
      tone: "amber",
      label: copy.readout.partiallyRunning,
    });
    expect(controlTone(OUTCOMES.partial, false)).toBeUndefined();
    expect(controlTone(OUTCOMES.partial, true)).toBe("paused");
  });

  it("names the inactive profile", () => {
    expect(
      outcomeReason(absent(ABSENT_REASONS["other-profile"]), false),
    ).toEqual({
      tone: "rest",
      label: "in Staging, not the active profile",
    });
  });

  it.each(Object.values(REFUSAL_CASES))(
    "maps refused:$reason",
    ({ reason, expected }) => {
      expect(outcomeReason(absent({ kind: "refused", reason }), false)).toEqual(
        {
          tone: "stop",
          label: expected,
        },
      );
    },
  );

  it.each([
    {
      temporary: true,
      expected: copy.readout.needsAccessReason(true),
    },
    {
      temporary: false,
      expected: copy.readout.needsAccessReason(false),
    },
  ])("maps missing access when temporary is $temporary", (testCase) => {
    expect(
      outcomeReason(absent(ABSENT_REASONS.ungranted), testCase.temporary),
    ).toEqual({
      tone: "amber",
      label: testCase.expected,
    });
  });

  it("maps missing initiator access independently of temporary access", () => {
    for (const temporary of [false, true]) {
      expect(
        outcomeReason(absent(ABSENT_REASONS["ungranted-initiator"]), temporary),
      ).toEqual({
        tone: "amber",
        label: siteAccessCopy.initiatorNote,
      });
    }
  });

  it.each(Object.values(LIMIT_CASES))(
    "maps over-limit:$limit",
    ({ limit, expected }) => {
      expect(
        outcomeReason(absent({ kind: "over-limit", limit }), false),
      ).toEqual({
        tone: "stop",
        label: expected,
      });
    },
  );
});

describe("caveatNote", () => {
  it("omits a note when there are no caveats", () => {
    expect(caveatNote([])).toBeUndefined();
  });

  it.each(Object.values(CAVEAT_CASES))(
    "maps $caveat",
    ({ caveat, expected }) => {
      expect(caveatNote([caveat])).toBe(expected);
    },
  );

  it("reports the first caveat", () => {
    expect(
      caveatNote([
        CAVEAT_CASES["network-managed"].caveat,
        CAVEAT_CASES.transport.caveat,
      ]),
    ).toBe(copy.readout.managedReason);
  });

  it("names a removed security response header", () => {
    expect(
      caveatNote(["security-response"], "content-security-policy", "remove"),
    ).toBe(copy.advisories.removesSecurityResponse("content-security-policy"));
  });
});

describe("grantAction", () => {
  it.each(
    Object.values(OUTCOMES).filter((outcome) => outcome.kind !== "partial"),
  )("omits an action for representative $kind", (outcome) => {
    expect(grantAction(outcome)).toBeUndefined();
  });

  it("offers the missing grant for a partial installation", () => {
    expect(grantAction(OUTCOMES.partial)).toEqual({
      label: copy.readout.grant,
      origins: ["*://*.example.com/*"],
    });
  });

  it.each([
    ABSENT_REASONS["other-profile"],
    ABSENT_REASONS.refused,
    ABSENT_REASONS["over-limit"],
  ] satisfies readonly AbsentReason[])(
    "omits an action for absent:$kind",
    (reason) => {
      expect(grantAction(absent(reason))).toBeUndefined();
    },
  );

  it.each([
    ABSENT_REASONS.ungranted,
    ABSENT_REASONS["ungranted-initiator"],
  ] satisfies readonly AbsentReason[])(
    "offers the exact missing origins for absent:$kind",
    (reason) => {
      expect(grantAction(absent(reason))).toEqual({
        label: copy.readout.grant,
        origins: reason.missing,
      });
    },
  );

  it.each(BROAD_GRANT_CASES)(
    "names broad access for absent:$reason.kind",
    ({ reason }) => {
      expect(grantAction(absent(reason))).toEqual({
        label: copy.readout.grantAllSites,
        origins: reason.missing,
      });
    },
  );
});

describe("verb", () => {
  it("uses active verbs only for outcomes Chrome may run", () => {
    for (const outcome of Object.values(ACTIVE_OUTCOMES)) {
      for (const { operation, active } of Object.values(VERB_CASES)) {
        expect(verb(outcome, operation, false)).toBe(active);
      }
    }
  });

  it("uses held verbs for outcomes Chrome cannot run here", () => {
    for (const outcome of Object.values(HELD_OUTCOMES)) {
      for (const { operation, held } of Object.values(VERB_CASES)) {
        expect(verb(outcome, operation, false)).toBe(held);
      }
    }
  });

  it("uses held verbs for every outcome while paused", () => {
    for (const outcome of Object.values(OUTCOMES)) {
      for (const { operation, held } of Object.values(VERB_CASES)) {
        expect(verb(outcome, operation, true)).toBe(held);
      }
    }
  });
});

import { isAllSitesOrigin } from "../core/grants";
import { normalizeHeaderName } from "../core/headers";
import type { HeaderOp } from "../core/model";
import type { AbsentReason } from "../core/verdict";
import { copy, siteAccessCopy } from "./copy";
import type { Caveat, FleetOutcome, TabOutcome } from "./state/project";

export type Tone = "live" | "doubt" | "amber" | "stop" | "rest";

type Outcome = TabOutcome | FleetOutcome;
type OutcomeKind = Outcome["kind"];

const OUTCOMES = {
  runs: { tone: "live", active: true },
  "runs-if-matched": {
    tone: "doubt",
    active: true,
  },
  shadowed: { tone: "rest", active: false },
  elsewhere: { tone: "rest", active: false },
  pending: { tone: "amber", active: false },
  absent: { tone: "rest", active: false },
  placed: { tone: "live", active: true },
  partial: { tone: "amber", active: true },
} as const satisfies Record<
  OutcomeKind,
  {
    readonly tone: Tone;
    readonly active: boolean;
  }
>;

const ABSENT_TONES = {
  off: "rest",
  "other-profile": "rest",
  refused: "stop",
  ungranted: "amber",
  "ungranted-initiator": "amber",
  "over-limit": "stop",
} as const satisfies Record<AbsentReason["kind"], Tone>;

/**
 * Whether a change is running now, could run once its match resolves, or is a
 * grant away from running: the cases worth stating a wire consequence for. A
 * refusal, an over-limit rule, and a rule shadowed by another are not, since
 * nothing the reader does on this row changes that. The popup's transport
 * count and every surface that renders a transport caveat gate on this, so
 * they can never disagree about which changes it is worth naming a wire
 * consequence for.
 */
export function canRun(outcome: Outcome): boolean {
  if (outcome.kind === "shadowed") return false;
  if (outcome.kind === "absent" || outcome.kind === "partial") {
    return (
      outcome.reason.kind === "ungranted" ||
      outcome.reason.kind === "ungranted-initiator"
    );
  }
  return true;
}

export function outcomeTone(outcome: Outcome): Tone {
  return outcome.kind === "absent"
    ? ABSENT_TONES[outcome.reason.kind]
    : OUTCOMES[outcome.kind].tone;
}

export function displayTone(
  outcome: Outcome,
  caveats: readonly Caveat[],
): Tone {
  const tone = outcomeTone(outcome);
  return (tone === "live" || tone === "doubt") && caveats.length > 0
    ? "amber"
    : tone;
}

const CONTROL_TONES = {
  live: undefined,
  doubt: undefined,
  amber: "blocked",
  stop: "blocked",
  rest: "inert",
} as const satisfies Record<Tone, "blocked" | "inert" | undefined>;

export function controlTone(
  outcome: Outcome,
  paused: boolean,
): "paused" | "blocked" | "inert" | undefined {
  return paused && OUTCOMES[outcome.kind].active
    ? "paused"
    : outcome.kind === "partial"
      ? undefined
      : CONTROL_TONES[outcomeTone(outcome)];
}

const REFUSAL_COPY = {
  header: copy.readout.refusedReason.header,
  append: copy.readout.refusedReason.append,
  value: copy.readout.refusedReason.value,
  pattern: copy.readout.refusedReason.pattern,
  regex: copy.readout.refusedReason.regex,
  domains: copy.readout.refusedReason.domains,
} as const satisfies Record<
  Extract<AbsentReason, { readonly kind: "refused" }>["reason"],
  string
>;

const LIMIT_COPY = {
  dynamic: copy.errors.dynamicRuleCap,
  regex: copy.errors.regexRuleCap,
  session: copy.errors.sessionCap,
} as const satisfies Record<
  Extract<AbsentReason, { readonly kind: "over-limit" }>["limit"],
  string
>;

export function outcomeReason(
  outcome: Outcome,
  temporary: boolean,
): { readonly tone: Tone; readonly label: string } | undefined {
  if (outcome.kind === "runs-if-matched") {
    return {
      tone: OUTCOMES[outcome.kind].tone,
      label: copy.readout.unconfirmedReason,
    };
  }
  if (outcome.kind === "shadowed") {
    return {
      tone: OUTCOMES[outcome.kind].tone,
      label: copy.readout.overriddenBy(outcome.label),
    };
  }
  if (outcome.kind === "pending") {
    return {
      tone: OUTCOMES[outcome.kind].tone,
      label: copy.readout.outOfSync,
    };
  }
  if (outcome.kind === "absent") {
    return absentReason(outcome.reason, temporary);
  }
  if (outcome.kind === "partial") {
    return {
      tone: OUTCOMES[outcome.kind].tone,
      label: copy.readout.partiallyRunning,
    };
  }
  if (
    outcome.kind === "runs" ||
    outcome.kind === "elsewhere" ||
    outcome.kind === "placed"
  ) {
    return undefined;
  }
  outcome satisfies never;
  return undefined;
}

function absentReason(
  reason: AbsentReason,
  temporary: boolean,
): { readonly tone: Tone; readonly label: string } | undefined {
  if (reason.kind === "off") return undefined;
  if (reason.kind === "other-profile") {
    return {
      tone: ABSENT_TONES[reason.kind],
      label: copy.options.allRules.notActiveProfile(reason.profileName),
    };
  }
  if (reason.kind === "refused") {
    return {
      tone: ABSENT_TONES[reason.kind],
      label: REFUSAL_COPY[reason.reason],
    };
  }
  if (reason.kind === "ungranted") {
    return {
      tone: ABSENT_TONES[reason.kind],
      label: copy.readout.needsAccessReason(temporary),
    };
  }
  if (reason.kind === "ungranted-initiator") {
    return {
      tone: ABSENT_TONES[reason.kind],
      label: siteAccessCopy.initiatorNote,
    };
  }
  if (reason.kind === "over-limit") {
    return {
      tone: ABSENT_TONES[reason.kind],
      label: LIMIT_COPY[reason.limit],
    };
  }
  reason satisfies never;
  return undefined;
}

/**
 * The full sentence behind a transport caveat. One family sentence, except
 * where a header's measured truth differs from its family's: host keeps its
 * canonical reason, and te and content-length carry their value conditions.
 * The rule surfaces and the editor advisory both resolve through here, so no
 * two surfaces can state different transport truths for one header.
 */
export function transportNote(
  family: Extract<Caveat, "h1-only" | "h2-breaking">,
  header: string,
): string {
  const name = normalizeHeaderName(header);
  if (name === "host") return copy.advisories.host;
  if (family === "h1-only") return copy.advisories.h1Only;
  if (name === "te") return copy.advisories.te;
  if (name === "content-length") return copy.advisories.contentLength;
  return copy.advisories.h2Breaking;
}

export function caveatNote(
  caveats: readonly Caveat[],
  header?: string,
  operation?: HeaderOp,
): string | undefined {
  const caveat = caveats[0];
  if (caveat === undefined) return undefined;
  if (caveat === "h1-only" || caveat === "h2-breaking") {
    return transportNote(caveat, header ?? "");
  }
  if (header === undefined || operation === undefined) {
    return copy.advisories.securityResponse;
  }
  return operation === "remove"
    ? copy.advisories.removesSecurityResponse(header)
    : copy.advisories.changesSecurityResponse(header);
}

export function grantAction(outcome: Outcome):
  | {
      readonly label: string;
      readonly origins: readonly [string, ...string[]];
    }
  | undefined {
  if (outcome.kind !== "absent" && outcome.kind !== "partial") {
    return undefined;
  }
  if (
    outcome.reason.kind === "ungranted" ||
    outcome.reason.kind === "ungranted-initiator"
  ) {
    return {
      label: outcome.reason.missing.some(isAllSitesOrigin)
        ? copy.readout.grantAllSites
        : copy.readout.grant,
      origins: outcome.reason.missing,
    };
  }
  return undefined;
}

export function verb(
  outcome: Outcome,
  operation: HeaderOp,
  paused: boolean,
): string {
  return !paused && OUTCOMES[outcome.kind].active
    ? copy.readout.verb[operation]
    : copy.readout.heldVerb[operation];
}

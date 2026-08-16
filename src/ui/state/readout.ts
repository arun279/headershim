import { type Projection, preview } from "../../core/applied";
import { compile } from "../../core/compile";
import type { GrantSnapshot } from "../../core/grants";
import { normalizeHeaderName } from "../../core/headers";
import { enabledRulesFit } from "../../core/limits";
import type {
  Direction,
  HeaderOp,
  Profile,
  Rule,
  StateDoc,
  TabOverride,
} from "../../core/model";
import { scopeCondition } from "../../core/scope";
import {
  type Entry,
  overrideKey,
  type RuleKey,
  ruleKey,
} from "../../core/verdict";
import {
  headerValueSummary,
  isSecretHeader,
  ruleValueSummary,
} from "../secret";
import {
  type Caveat,
  type Line,
  projectTab,
  type TabContext,
  type TabOutcome,
} from "./project";

export interface TabChange {
  readonly key: RuleKey;
  readonly source: "rule" | "override";
  readonly profileId?: string;
  readonly ruleId?: string;
  readonly overrideNum?: number;
  readonly direction: Direction;
  readonly operation: HeaderOp;
  readonly header: string;
  readonly display?: string;
  readonly secret: boolean;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly outcome: TabOutcome;
  readonly caveats: readonly Caveat[];
  readonly value?: string;
  readonly widerReach?: number | "broad";
}

export interface TabReadout {
  readonly host: string | undefined;
  readonly listed: number;
  readonly total: number;
  readonly held: number;
  readonly request: readonly TabChange[];
  readonly response: readonly TabChange[];
  readonly token?: TabChange;
  readonly overrides: readonly TabChange[];
  readonly needsAccess: number;
  readonly refused: number;
  readonly transport: number;
  readonly security: number;
  readonly overridden: number;
  readonly unconfirmed: number;
}

export interface ReadoutInput {
  readonly applied: Projection;
  readonly doc: StateDoc;
  readonly overrides: readonly TabOverride[];
  readonly tab: TabContext;
}

export function computeReadout({
  applied: projection,
  doc,
  overrides,
  tab,
}: ReadoutInput): TabReadout {
  const projected = projectTab(projection, tab);
  const saved = savedChanges(doc, projected, projection.batch.paused);
  const temporary = overrideChanges(
    overrides,
    projected,
    projection.batch.paused,
  );
  const visibleSaved = saved.filter(
    (change) => change.outcome.kind !== "elsewhere",
  );
  const changes = [...visibleSaved, ...temporary];
  const token = tokenChange(projection, changes);
  const listed =
    token === undefined
      ? visibleSaved
      : visibleSaved.filter((change) => change.key !== token.key);
  return {
    host: tab.host,
    request: listed.filter((change) => change.direction === "request"),
    response: listed.filter((change) => change.direction === "response"),
    ...(token === undefined ? {} : { token }),
    overrides:
      token === undefined
        ? temporary
        : temporary.filter((change) => change.key !== token.key),
    ...summarize(changes, projection.batch.paused),
  };
}

function savedChanges(
  doc: StateDoc,
  projected: ReadonlyMap<RuleKey, Line<TabOutcome>>,
  paused: boolean,
): TabChange[] {
  const profile = doc.profiles.find(
    (candidate) => candidate.id === doc.activeProfileId,
  );
  if (profile === undefined) return [];
  const occurrences = new Map<string, number>();
  return profile.rules.flatMap((rule) => {
    const occurrence = occurrences.get(rule.id) ?? 0;
    occurrences.set(rule.id, occurrence + 1);
    const line = projected.get(ruleKey(profile.id, rule.id, occurrence));
    return line === undefined
      ? []
      : [storedChange(profile, rule, line, paused)];
  });
}

function storedChange(
  profile: Profile,
  rule: Rule,
  line: Line<TabOutcome>,
  paused: boolean,
): TabChange {
  const display = ruleDisplay(rule);
  const wider = widerReach(rule);
  return {
    key: line.key,
    source: "rule",
    profileId: profile.id,
    ruleId: rule.id,
    direction: rule.direction,
    operation: rule.operation,
    header: rule.header,
    ...(display === undefined ? {} : { display }),
    secret: isSecretHeader(rule.header),
    enabled: rule.enabled,
    paused,
    outcome: line.outcome,
    caveats: line.caveats,
    ...(rule.value === undefined ? {} : { value: rule.value }),
    ...(wider === undefined ? {} : { widerReach: wider }),
  };
}

function overrideChanges(
  overrides: readonly TabOverride[],
  projected: ReadonlyMap<RuleKey, Line<TabOutcome>>,
  paused: boolean,
): TabChange[] {
  const occurrences = new Map<number, number>();
  return overrides.flatMap((override) => {
    const occurrence = occurrences.get(override.num) ?? 0;
    occurrences.set(override.num, occurrence + 1);
    const line = projected.get(overrideKey(override.num, occurrence));
    if (line === undefined) return [];
    const display =
      override.operation === "remove"
        ? undefined
        : headerValueSummary(override.header, override.value);
    return [
      {
        key: line.key,
        source: "override",
        overrideNum: override.num,
        direction: override.direction,
        operation: override.operation,
        header: override.header,
        ...(display === undefined ? {} : { display }),
        secret: isSecretHeader(override.header),
        enabled: override.enabled,
        paused,
        outcome: line.outcome,
        caveats: line.caveats,
        ...(override.value === undefined ? {} : { value: override.value }),
      },
    ];
  });
}

function tokenChange(
  projection: Projection,
  changes: readonly TabChange[],
): TabChange | undefined {
  const candidates = changes.filter(
    (change) =>
      change.source === "rule" &&
      change.direction === "request" &&
      change.operation !== "remove" &&
      change.value !== undefined &&
      normalizeHeaderName(change.header) === "authorization" &&
      (change.outcome.kind === "runs" ||
        change.outcome.kind === "runs-if-matched" ||
        (change.outcome.kind === "absent" &&
          (change.outcome.reason.kind === "ungranted" ||
            change.outcome.reason.kind === "ungranted-initiator"))),
  );
  const byKey = new Map(candidates.map((change) => [change.key, change]));
  for (const ref of projection.batch.slots.get("request:authorization") ?? []) {
    const candidate = byKey.get(ref.key);
    if (candidate !== undefined) return candidate;
  }
  return candidates[0];
}

function summarize(
  changes: readonly TabChange[],
  paused: boolean,
): Pick<
  TabReadout,
  | "total"
  | "listed"
  | "held"
  | "needsAccess"
  | "refused"
  | "transport"
  | "security"
  | "overridden"
  | "unconfirmed"
> {
  let running = 0;
  let needsAccess = 0;
  let refused = 0;
  let transport = 0;
  let security = 0;
  let overridden = 0;
  let unconfirmed = 0;
  for (const change of changes) {
    const { outcome } = change;
    const canRun =
      outcome.kind === "runs" || outcome.kind === "runs-if-matched";
    // The popup cannot see the connection a request will use, so a change
    // that is definitely running (outcome "runs") but whose header carries a
    // transport caveat is left out of the headline count and carried by the
    // transport count instead. A "runs-if-matched" change is already
    // uncertain for an unrelated reason (its match), so a caveat on top of
    // that changes nothing about where it is counted.
    const transportCaveat =
      change.caveats.includes("h1-only") ||
      change.caveats.includes("h2-breaking");
    if (canRun && change.caveats.includes("security-response")) {
      security += 1;
    }
    if (outcome.kind === "runs") {
      if (!transportCaveat) running += 1;
    } else if (outcome.kind === "runs-if-matched") {
      running += 1;
      unconfirmed += 1;
    } else if (outcome.kind === "shadowed") {
      overridden += 1;
    } else if (outcome.kind === "absent") {
      if (
        outcome.reason.kind === "ungranted" ||
        outcome.reason.kind === "ungranted-initiator"
      ) {
        needsAccess += 1;
      } else if (outcome.reason.kind === "refused") {
        refused += 1;
      }
    }
    if (outcome.kind === "runs" && transportCaveat) transport += 1;
  }
  return {
    listed: changes.length,
    total: paused ? 0 : running,
    held: paused ? running : 0,
    needsAccess,
    refused,
    transport,
    security,
    overridden,
    unconfirmed,
  };
}

function ruleDisplay(
  rule: Pick<Rule, "operation" | "generated" | "header" | "value">,
): string | undefined {
  return rule.operation === "remove" ? undefined : ruleValueSummary(rule);
}

export interface SwitchPreview {
  readonly drops: readonly string[];
  readonly adds: readonly {
    readonly header: string;
    readonly display?: string;
  }[];
}

export function previewSwitch(
  projection: Projection,
  targetProfile: Profile,
  tab: TabContext,
  granted: GrantSnapshot,
  isRegexSupported: (regex: string) => boolean,
  overrides: readonly TabOverride[],
): SwitchPreview {
  if (!enabledRulesFit(targetProfile.rules.filter((rule) => rule.enabled))) {
    return { drops: [], adds: [] };
  }
  const projected = projectTab(preview(projection.batch), tab);
  const activeEntries: Entry[] = [];
  const targetEntries: Entry[] = [];
  const rules = new Map<RuleKey, Rule>();
  const targetBatch = compile({
    doc: {
      v: 1,
      profiles: [targetProfile],
      activeProfileId: targetProfile.id,
      nextRuleNum: 1,
      settings: {
        paused: projection.batch.paused,
        theme: "system",
      },
    },
    overrides,
    granted,
    isRegexSupported,
  });
  const targetProjected = projectTab(preview(targetBatch), tab);
  const occurrences = new Map<string, number>();
  for (const rule of targetProfile.rules) {
    const occurrence = occurrences.get(rule.id) ?? 0;
    occurrences.set(rule.id, occurrence + 1);
    rules.set(ruleKey(targetProfile.id, rule.id, occurrence), rule);
  }
  for (const entry of projection.batch.entries) {
    const outcome = projected.get(entry.key)?.outcome;
    if (
      entry.key.startsWith("rule:") &&
      (outcome?.kind === "runs" || outcome?.kind === "runs-if-matched")
    ) {
      activeEntries.push(entry);
    }
  }
  for (const entry of targetBatch.entries) {
    const outcome = targetProjected.get(entry.key)?.outcome;
    if (outcome?.kind === "runs" || outcome?.kind === "runs-if-matched") {
      const rule = rules.get(entry.key);
      if (rule !== undefined) targetEntries.push(entry);
    }
  }
  const current = new Set(activeEntries.map((entry) => entry.headerKey));
  const target = new Set(targetEntries.map((entry) => entry.headerKey));
  const drops = new Set<string>();
  for (const entry of activeEntries) {
    if (!target.has(entry.headerKey)) drops.add(entry.header);
  }
  const adds: { header: string; display?: string }[] = [];
  for (const entry of targetEntries) {
    const rule = rules.get(entry.key);
    if (!current.has(entry.headerKey)) {
      const display = rule === undefined ? undefined : ruleDisplay(rule);
      adds.push({
        header: entry.header,
        ...(display === undefined ? {} : { display }),
      });
      current.add(entry.headerKey);
    }
  }
  return { drops: [...drops], adds };
}

function widerReach(rule: Rule): number | "broad" | undefined {
  const { requestDomains } = scopeCondition(rule.scope);
  if (requestDomains === undefined) return "broad";
  const others = requestDomains.length - 1;
  return others > 0 ? others : undefined;
}

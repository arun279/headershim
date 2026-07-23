import { checkEnabledRuleLimits } from "./limits";

export const DIRECTIONS = ["request", "response"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const HEADER_OPERATIONS = ["set", "append", "remove"] as const;
export type HeaderOp = (typeof HEADER_OPERATIONS)[number];

export const RESOURCE_GROUPS = [
  "pages",
  "subframes",
  "xhr",
  "scripts",
  "stylesheets",
  "images",
  "fonts",
  "media",
  "websockets",
  "other",
] as const;
export type ResourceGroup = (typeof RESOURCE_GROUPS)[number];

export type Scope =
  | { type: "domains"; domains: string[] }
  | { type: "pattern"; pattern: string; hosts: string[] }
  | { type: "regex"; regex: string; hosts: string[] }
  | { type: "all" };

export interface Rule {
  id: string;
  num: number;
  direction: Direction;
  operation: HeaderOp;
  header: string;
  value?: string;
  scope: Scope;
  resourceTypes: ResourceGroup[] | "all";
  initiators: string[];
  enabled: boolean;
  comment?: string;
  generated?: { kind: "uuid" | "timestamp"; at: string };
}

// The fixed badge palette, in swatch order. Each hue meets the contrast bar
// against white 2-char text in both themes (see tokens.css / core/badge.ts).
export const BADGE_COLORS = [
  "indigo",
  "blue",
  "teal",
  "green",
  "plum",
  "magenta",
  "crimson",
  "slate",
] as const;

export type BadgeColor = (typeof BADGE_COLORS)[number];

export interface Profile {
  id: string;
  name: string;
  badgeText: string;
  color: BadgeColor;
  rules: Rule[];
}

export interface Settings {
  paused: boolean;
  theme: "system" | "light" | "dark";
}

export interface StateDoc {
  v: 1;
  profiles: Profile[];
  activeProfileId: string | undefined;
  nextRuleNum: number;
  settings: Settings;
}

export interface TabOverride {
  num: number;
  tabId: number;
  originHost: string;
  direction: Direction;
  operation: HeaderOp;
  header: string;
  value?: string;
  enabled: boolean;
}

export type RuleDraft = Omit<Rule, "id" | "num">;

export interface ProfileDraft {
  name: string;
  badgeText: string;
  color: BadgeColor;
}

export function allocateRuleNum(doc: StateDoc): [number, StateDoc] {
  if (
    !Number.isSafeInteger(doc.nextRuleNum) ||
    doc.nextRuleNum < 1 ||
    doc.nextRuleNum === Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError("nextRuleNum cannot allocate another rule number");
  }

  return [doc.nextRuleNum, { ...doc, nextRuleNum: doc.nextRuleNum + 1 }];
}

export function createRule(doc: StateDoc, draft: RuleDraft): [Rule, StateDoc] {
  const [num, nextDoc] = allocateRuleNum(doc);
  return [
    {
      id: crypto.randomUUID(),
      num,
      direction: draft.direction,
      operation: draft.operation,
      header: draft.header,
      ...(draft.value === undefined ? {} : { value: draft.value }),
      scope: copyScope(draft.scope),
      resourceTypes:
        draft.resourceTypes === "all" ? "all" : [...draft.resourceTypes],
      initiators: [...draft.initiators],
      enabled: draft.enabled,
      ...(draft.comment === undefined ? {} : { comment: draft.comment }),
      ...(draft.generated === undefined
        ? {}
        : { generated: { ...draft.generated } }),
    },
    nextDoc,
  ];
}

export function cloneRule(doc: StateDoc, rule: Rule): [Rule, StateDoc] {
  return createRule(doc, rule);
}

export function createProfile(draft: ProfileDraft): Profile {
  return {
    id: crypto.randomUUID(),
    name: draft.name,
    badgeText: normalizeBadgeText(draft.badgeText),
    color: draft.color,
    rules: [],
  };
}

export function activeProfile(doc: StateDoc): Profile | undefined {
  return doc.profiles.find((profile) => profile.id === doc.activeProfileId);
}

export function defaultProfileColor(profileCount: number): BadgeColor {
  return BADGE_COLORS[profileCount % BADGE_COLORS.length] ?? BADGE_COLORS[0];
}

export function activateProfile(doc: StateDoc, profileId: string): StateDoc {
  const profile = doc.profiles.find((candidate) => candidate.id === profileId);
  if (
    profile === undefined ||
    !checkEnabledRuleLimits(profile.rules.filter((rule) => rule.enabled)).ok
  ) {
    return doc;
  }
  return { ...doc, activeProfileId: profileId };
}

export function activateNextProfile(doc: StateDoc): StateDoc {
  const active = activeProfile(doc);
  const activeIndex = active === undefined ? -1 : doc.profiles.indexOf(active);
  for (let step = 1; step <= doc.profiles.length; step += 1) {
    const next = doc.profiles[(activeIndex + step) % doc.profiles.length];
    if (next === undefined) {
      continue;
    }
    const activated = activateProfile(doc, next.id);
    if (activated.activeProfileId === next.id) {
      return activated;
    }
  }
  return doc;
}

export function isProfileNameAvailable(
  profiles: readonly Profile[],
  candidate: string,
  excludedProfileId?: string,
): boolean {
  return (
    candidate.length <= 48 &&
    isStoredProfileNameValid(profiles, candidate, excludedProfileId)
  );
}

export function isStoredProfileNameValid(
  profiles: readonly Profile[],
  candidate: string,
  excludedProfileId?: string,
): boolean {
  if (candidate.trim().length === 0) return false;

  const normalized = candidate.toLowerCase();
  return !profiles.some(
    (profile) =>
      profile.id !== excludedProfileId &&
      profile.name.toLowerCase() === normalized,
  );
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export function normalizeBadgeText(text: string): string {
  return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment)
    .slice(0, 2)
    .join("");
}

/**
 * The badges a name can produce, best first: its first two significant
 * characters, then the first paired with each later one. Uppercased to match the
 * seeded Default profile's initials style.
 */
function badgeCandidates(name: string): string[] {
  const characters = Array.from(
    graphemeSegmenter.segment(name.replace(/\s+/g, "")),
    ({ segment }) => segment.toUpperCase(),
  );
  const first = characters[0];
  if (first === undefined) {
    return [];
  }
  return [
    characters.slice(0, 2).join(""),
    ...characters.slice(2).map((character) => first + character),
  ];
}

/**
 * The badge a profile takes from its name. The badge is the only mark that tells
 * one profile's rules from another's in the rule lists and on the toolbar, so a
 * candidate another profile already carries is passed over for the next one the
 * name offers.
 */
export function deriveBadgeText(
  name: string,
  taken: readonly string[],
): string {
  const candidates = badgeCandidates(name);
  return (
    candidates.find((candidate) => !taken.includes(candidate)) ??
    candidates[0] ??
    ""
  );
}

/**
 * Whether a badge is one its name could have produced, which is what separates a
 * badge still following the name from one the user typed. A rename re-derives
 * the first and leaves the second alone.
 */
export function isDerivedBadgeText(name: string, badgeText: string): boolean {
  return badgeCandidates(name).includes(badgeText);
}

function copyScope(scope: Scope): Scope {
  switch (scope.type) {
    case "domains":
      return { type: "domains", domains: [...scope.domains] };
    case "pattern":
      return {
        type: "pattern",
        pattern: scope.pattern,
        hosts: [...scope.hosts],
      };
    case "regex":
      return { type: "regex", regex: scope.regex, hosts: [...scope.hosts] };
    case "all":
      return { type: "all" };
  }
}

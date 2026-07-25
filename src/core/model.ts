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
  activeProfileId: string;
  /** The profile active just before this one, so the profile shortcut can flip
   *  back to it. Absent until a first switch establishes the pair. */
  previousProfileId?: string;
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

export function createProfile(draft: ProfileDraft): Profile {
  return {
    id: crypto.randomUUID(),
    name: draft.name,
    badgeText: normalizeBadgeText(draft.badgeText),
    color: draft.color,
    rules: [],
  };
}

/** The profile the product falls back to: the first-run seed, and the empty one
 *  that takes the last profile's place when it is deleted. */
export const DEFAULT_PROFILE_NAME = "Default";

export function createDefaultProfile(): Profile {
  return createProfile({
    name: DEFAULT_PROFILE_NAME,
    badgeText: "DE",
    color: "indigo",
  });
}

export function activeProfile(doc: StateDoc): Profile {
  const active = doc.profiles.find(
    (profile) => profile.id === doc.activeProfileId,
  );
  if (active === undefined) {
    throw new RangeError("activeProfileId names no profile");
  }
  return active;
}

export function defaultProfileColor(profileCount: number): BadgeColor {
  return BADGE_COLORS[profileCount % BADGE_COLORS.length] ?? BADGE_COLORS[0];
}

// The one profile-activation transition. It remembers the profile it leaves in
// previousProfileId, so the profile shortcut can flip back to it. A no-op when
// the target is already active, absent, or over its enabled-rule caps (a profile
// can grow past them while inactive), so the UI switch and the shortcut share
// one guard and one bookkeeping rule.
export function activateProfile(doc: StateDoc, profileId: string): StateDoc {
  const profile = doc.profiles.find((candidate) => candidate.id === profileId);
  if (
    profile === undefined ||
    profileId === doc.activeProfileId ||
    !checkEnabledRuleLimits(profile.rules.filter((rule) => rule.enabled)).ok
  ) {
    return doc;
  }
  return {
    ...doc,
    activeProfileId: profileId,
    previousProfileId: doc.activeProfileId,
  };
}

// The profile shortcut: flip to the profile that was active just before this
// one. Repeated presses toggle between the two, so a two-environment user stays
// on their pair and never lands on an empty profile they did not pick.
export function activatePreviousProfile(doc: StateDoc): StateDoc {
  return doc.previousProfileId === undefined
    ? doc
    : activateProfile(doc, doc.previousProfileId);
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

/**
 * A profile name free of both the stored profiles and any name reserved earlier
 * in the same batch: the base when it is available, otherwise the base with the
 * lowest " N" suffix that is. Creating a profile and importing a batch both name
 * new profiles this way, so a collision resolves the same however it arose.
 */
export function availableProfileName(
  base: string,
  profiles: readonly Profile[],
  takenNames: readonly string[] = [],
): string {
  const available = (candidate: string) =>
    isStoredProfileNameValid(profiles, candidate) &&
    !takenNames.some((name) => name.toLowerCase() === candidate.toLowerCase());

  if (available(base)) {
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (available(candidate)) {
      return candidate;
    }
  }
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

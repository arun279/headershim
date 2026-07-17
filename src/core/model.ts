import { checkEnabledRuleLimits } from "./limits";

export type Direction = "request" | "response";
export type HeaderOp = "set" | "append" | "remove";

export type ResourceGroup =
  | "pages"
  | "subframes"
  | "xhr"
  | "scripts"
  | "stylesheets"
  | "images"
  | "fonts"
  | "media"
  | "websockets"
  | "other";

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
  badgeMode: "count" | "initials";
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

export function isProfileNameAvailable(
  profiles: readonly Profile[],
  candidate: string,
  excludedProfileId?: string,
): boolean {
  if (candidate.trim().length === 0 || candidate.length > 48) {
    return false;
  }

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

import type { ReadonlyDnrRule, ReadonlyDnrRuleCondition } from "./compile";
import type { BadgeColor, Direction, HeaderOp, Rule } from "./model";

export type RuleKey = `rule:${string}` | `tab:${number}:${number}`;

export function ruleKey(
  profileId: string,
  ruleId: string,
  occurrence: number,
): RuleKey {
  return `rule:${JSON.stringify([profileId, ruleId, occurrence])}`;
}

export function overrideKey(num: number, occurrence: number): RuleKey {
  return `tab:${num}:${occurrence}`;
}

// Chrome sends a modified Host header over HTTP/1.1, so Host remains
// compilable.
export type UncompilableReason =
  | "header"
  | "append"
  | "value"
  | "pattern"
  | "regex"
  | "domains";

export type AbsentReason =
  | { readonly kind: "off" }
  | { readonly kind: "other-profile"; readonly profileName: string }
  | { readonly kind: "refused"; readonly reason: UncompilableReason }
  | {
      readonly kind: "ungranted";
      readonly missing: readonly [string, ...string[]];
    }
  | {
      readonly kind: "ungranted-initiator";
      readonly missing: readonly [string, ...string[]];
    }
  | {
      readonly kind: "over-limit";
      readonly limit: "dynamic" | "regex" | "session";
    };

export interface Placement {
  readonly dnrId: number;
  readonly band: "dynamic" | "session";
  readonly priority: number;
  readonly condition: ReadonlyDnrRuleCondition;
  readonly narrowed: boolean;
  readonly tabId: number | undefined;
}

export type Standing =
  | {
      readonly kind: "placed";
      readonly placements: readonly [Placement, ...Placement[]];
    }
  | { readonly kind: "absent"; readonly reason: AbsentReason };

interface EntryBase {
  readonly key: RuleKey;
  readonly profileId: string;
  readonly label: string;
  readonly stage: Direction;
  readonly headerKey: string;
  readonly header: string;
  readonly operation: HeaderOp;
  readonly authored: ReadonlyDnrRuleCondition;
  readonly standing: Standing;
  readonly grantGap: AbsentReason | undefined;
}

export interface StoredEntry
  extends EntryBase,
    Readonly<
      Pick<Rule, "value" | "generated" | "scope" | "enabled" | "comment">
    > {
  readonly source: "rule";
  readonly ruleId: string;
  readonly profileName: string;
  readonly badgeText: string;
  readonly color: BadgeColor;
}

interface OverrideEntry extends EntryBase {
  readonly source: "override";
}

export type Entry = StoredEntry | OverrideEntry;

export interface PlacedRef {
  readonly key: RuleKey;
  readonly operation: HeaderOp;
  readonly placement: Placement;
}

export interface Batch {
  readonly paused: boolean;
  readonly dynamic: readonly ReadonlyDnrRule[];
  readonly session: readonly ReadonlyDnrRule[];
  readonly entries: readonly Entry[];
  readonly slots: ReadonlyMap<string, readonly PlacedRef[]>;
}

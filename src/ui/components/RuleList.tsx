import { useEffect, useRef, useState } from "preact/hooks";
import {
  listNavCommand,
  rowCommand,
} from "../../../entrypoints/popup/keyboard";
import { findOverriddenRules } from "../../core/conflicts";
import { ALL_SITES_ORIGIN, domainFromOriginPattern } from "../../core/grants";
import type { Profile } from "../../core/model";
import { copy } from "../copy";
import { RuleRow } from "./RuleRow";
import "./RuleList.css";

interface RuleListProps {
  /** Enabled profiles in document order; empty ones render no group. */
  profiles: readonly Profile[];
  /** Every profile, for the move-to-profile menu targets. */
  allProfiles: readonly Pick<Profile, "id" | "name">[];
  /** ruleId → missing origin patterns (enabled rules lacking grants). */
  missingByRule: ReadonlyMap<string, readonly string[]>;
  /** Rules whose stored regex scope Chrome's engine rejects. */
  invalidRuleIds: ReadonlySet<string>;
  /** A delete is waiting for undo; surfaces "Undo last delete" in row menus. */
  undoAvailable: boolean;
  onToggle: (profileId: string, ruleId: string, enabled: boolean) => void;
  onGrant: (
    profileId: string,
    ruleId: string,
    origins: readonly string[],
  ) => void;
  /** Opens the inline editor; optional until a host surface provides one. */
  onEdit?: (profileId: string, ruleId: string) => void;
  onDelete: (profileId: string, ruleId: string) => void;
  onDuplicate: (profileId: string, ruleId: string) => void;
  onMove: (profileId: string, ruleId: string, toProfileId: string) => void;
  onRegenerate: (profileId: string, ruleId: string) => void;
  onUndoDelete: () => void;
}

/**
 * The rule list: one group per enabled profile, rows in applied order (profile
 * order then rule order — the visible order IS the applied order). One row is
 * in the tab order at a time; arrows move between rows across group bounds.
 * Grouping is per-profile `role="list"` regions named by their silkscreen
 * label, with global aria-posinset/aria-setsize so a row still reads as
 * "rule 3 of 12" over the whole collection.
 */
export function RuleList(props: RuleListProps) {
  const groups = props.profiles.filter((profile) => profile.rules.length > 0);
  const flat = groups.flatMap((profile) =>
    profile.rules.map((rule) => ({ profile, rule })),
  );
  const overridden = new Set(
    findOverriddenRules(flat.map((entry) => entry.rule)).map(
      (entry) => entry.ruleId,
    ),
  );

  const rows = useRef(new Map<string, HTMLLIElement>());
  const [rovingId, setRovingId] = useState<string | undefined>(undefined);
  // When the roving row vanishes (deleted), its remembered index points at
  // the row that took its place.
  const lastIndex = useRef(0);
  const foundIndex = flat.findIndex((entry) => entry.rule.id === rovingId);
  if (foundIndex !== -1) {
    lastIndex.current = foundIndex;
  }
  const rovingIndex =
    foundIndex !== -1
      ? foundIndex
      : Math.max(0, Math.min(lastIndex.current, flat.length - 1));

  const focusRow = (index: number) => {
    const entry = flat[Math.max(0, Math.min(index, flat.length - 1))];
    if (entry !== undefined) {
      rows.current.get(entry.rule.id)?.focus();
    }
  };

  // A deleted focused row must not drop keyboard users out of the list: when
  // the roving row disappears while focus was lost with it, land on the row
  // that took its place.
  const rovingGone =
    rovingId !== undefined && !flat.some((entry) => entry.rule.id === rovingId);
  useEffect(() => {
    if (!rovingGone) {
      return;
    }
    const active = document.activeElement;
    if (active === null || active === document.body) {
      focusRow(rovingIndex);
    }
    setRovingId(flat[Math.min(rovingIndex, flat.length - 1)]?.rule.id);
  });

  let posinset = 0;
  return (
    <section
      class="rules"
      aria-label={copy.rules.listLabel}
      onKeyDown={(event) => {
        if (event.defaultPrevented) {
          return;
        }
        const nav = listNavCommand(event);
        if (nav === undefined || flat.length === 0) {
          return;
        }
        event.preventDefault();
        switch (nav) {
          case "up":
            return focusRow(rovingIndex - 1);
          case "down":
            return focusRow(rovingIndex + 1);
          case "first":
            return focusRow(0);
          case "last":
            return focusRow(flat.length - 1);
        }
      }}
    >
      {groups.map((profile) => (
        <div key={profile.id} class="rule-group">
          <span class="silk rule-group-label" id={`rule-group-${profile.id}`}>
            {profile.name}
          </span>
          <ul aria-labelledby={`rule-group-${profile.id}`}>
            {profile.rules.map((rule) => {
              posinset += 1;
              const index = posinset - 1;
              const missing = props.missingByRule.get(rule.id);
              return (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  missingHosts={missingHosts(missing)}
                  invalid={props.invalidRuleIds.has(rule.id)}
                  overridden={overridden.has(rule.id)}
                  undoAvailable={props.undoAvailable}
                  moveTargets={props.allProfiles.filter(
                    (target) => target.id !== profile.id,
                  )}
                  posinset={posinset}
                  setsize={flat.length}
                  tabIndex={index === rovingIndex ? 0 : -1}
                  onFocus={() => setRovingId(rule.id)}
                  rowRef={(element) => {
                    if (element === null) {
                      rows.current.delete(rule.id);
                    } else {
                      rows.current.set(rule.id, element);
                    }
                  }}
                  onRowCommand={(event, openMenu) => {
                    const command = rowCommand(event);
                    if (command === undefined) {
                      return;
                    }
                    event.preventDefault();
                    switch (command) {
                      case "edit":
                        return props.onEdit?.(profile.id, rule.id);
                      case "toggle":
                        // The invalid state's redirect lives on the switch;
                        // Space must not bypass it.
                        return props.invalidRuleIds.has(rule.id)
                          ? undefined
                          : props.onToggle(profile.id, rule.id, !rule.enabled);
                      case "delete":
                        return props.onDelete(profile.id, rule.id);
                      case "menu":
                        return openMenu();
                    }
                  }}
                  onToggle={(enabled) =>
                    props.onToggle(profile.id, rule.id, enabled)
                  }
                  onGrant={() =>
                    props.onGrant(profile.id, rule.id, missing ?? [])
                  }
                  onEdit={() => props.onEdit?.(profile.id, rule.id)}
                  onDelete={() => props.onDelete(profile.id, rule.id)}
                  onDuplicate={() => props.onDuplicate(profile.id, rule.id)}
                  onMoveToProfile={(toProfileId) =>
                    props.onMove(profile.id, rule.id, toProfileId)
                  }
                  onRegenerate={() => props.onRegenerate(profile.id, rule.id)}
                  onUndoDelete={props.onUndoDelete}
                />
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function missingHosts(
  origins: readonly string[] | undefined,
): readonly string[] | undefined {
  return origins?.map(
    (origin) =>
      domainFromOriginPattern(origin) ??
      (origin === ALL_SITES_ORIGIN ? copy.scopeSummary.allSites : origin),
  );
}

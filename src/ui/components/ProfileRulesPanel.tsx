import { useEffect, useId, useRef, useState } from "preact/hooks";
import {
  ALL_SITES_ORIGIN,
  domainFromOriginPattern,
  type GrantSnapshot,
  missingGrants,
} from "../../core/grants";
import type { Profile } from "../../core/model";
import { copy } from "../copy";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { RuleRow } from "./RuleRow";
import "./ProfileRulesPanel.css";

interface ProfileRulesPanelProps {
  profile: Profile;
  grants: GrantSnapshot;
  invalidRuleIds: ReadonlySet<string>;
  /** Profiles a selection can be moved to (everything but this one). */
  moveTargets: readonly Pick<Profile, "id" | "name">[];
  onSetEnabled: (ruleIds: readonly string[], enabled: boolean) => void;
  onDelete: (ruleIds: readonly string[]) => void;
  onMove: (ruleIds: readonly string[], toProfileId: string) => void;
  onCreate: () => void;
  onEdit: (ruleId: string) => void;
  onGrant: (origins: readonly string[]) => void;
}

/**
 * The open profile's rules with the bulk toolbar: select rows, then
 * enable, disable, move, or delete the selection in one action. Selection is
 * local to the panel and resets when the open profile or its membership changes.
 */
export function ProfileRulesPanel(props: ProfileRulesPanelProps) {
  const { profile } = props;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const selectAll = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  const ruleIds = profile.rules.map((rule) => rule.id);
  const chosen = ruleIds.filter((id) => selected.has(id));
  const allSelected = chosen.length > 0 && chosen.length === ruleIds.length;

  // A profile switch or a membership change (move/delete) drops stale ids.
  useEffect(() => {
    setSelected(new Set());
    setMoving(false);
  }, [profile.id, ruleIds.join()]);

  useEffect(() => {
    if (selectAll.current !== null) {
      selectAll.current.indeterminate = chosen.length > 0 && !allSelected;
    }
  }, [chosen.length, allSelected]);

  const toggleOne = (ruleId: string, on: boolean) => {
    const next = new Set(selected);
    if (on) {
      next.add(ruleId);
    } else {
      next.delete(ruleId);
    }
    setSelected(next);
  };

  const toggleAll = (on: boolean) => setSelected(new Set(on ? ruleIds : []));

  const act = (run: () => void) => {
    run();
    setMoving(false);
  };

  // Picking a move target unmounts the target picker (and the moved rows), so
  // focus would fall to <body>; the panel heading is the stable anchor (WCAG
  // 2.4.3). tabindex=-1 makes it programmatically focusable without a tab stop.
  const moveTo = (toProfileId: string) => {
    act(() => props.onMove(chosen, toProfileId));
    heading.current?.focus();
  };

  return (
    <section class="rules-panel" aria-labelledby={headingId}>
      <div class="rules-panel-head">
        <h2
          class="rules-panel-label"
          id={headingId}
          ref={heading}
          tabIndex={-1}
        >
          {copy.options.rules.sectionLabel(profile.name)}
        </h2>
        <Button kind="primary" onClick={props.onCreate}>
          {copy.options.rules.new}
        </Button>
      </div>
      {profile.rules.length === 0 ? (
        <EmptyState message={copy.emptyState.profile(profile.name)} />
      ) : (
        <>
          <div class="bulk-bar">
            <label class="bulk-select-all">
              <input
                type="checkbox"
                ref={selectAll}
                checked={allSelected}
                aria-label={copy.options.rules.selectAll}
                onChange={(event) => toggleAll(event.currentTarget.checked)}
              />
              <span>{copy.options.rules.selected(chosen.length)}</span>
            </label>
            <div class="bulk-actions">
              <Button
                kind="quiet"
                disabled={chosen.length === 0}
                onClick={() => act(() => props.onSetEnabled(chosen, true))}
              >
                {copy.options.rules.enable}
              </Button>
              <Button
                kind="quiet"
                disabled={chosen.length === 0}
                onClick={() => act(() => props.onSetEnabled(chosen, false))}
              >
                {copy.options.rules.disable}
              </Button>
              <Button
                kind="quiet"
                disabled={chosen.length === 0 || props.moveTargets.length === 0}
                onClick={() => setMoving((open) => !open)}
              >
                {copy.options.rules.move}
              </Button>
              <Button
                kind="quiet"
                disabled={chosen.length === 0}
                onClick={() => act(() => props.onDelete(chosen))}
              >
                {copy.options.rules.delete}
              </Button>
            </div>
          </div>
          {moving && (
            <div class="bulk-move-targets">
              <span class="silk">{copy.menu.moveToProfile}</span>
              {props.moveTargets.map((target) => (
                <Button
                  key={target.id}
                  kind="quiet"
                  label={copy.options.rules.moveTo(target.name)}
                  onClick={() => moveTo(target.id)}
                >
                  {target.name}
                </Button>
              ))}
            </div>
          )}
          <ul class="selectable-rules">
            {profile.rules.map((rule, index) => {
              const origins =
                profile.enabled && rule.enabled
                  ? missingGrants(rule, props.grants)
                  : [];
              return (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  active={profile.enabled}
                  invalid={props.invalidRuleIds.has(rule.id)}
                  missingHosts={origins.map(
                    (origin) =>
                      domainFromOriginPattern(origin) ??
                      (origin === ALL_SITES_ORIGIN
                        ? copy.scopeSummary.allSites
                        : origin),
                  )}
                  selection={{
                    checked: selected.has(rule.id),
                    label: copy.options.rules.selectRule(rule.header),
                    onChange: (on) => toggleOne(rule.id, on),
                  }}
                  posinset={index + 1}
                  setsize={profile.rules.length}
                  onToggle={(enabled) => props.onSetEnabled([rule.id], enabled)}
                  onGrant={() => props.onGrant(origins)}
                  onEdit={() => props.onEdit(rule.id)}
                />
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

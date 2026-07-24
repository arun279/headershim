import { useEffect, useState } from "preact/hooks";
import type { GrantSnapshot } from "../../../src/core/grants";
import { activeProfile, type StateDoc } from "../../../src/core/model";
import type { SystemStatus } from "../../../src/core/status";
import { request as requestPermissions } from "../../../src/platform/permissions";
import { useAnnounce } from "../../../src/ui/a11y/LiveRegion";
import { Button } from "../../../src/ui/components/Button";
import { DataNote } from "../../../src/ui/components/DataNote";
import { EmptyState } from "../../../src/ui/components/EmptyState";
import {
  DirectionGlyph,
  PlusGlyph,
} from "../../../src/ui/components/readout/glyphs";
import { ProfileBadge } from "../../../src/ui/components/readout/ProfileBadge";
import { Segmented } from "../../../src/ui/components/Segmented";
import { sentence } from "../../../src/ui/components/sentence";
import { Toast } from "../../../src/ui/components/Toast";
import { Toggle } from "../../../src/ui/components/Toggle";
import { HeaderValue, Truncate } from "../../../src/ui/components/Truncate";
import { toneForStatus } from "../../../src/ui/components/toggleTone";
import { copy } from "../../../src/ui/copy";
import { grantLabel } from "../../../src/ui/grantLabel";
import {
  type FleetRule,
  groupByHeader,
  groupBySite,
  projectFleet,
} from "../../../src/ui/state/fleet";
import type { Mutations } from "../../../src/ui/state/mutations";
import { useToast } from "../useToast";
import "./Rules.css";

const text = copy.options.allRules;

type Lens = "site" | "header";
type Editing = { profileId: string; ruleId: string | undefined };

/**
 * Every rule across every profile, in one severity grammar. Grouping by site
 * answers "what lands here"; grouping by header answers "where does this one
 * header reach", the home for cross-site rules. Authoring reuses the shared
 * RuleEditor inline.
 */
export function RulesPage({
  doc,
  grants,
  status,
  isRegexSupported,
  mutations,
}: {
  doc: StateDoc;
  grants: GrantSnapshot;
  status: SystemStatus;
  isRegexSupported: (regex: string) => boolean;
  mutations: Mutations;
}) {
  const announce = useAnnounce();
  const [lens, setLens] = useState<Lens>("header");
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const {
    toast,
    action: toastAction,
    show: showToast,
    showUndoable,
    flash,
    dismiss,
  } = useToast();
  // The editor is the options page's one heavy dependency; load it on demand so
  // it never sits in the initial bundle.
  const [Editor, setEditor] =
    useState<
      typeof import("../../../src/ui/components/RuleEditor").RuleEditor
    >();
  useEffect(() => {
    void import("../../../src/ui/components/RuleEditor").then((module) =>
      setEditor(() => module.RuleEditor),
    );
  }, []);

  const fleet = projectFleet({
    doc,
    grants,
    isRegexSupported,
    status,
  });

  const editProfile =
    editing === undefined
      ? undefined
      : doc.profiles.find((profile) => profile.id === editing.profileId);
  const editingRule =
    editing?.ruleId === undefined
      ? undefined
      : editProfile?.rules.find((rule) => rule.id === editing.ruleId);
  // A rule deleted or a profile removed elsewhere retires a stale editor.
  useEffect(() => {
    if (
      editing !== undefined &&
      (editProfile === undefined ||
        (editing.ruleId !== undefined && editingRule === undefined))
    ) {
      setEditing(undefined);
    }
  }, [editing, editProfile, editingRule]);

  const toggle = (rule: FleetRule, next: boolean) =>
    void mutations
      .setRuleEnabled(rule.profileId, rule.ruleId, next)
      .then((outcome) => {
        if (!outcome.ok) flash(outcome.error);
      });

  const save = async (
    ruleId: string | undefined,
    draft: Parameters<Mutations["saveRule"]>[2],
    profileId: string | undefined,
    fromProfileId: string,
  ) => {
    const target = profileId ?? fromProfileId;
    if (ruleId === undefined) {
      return mutations.saveRule(target, undefined, draft);
    }
    return mutations.saveRuleToProfile(fromProfileId, ruleId, draft, target);
  };

  // No confirmation: the toast carries the whole rule back, and asking first
  // would tax every delete to soften the rare one.
  const deleteRule = (profileId: string, ruleId: string) =>
    void mutations.deleteRule(profileId, ruleId).then((outcome) => {
      if (!outcome.ok) {
        flash(outcome.error);
        return;
      }
      const { rule, index } = outcome.value;
      setEditing(undefined);
      showUndoable(copy.toast.ruleDeleted, () =>
        mutations.restoreRule(profileId, rule, index),
      );
    });

  const grant = (rule: FleetRule) => {
    void requestPermissions([...(rule.missing ?? [])]).then((allowed) => {
      if (allowed) announce(copy.toast.accessGranted);
    });
  };

  const newRule = () => {
    setEditing({ profileId: activeProfile(doc).id, ruleId: undefined });
  };

  // One node for both branches: the delete toast has to survive the editor
  // closing under it, or its undo would vanish with the surface that raised it.
  const toastNode = toast !== undefined && (
    <Toast
      nonce={toast.nonce}
      onDismiss={dismiss}
      persist={toastAction !== undefined}
      actionLabel={toastAction?.label}
      onAction={toastAction?.run}
    >
      {toast.message}
    </Toast>
  );

  if (editing !== undefined && editProfile !== undefined) {
    return (
      <section class="wb-page" aria-labelledby="rules-title">
        <h1 class="wb-title" id="rules-title" tabIndex={-1}>
          {text.title}
        </h1>
        {Editor === undefined ? (
          <div class="editor-loading" role="status" aria-busy="true">
            {copy.options.rules.loadingEditor}
          </div>
        ) : (
          <Editor
            key={`${editProfile.id}:${editing.ruleId ?? "new"}`}
            profileName={editProfile.name}
            profiles={doc.profiles}
            profileId={editProfile.id}
            rule={editingRule}
            grants={grants}
            modal={false}
            note={<DataNote />}
            onSave={(ruleId, draft, profileId) =>
              save(ruleId, draft, profileId, editProfile.id)
            }
            onDelete={
              editingRule === undefined
                ? undefined
                : () => deleteRule(editProfile.id, editingRule.id)
            }
            onRequestGrant={requestPermissions}
            onGrantDeclined={(host) =>
              showToast(copy.errors.grantDeclined(host))
            }
            onGranted={() => showToast(copy.toast.accessGranted)}
            onCommitted={(kind) =>
              showToast(
                kind === "create"
                  ? copy.toast.ruleCreated
                  : copy.toast.changesSaved,
              )
            }
            onClose={() => setEditing(undefined)}
          />
        )}
        {toastNode}
      </section>
    );
  }

  const empty = fleet.length === 0;

  return (
    <section class="wb-page" aria-labelledby="rules-title">
      <div class="wb-head">
        <h1 class="wb-title" id="rules-title" tabIndex={-1}>
          {text.title}
        </h1>
        {/* Nothing to group and nothing to add to: with no rules the empty
            state carries the one action, so the head carries neither. */}
        {!empty && (
          <div class="rules-controls">
            <Segmented
              semantics="pressed"
              label={text.lensLabel}
              value={lens}
              options={[
                { value: "site", label: text.bySite },
                { value: "header", label: text.byHeader },
              ]}
              onChange={setLens}
            />
            <Button kind="primary" onClick={newRule}>
              <PlusGlyph />
              {text.newRule}
            </Button>
          </div>
        )}
      </div>

      {empty ? (
        <div class="rules-card rules-card-empty">
          <EmptyState
            message={text.empty}
            actions={
              <Button kind="primary" onClick={newRule}>
                <PlusGlyph />
                {text.newRule}
              </Button>
            }
          />
        </div>
      ) : lens === "site" ? (
        <BySite
          fleet={fleet}
          onToggle={toggle}
          onGrant={grant}
          onEdit={setEditing}
        />
      ) : (
        <ByHeader
          fleet={fleet}
          onToggle={toggle}
          onGrant={grant}
          onEdit={setEditing}
        />
      )}

      {toastNode}
    </section>
  );
}

interface LensProps {
  fleet: readonly FleetRule[];
  onToggle: (rule: FleetRule, next: boolean) => void;
  onGrant: (rule: FleetRule) => void;
  onEdit: (editing: Editing) => void;
}

function BySite({ fleet, onToggle, onGrant, onEdit }: LensProps) {
  const groups = groupBySite(fleet);
  return (
    <div class="fleet">
      {groups.map((group) => (
        <section
          key={group.host}
          class="fleet-group"
          aria-label={group.kind === "cross-site" ? text.crossSite : group.host}
        >
          <div class="fleet-group-head">
            {group.kind === "cross-site" ? (
              <>
                <span class="fleet-host cross">{text.crossSite}</span>
                <span class="fleet-group-note">{text.crossSiteNote}</span>
              </>
            ) : (
              <span class="fleet-host mono">{group.host}</span>
            )}
            <span class="fleet-count">
              {text.siteRules(group.rules.length)}
            </span>
          </div>
          <div class="fleet-rows">
            {group.rules.map((rule) => (
              <FleetRow
                key={rule.key}
                rule={rule}
                showScope={group.kind === "cross-site"}
                sharedSites={
                  group.kind === "domain" && rule.siteCount > 1
                    ? rule.siteCount
                    : undefined
                }
                onToggle={onToggle}
                onGrant={onGrant}
                onEdit={onEdit}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ByHeader({ fleet, onToggle, onGrant, onEdit }: LensProps) {
  const groups = groupByHeader(fleet);
  return (
    <div class="fleet">
      {groups.map((group) => (
        <section
          key={group.headerKey}
          class="fleet-group"
          aria-label={group.header}
        >
          {/* A group of one has no aggregate to state: its head would print the
              header name the row prints below it, and a reach the row's own
              scope already gives. The head earns its space from two rules up. */}
          {group.rules.length > 1 && (
            <div class="fleet-group-head">
              <span class="fleet-host mono">{group.header}</span>
              <span class="fleet-count">
                {group.allSites
                  ? sentence(text.allReach(text.scope.all))
                  : group.broad && group.siteCount === 0
                    ? text.broadReach
                    : sentence(text.reaches(group.siteCount, group.broad))}
              </span>
            </div>
          )}
          <div class="fleet-rows">
            {group.rules.map((rule) => (
              <FleetRow
                key={rule.key}
                rule={rule}
                showScope
                onToggle={onToggle}
                onGrant={onGrant}
                onEdit={onEdit}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FleetRow({
  rule,
  showScope,
  sharedSites,
  onToggle,
  onGrant,
  onEdit,
}: {
  rule: FleetRule;
  showScope: boolean;
  sharedSites?: number | undefined;
  onToggle: (rule: FleetRule, next: boolean) => void;
  onGrant: (rule: FleetRule) => void;
  onEdit: (editing: Editing) => void;
}) {
  return (
    <div class={`fleet-row ${rule.status}`} data-key={rule.key}>
      <span class="spine" aria-hidden="true" />
      <span class="op">
        <DirectionGlyph direction={rule.direction} />
      </span>
      <button
        type="button"
        class="fleet-open"
        aria-label={text.editRule(
          copy.readout.direction[rule.direction],
          rule.header,
        )}
        onClick={() =>
          onEdit({ profileId: rule.profileId, ruleId: rule.ruleId })
        }
      >
        <span class="say">
          <ProfileBadge
            text={rule.provenance.badgeText}
            color={rule.provenance.color}
            size={15}
          />
          <span class="verb">{copy.readout.verb[rule.operation]}</span>{" "}
          <span class="k">{rule.header}</span>
          {rule.display !== undefined && (
            <>
              {" "}
              <span class="to" aria-hidden="true">
                {copy.readout.to}
              </span>{" "}
              <HeaderValue
                value={rule.display}
                secret={rule.secret}
                class="v"
              />
            </>
          )}
        </span>
        <FleetWhy rule={rule} showScope={showScope} sharedSites={sharedSites} />
        {/* The rule's own note is the one field that says why it exists, and it
            appeared nowhere but the editor that wrote it. */}
        {rule.comment !== undefined && (
          <Truncate mode="end" value={rule.comment} class="fleet-note" />
        )}
      </button>
      <div class="line-control">
        {rule.status === "needs-access" && (
          <button type="button" class="grant" onClick={() => onGrant(rule)}>
            {grantLabel(rule.missing)}
          </button>
        )}
        <Toggle
          checked={rule.enabled}
          label={copy.rules.switchLabel(rule.header, rule.enabled, sharedSites)}
          tone={toneForStatus(rule.status)}
          onChange={(next) => onToggle(rule, next)}
        />
      </div>
    </div>
  );
}

type ReasonTone = "rest" | "stop" | "amber";

// Why a rule is not running as authored, or nothing when it is. This is the
// state cell, independent of the scope cell that says what the rule matches.
function fleetReason(
  rule: FleetRule,
): { readonly tone: ReasonTone; readonly label: string } | undefined {
  switch (rule.status) {
    case "overridden":
      return rule.overriddenBy === undefined
        ? undefined
        : {
            tone: "rest",
            label: copy.readout.overriddenBy(rule.overriddenBy.label),
          };
    case "refused":
      return rule.refused === undefined
        ? undefined
        : { tone: "stop", label: copy.readout.refusedReason[rule.refused] };
    case "managed":
      return { tone: "amber", label: copy.readout.managedReason };
    case "out-of-sync":
      return { tone: "amber", label: copy.readout.outOfSyncReason };
    case "unconfirmed":
      return { tone: "rest", label: copy.readout.unconfirmedReason };
    // A rule in a profile that is not the active one reads as at-rest; the row
    // names the profile it lives in so its own colour glyph is not the only clue.
    case "off":
      return rule.profileEnabled
        ? undefined
        : { tone: "rest", label: text.notActiveProfile(rule.provenance.name) };
    default:
      return undefined;
  }
}

function FleetWhy({
  rule,
  showScope,
  sharedSites,
}: {
  rule: FleetRule;
  showScope: boolean;
  sharedSites: number | undefined;
}) {
  // Two independent lines: what the rule matches, and why it is not running.
  // They never share a slot, so a cross-site rule keeps the pattern that tells
  // it from its neighbour even while a status reason sits beneath it.
  const scope = showScope ? scopeLabel(rule) : undefined;
  const reason = fleetReason(rule);
  return (
    <>
      {scope !== undefined && (
        <span class="fleet-scope mono" title={scope}>
          {scope}
        </span>
      )}
      {sharedSites !== undefined && (
        <span class="fleet-scope">{text.sharedRule(sharedSites)}</span>
      )}
      {reason !== undefined && (
        <span class={`why ${reason.tone}`}>
          <span class="dot" aria-hidden="true" />
          {reason.label}
        </span>
      )}
    </>
  );
}

function scopeLabel(rule: FleetRule): string {
  switch (rule.scope.kind) {
    case "domains": {
      const [first, ...rest] = rule.scope.domains;
      return first === undefined
        ? text.scope.all
        : rest.length === 0
          ? first
          : `${first} +${rest.length}`;
    }
    case "all":
      return text.scope.all;
    case "pattern":
      return rule.scope.pattern;
    case "regex":
      return rule.scope.regex;
  }
}

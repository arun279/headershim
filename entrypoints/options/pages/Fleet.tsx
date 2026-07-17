import { useEffect, useState } from "preact/hooks";
import {
  domainFromOriginPattern,
  type GrantSnapshot,
} from "../../../src/core/grants";
import type { StateDoc } from "../../../src/core/model";
import { request as requestPermissions } from "../../../src/platform/permissions";
import { useAnnounce } from "../../../src/ui/a11y/LiveRegion";
import { OpGlyph, PlusGlyph } from "../../../src/ui/components/readout/glyphs";
import { ProfileBadge } from "../../../src/ui/components/readout/ProfileBadge";
import { sentence } from "../../../src/ui/components/sentence";
import { Toast } from "../../../src/ui/components/Toast";
import { Toggle } from "../../../src/ui/components/Toggle";
import { copy } from "../../../src/ui/copy";
import {
  type FleetRule,
  groupByHeader,
  groupBySite,
  projectFleet,
} from "../../../src/ui/state/fleet";
import type { Mutations } from "../../../src/ui/state/mutations";
import { useToast } from "../useToast";
import "./Fleet.css";

const text = copy.options.fleet;

type Lens = "site" | "header";
type Editing = { profileId: string; ruleId: string | undefined };

/**
 * The fleet: every rule across every profile, in one severity grammar. Grouping
 * by site answers "what lands here"; grouping by header answers "where does this
 * one header reach", the home for cross-site rules. Authoring reuses the shared
 * RuleEditor inline.
 */
export function FleetPage({
  doc,
  grants,
  mutations,
}: {
  doc: StateDoc;
  grants: GrantSnapshot;
  mutations: Mutations;
}) {
  const announce = useAnnounce();
  const [lens, setLens] = useState<Lens>("site");
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const { toast, show: showToast, flash, dismiss } = useToast();
  // The editor is the options page's one heavy dependency; load it on demand so
  // it never sits in the initial Workbench bundle.
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
    profiles: doc.profiles,
    activeProfileId: doc.activeProfileId,
    grants,
    paused: doc.settings.paused,
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

  const grant = (rule: FleetRule) => {
    const origins = rule.missing ?? [];
    void requestPermissions([...origins]).then((allowed) => {
      if (allowed) {
        const [first] = origins;
        announce(
          first === undefined
            ? copy.toast.accessGranted
            : copy.toast.activeOn(domainFromOriginPattern(first) ?? first),
        );
      }
    });
  };

  const newRule = () => {
    const target =
      doc.profiles.find((profile) => profile.id === doc.activeProfileId) ??
      doc.profiles[0];
    if (target !== undefined) {
      setEditing({ profileId: target.id, ruleId: undefined });
    }
  };

  if (editing !== undefined && editProfile !== undefined) {
    return (
      <section class="wb-page" aria-labelledby="fleet-title">
        <h1 class="wb-title" id="fleet-title" tabIndex={-1}>
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
            rule={editingRule}
            grants={grants}
            modal={false}
            onSave={(ruleId, draft) =>
              mutations.saveRule(editProfile.id, ruleId, draft)
            }
            onRequestGrant={requestPermissions}
            onGrantDeclined={(host) =>
              showToast(copy.errors.grantDeclined(host))
            }
            onGranted={(count) =>
              showToast(
                count.length === 1
                  ? copy.toast.activeOn(count[0] as string)
                  : copy.toast.activeOnSites(count.length),
              )
            }
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
        {toast !== undefined && <Toast onDismiss={dismiss}>{toast}</Toast>}
      </section>
    );
  }

  const noProfilesOn = !doc.profiles.some(
    (profile) => profile.id === doc.activeProfileId,
  );
  const empty = fleet.length === 0;

  return (
    <section class="wb-page" aria-labelledby="fleet-title">
      <div class="wb-head">
        <div>
          <h1 class="wb-title" id="fleet-title" tabIndex={-1}>
            {text.title}
          </h1>
          <p class="wb-sub">{text.subtitle}</p>
        </div>
        <div class="fleet-controls">
          <fieldset class="seg">
            <legend class="sr-only">{text.lensLabel}</legend>
            <button
              type="button"
              aria-pressed={lens === "site"}
              onClick={() => setLens("site")}
            >
              {text.bySite}
            </button>
            <button
              type="button"
              aria-pressed={lens === "header"}
              onClick={() => setLens("header")}
            >
              {text.byHeader}
            </button>
          </fieldset>
          <button type="button" class="wb-primary" onClick={newRule}>
            <PlusGlyph />
            {text.newRule}
          </button>
        </div>
      </div>

      {empty ? (
        <p class="fleet-empty">
          {noProfilesOn ? text.emptyProfileOff : text.empty}
        </p>
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

      {toast !== undefined && <Toast onDismiss={dismiss}>{toast}</Toast>}
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
          <div class="fleet-group-head">
            <span class="fleet-host mono">{group.header}</span>
            <span class="fleet-count">
              {group.broad && group.siteCount === 0
                ? text.broadReach
                : sentence(text.reaches(group.siteCount, group.broad))}
            </span>
          </div>
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
  onToggle,
  onGrant,
  onEdit,
}: {
  rule: FleetRule;
  showScope: boolean;
  onToggle: (rule: FleetRule, next: boolean) => void;
  onGrant: (rule: FleetRule) => void;
  onEdit: (editing: Editing) => void;
}) {
  return (
    <div class={`fleet-row ${rule.status}`} data-key={rule.key}>
      <span class="spine" aria-hidden="true" />
      <span class="op">
        <OpGlyph operation={rule.operation} />
      </span>
      <button
        type="button"
        class="fleet-open"
        aria-label={text.editRule(rule.header)}
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
              <span class="v">{rule.display}</span>
            </>
          )}
        </span>
        <FleetWhy rule={rule} showScope={showScope} />
      </button>
      <div class="line-control">
        {rule.status === "needs-access" && (
          <button type="button" class="grant" onClick={() => onGrant(rule)}>
            {copy.readout.grant}
          </button>
        )}
        <Toggle
          checked={rule.enabled}
          label={copy.rules.switchLabel(rule.header, rule.enabled)}
          tone={rule.status === "paused" ? "paused" : undefined}
          onChange={(next) => onToggle(rule, next)}
        />
      </div>
    </div>
  );
}

function FleetWhy({
  rule,
  showScope,
}: {
  rule: FleetRule;
  showScope: boolean;
}) {
  if (rule.status === "overridden" && rule.overriddenBy !== undefined) {
    return (
      <span class="why rest">
        <span class="dot" aria-hidden="true" />
        {copy.readout.overriddenBy(rule.overriddenBy.label)}
      </span>
    );
  }
  if (rule.status === "refused" && rule.refused === "host") {
    return (
      <span class="why stop">
        <span class="dot" aria-hidden="true" />
        {copy.readout.refusedReason.host}
      </span>
    );
  }
  // An enabled rule whose profile is off reads as at-rest; its own switch stays
  // on, so the reason it is not running is owed.
  if (rule.status === "off" && !rule.profileEnabled) {
    return (
      <span class="why rest">
        <span class="dot" aria-hidden="true" />
        {text.profileOff}
      </span>
    );
  }
  if (showScope) {
    return <span class="fleet-scope mono">{scopeLabel(rule)}</span>;
  }
  return null;
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
      return text.scope.pattern;
    case "regex":
      return text.scope.regex;
  }
}

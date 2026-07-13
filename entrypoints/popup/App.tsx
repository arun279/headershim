import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import type { Rule, RuleDraft } from "../../src/core/model";
import type { Result } from "../../src/core/result";
import { CURRENT } from "../../src/core/schema";
import { isRegexSupported } from "../../src/platform/dnr";
import { request as requestPermissions } from "../../src/platform/permissions";
import { activeTabDomain } from "../../src/platform/tabs";
import { LiveRegionProvider } from "../../src/ui/a11y/LiveRegion";
import { Annunciator } from "../../src/ui/components/Annunciator";
import { Button } from "../../src/ui/components/Button";
import { EmptyState } from "../../src/ui/components/EmptyState";
import { ProfileSwitcher } from "../../src/ui/components/ProfileSwitcher";
import { RuleEditor } from "../../src/ui/components/RuleEditor";
import { RuleList } from "../../src/ui/components/RuleList";
import { Toast } from "../../src/ui/components/Toast";
import { Toggle } from "../../src/ui/components/Toggle";
import { copy } from "../../src/ui/copy";
import {
  createMutations,
  type MutationError,
} from "../../src/ui/state/mutations";
import { type AppState, useAppState } from "../../src/ui/state/useAppState";
import { useInvalidRules } from "../../src/ui/state/useInvalidRules";
import { popupKeyHandler } from "./keyboard";
import "./App.css";

const mutations = createMutations({ validateRegex: isRegexSupported });

export function App() {
  const app = useAppState();

  if (app.phase === "initializing") {
    // Local data lands within a frame; a skeleton would only flash.
    return <main class="popup" aria-busy="true" />;
  }
  if (app.phase === "newer-store") {
    return (
      <main class="popup">
        <EmptyState
          message={copy.errors.newerStore(app.foundVersion, CURRENT)}
        />
      </main>
    );
  }
  return (
    <LiveRegionProvider>
      <Ready
        doc={app.doc}
        status={app.status}
        grantGaps={app.grantGaps}
        overrideCount={app.overrideCount}
      />
    </LiveRegionProvider>
  );
}

type ReadyProps = Omit<Extract<AppState, { phase: "ready" }>, "phase">;

interface PendingUndo {
  profileId: string;
  rule: Rule;
  index: number;
}

function Ready({ doc, status, grantGaps, overrideCount }: ReadyProps) {
  const [toast, setToast] = useState<
    { message: string; undo?: boolean } | undefined
  >(undefined);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | undefined>(
    undefined,
  );
  const [editing, setEditing] = useState<
    { profileId: string; ruleId?: string } | undefined
  >(undefined);
  const [tabDomain, setTabDomain] = useState<string | undefined>(undefined);
  useEffect(() => {
    void activeTabDomain().then(setTabDomain);
  }, []);
  const theme = doc.settings.theme;
  // The token stylesheet follows the OS unless the stored theme stamps the
  // root; System leaves it unset (tokens.css contract).
  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme]);
  const firstRun = doc.profiles.every((profile) => profile.rules.length === 0);
  const focused = doc.profiles.find(
    (profile) => profile.id === doc.focusedProfileId,
  );
  const someProfileEnabled = doc.profiles.some((profile) => profile.enabled);
  const enabledProfilesEmpty = doc.profiles.every(
    (profile) => !profile.enabled || profile.rules.length === 0,
  );
  const enabledProfiles = useMemo(
    () => doc.profiles.filter((profile) => profile.enabled),
    [doc],
  );
  const invalidRuleIds = useInvalidRules(enabledProfiles, isRegexSupported);
  const missingByRule = new Map(
    grantGaps.map((gap) => [gap.ruleId, gap.missing]),
  );

  // Editing state survives only as long as its targets do; a concurrent
  // options-page edit that removes them simply collapses the editor.
  const editingProfile =
    editing === undefined
      ? undefined
      : doc.profiles.find((profile) => profile.id === editing.profileId);
  const editingRule =
    editing?.ruleId === undefined
      ? undefined
      : editingProfile?.rules.find((rule) => rule.id === editing.ruleId);
  const activeEditing =
    editing !== undefined &&
    editingProfile !== undefined &&
    (editing.ruleId === undefined || editingRule !== undefined)
      ? editing
      : undefined;
  const openNewRule = () => setEditing({ profileId: doc.focusedProfileId });

  // A new rule lands in the focused profile even when that profile is off or
  // empty; its group appears for the editor's stay.
  const listProfiles =
    activeEditing !== undefined &&
    activeEditing.ruleId === undefined &&
    editingProfile !== undefined &&
    !enabledProfiles.some((profile) => profile.id === editingProfile.id)
      ? [...enabledProfiles, editingProfile]
      : enabledProfiles;

  const saveEditing = (
    target: { profileId: string; ruleId?: string },
    draft: RuleDraft,
  ) =>
    mutations
      .saveRule(target.profileId, target.ruleId, draft)
      .then((outcome) => {
        if (outcome.ok) {
          setPendingUndo(undefined);
        }
        return outcome;
      });

  // When the new-rule editor closes and focus fell with it, the + New rule
  // trigger takes it back; a focus the user moved stays put.
  const newRuleTrigger = useRef<HTMLSpanElement>(null);
  const wasEditingNew = useRef(false);
  useEffect(() => {
    const wasNew = wasEditingNew.current;
    wasEditingNew.current =
      activeEditing !== undefined && activeEditing.ruleId === undefined;
    if (!wasNew || activeEditing !== undefined) {
      return;
    }
    const active = document.activeElement;
    if (active === null || active === document.body) {
      newRuleTrigger.current?.querySelector("button")?.focus();
    }
  });

  const run = <T,>(mutation: Promise<Result<T, MutationError>>) => {
    void mutation.then((outcome) => {
      if (!outcome.ok) {
        const message = blockedCommitCopy(outcome.error);
        if (message !== undefined) {
          setToast({ message });
        }
        return;
      }
      // Undo is not timing-locked, but it only survives until the next
      // mutation; any other successful commit retires it.
      setPendingUndo(undefined);
    });
  };

  const deleteRule = (profileId: string, ruleId: string) => {
    void mutations.deleteRule(profileId, ruleId).then((outcome) => {
      if (outcome.ok) {
        setPendingUndo({ profileId, ...outcome.value });
        setToast({ message: copy.toast.ruleDeleted, undo: true });
      }
    });
  };

  const undoDelete = () => {
    if (pendingUndo === undefined) {
      return;
    }
    const { profileId, rule, index } = pendingUndo;
    void mutations.restoreRule(profileId, rule, index).then((outcome) => {
      if (outcome.ok) {
        setPendingUndo(undefined);
        setToast(undefined);
      }
    });
  };

  const onKeyDown = popupKeyHandler({
    newRule: openNewRule,
    togglePause: () => run(mutations.setPaused(status.kind !== "paused")),
    activateProfile: (position) => {
      const profile = doc.profiles[position - 1];
      if (profile !== undefined) {
        run(mutations.activateProfile(profile.id));
      }
    },
    toggleProfile: (position) => {
      const profile = doc.profiles[position - 1];
      if (profile !== undefined) {
        run(mutations.setProfileEnabled(profile.id, !profile.enabled));
      }
    },
    closePopup: () => window.close(),
  });

  const grantAccess = () => {
    // Must run synchronously in the click gesture; the resulting
    // permissions.onChanged event refreshes every surface at once.
    void requestPermissions([
      ...new Set(grantGaps.flatMap((gap) => gap.missing)),
    ]);
  };

  return (
    <main class="popup" onKeyDown={onKeyDown}>
      <ProfileSwitcher
        profiles={doc.profiles}
        focusedProfileId={doc.focusedProfileId}
        onActivate={(id) => run(mutations.activateProfile(id))}
        onToggle={(id) => {
          const target = doc.profiles.find((profile) => profile.id === id);
          if (target !== undefined) {
            run(mutations.setProfileEnabled(id, !target.enabled));
          }
        }}
        autoFocus={!firstRun}
      />
      <Annunciator
        status={status}
        temporaryCount={overrideCount}
        onResume={() => run(mutations.setPaused(false))}
        onGrantAccess={grantAccess}
      />
      <div
        class={status.kind === "paused" ? "popup-body paused" : "popup-body"}
      >
        {activeEditing === undefined && firstRun ? (
          <FirstRun onCreateRule={openNewRule} />
        ) : activeEditing === undefined &&
          someProfileEnabled &&
          enabledProfilesEmpty &&
          focused !== undefined ? (
          <EmptyState
            message={copy.emptyState.profile(focused.name)}
            actions={
              <Button kind="primary" onClick={openNewRule}>
                {copy.actions.newRule}
              </Button>
            }
          />
        ) : (
          <RuleList
            profiles={listProfiles}
            allProfiles={doc.profiles}
            missingByRule={missingByRule}
            invalidRuleIds={invalidRuleIds}
            undoAvailable={pendingUndo !== undefined}
            editing={
              activeEditing === undefined
                ? undefined
                : {
                    profileId: activeEditing.profileId,
                    ruleId: activeEditing.ruleId,
                    node: (
                      <RuleEditor
                        key={activeEditing.ruleId ?? "new-rule"}
                        rule={editingRule}
                        prefillDomain={
                          activeEditing.ruleId === undefined
                            ? tabDomain
                            : undefined
                        }
                        onSave={(draft) => saveEditing(activeEditing, draft)}
                        onClose={() => setEditing(undefined)}
                      />
                    ),
                  }
            }
            onToggle={(profileId, ruleId, enabled) =>
              run(mutations.setRuleEnabled(profileId, ruleId, enabled))
            }
            onEdit={(profileId, ruleId) => setEditing({ profileId, ruleId })}
            onDelete={deleteRule}
            onDuplicate={(profileId, ruleId) =>
              run(mutations.duplicateRule(profileId, ruleId))
            }
            onMove={(profileId, ruleId, toProfileId) =>
              run(mutations.moveRuleToProfile(profileId, ruleId, toProfileId))
            }
            onRegenerate={(profileId, ruleId) =>
              run(mutations.regenerateValue(profileId, ruleId))
            }
            onUndoDelete={undoDelete}
          />
        )}
      </div>
      <footer class="foot">
        <span class="foot-new-rule" ref={newRuleTrigger}>
          <Button kind="primary" onClick={openNewRule}>
            {copy.actions.newRule}
          </Button>
        </span>
        <Button kind="quiet">{copy.actions.verify}</Button>
        <span class="pause">
          {copy.actions.pause}
          <Toggle
            checked={status.kind === "paused"}
            label={copy.actions.globalPause}
            onChange={(paused) => run(mutations.setPaused(paused))}
          />
        </span>
        <Button
          kind="ghost"
          label={copy.actions.options}
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          <GearGlyph />
        </Button>
      </footer>
      {toast !== undefined && (
        <Toast
          onDismiss={() => setToast(undefined)}
          actionLabel={toast.undo === true ? copy.actions.undo : undefined}
          onAction={toast.undo === true ? undoDelete : undefined}
        >
          {toast.message}
        </Toast>
      )}
    </main>
  );
}

/** First run is onboarding: the trust sentence and three equal ways in. */
function FirstRun({ onCreateRule }: { onCreateRule: () => void }) {
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => {
    first.current?.querySelector("button")?.focus();
  }, []);

  return (
    <div class="first-run" ref={first}>
      <p class="first-run-tagline">{copy.app.tagline}</p>
      <div class="first-run-actions">
        <Button kind="quiet">{copy.firstRun.tryThisTab}</Button>
        <Button kind="quiet" onClick={onCreateRule}>
          {copy.firstRun.createRule}
        </Button>
        <Button
          kind="quiet"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          {copy.firstRun.importFile}
        </Button>
      </div>
    </div>
  );
}

/**
 * The switcher and footer can hit blocking save rules (rule cap, regex, byte
 * budget); the popup's surface for those is a toast. Errors without popup-level
 * copy (stale ids from a concurrent options-page edit) resolve themselves on
 * the storage re-render and stay silent.
 */
function blockedCommitCopy(error: MutationError): string | undefined {
  switch (error.kind) {
    case "enabled-rule-limit-exceeded":
      return copy.errors.ruleCap;
    case "regex-rule-limit-exceeded":
      return copy.errors.regexRuleCap;
    case "doc-byte-limit-exceeded":
      return copy.errors.storageBudget;
    case "regex-invalid":
      // Chrome's validator distinguishes an oversized compilation from a
      // dialect error; the fix directions differ.
      return error.reason === "memoryLimitExceeded"
        ? copy.errors.regexOversize
        : copy.errors.regexInvalid;
    default:
      return undefined;
  }
}

function GearGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.2v2M8 12.8v2M1.2 8h2M12.8 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4" />
    </svg>
  );
}

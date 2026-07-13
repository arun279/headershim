import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import { domainFromOriginPattern } from "../../src/core/grants";
import { decodeMatches } from "../../src/core/matches";
import type { Rule, RuleDraft, TabOverride } from "../../src/core/model";
import type { Result } from "../../src/core/result";
import { CURRENT } from "../../src/core/schema";
import { summarizeVerify, type VerifyReadout } from "../../src/core/verify";
import { isRegexSupported } from "../../src/platform/dnr";
import { request as requestPermissions } from "../../src/platform/permissions";
import { activeTabDomain } from "../../src/platform/tabs";
import { matchedRulesForActiveTab } from "../../src/platform/verify";
import { LiveRegionProvider, useAnnounce } from "../../src/ui/a11y/LiveRegion";
import { Annunciator } from "../../src/ui/components/Annunciator";
import { Button } from "../../src/ui/components/Button";
import { EmptyState } from "../../src/ui/components/EmptyState";
import { ProfileSwitcher } from "../../src/ui/components/ProfileSwitcher";
import { RuleEditor } from "../../src/ui/components/RuleEditor";
import { RuleList } from "../../src/ui/components/RuleList";
import { overrideToRuleDraft, ThisTab } from "../../src/ui/components/ThisTab";
import { Toast } from "../../src/ui/components/Toast";
import { Toggle } from "../../src/ui/components/Toggle";
import { VerifyPanel } from "../../src/ui/components/VerifyPanel";
import { copy } from "../../src/ui/copy";
import { blockedCommitCopy } from "../../src/ui/state/commit-copy";
import {
  createMutations,
  type MutationError,
} from "../../src/ui/state/mutations";
import {
  pruneForeignOrigins,
  removeOverride,
} from "../../src/ui/state/session-mutations";
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
        grants={app.grants}
        grantGaps={app.grantGaps}
        tabId={app.tabId}
        overrides={app.overrides}
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

interface Editing {
  profileId: string;
  ruleId?: string;
  /** A full draft to seed a new rule from (This-tab "Save as rule…", §3.5). */
  prefill?: RuleDraft;
  /** The temporary row this new rule promotes; removed once the rule saves. */
  promote?: { tabId: number; num: number };
}

function Ready({
  doc,
  status,
  grants,
  grantGaps,
  tabId,
  overrides,
}: ReadyProps) {
  const announce = useAnnounce();
  const [toast, setToast] = useState<
    { message: string; undo?: boolean; reload?: boolean } | undefined
  >(undefined);
  // A freshly mounted role=status node with its text already present is not
  // reliably announced, so every toast also speaks through the persistent
  // polite region (SiteAccess does the same for its grant outcomes).
  const showToast = (message: string, undo?: boolean) => {
    setToast(undo === true ? { message, undo } : { message });
    announce(message);
  };
  // The permission→reload handoff (verdict P1): a grant lands, the change is
  // live, but the open page still holds its pre-grant response. The toast
  // hands over a single Reload-tab action rather than reloading unbidden.
  const showReloadToast = (message: string) => {
    setToast({ message, reload: true });
    announce(message);
  };
  const reloadTab = () => {
    // The click is a fresh gesture, so activeTab covers the reload with no new
    // permission (SPEC §4.3).
    void browser.tabs.reload();
    setToast(undefined);
  };
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | undefined>(
    undefined,
  );
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [composing, setComposing] = useState(false);
  const [verify, setVerify] = useState<VerifyReadout | undefined>(undefined);
  // The just-saved rule and a changing token, to pulse that row's transient
  // "Saved" acknowledgement (verdict P0). Cleared whenever an editor opens so a
  // later revert can't resurrect a stale pulse.
  const [savedPulse, setSavedPulse] = useState<
    { ruleId: string; nonce: number } | undefined
  >(undefined);
  // Focus returns here when the verify panel closes (SPEC §9).
  const verifyTrigger = useRef<HTMLSpanElement>(null);
  const [tabDomain, setTabDomain] = useState<string | undefined>(undefined);
  const [tabResolved, setTabResolved] = useState(false);
  useEffect(() => {
    void activeTabDomain().then((host) => {
      setTabDomain(host);
      setTabResolved(true);
    });
  }, []);
  // Fallback lifetime enforcement (SPEC §3.5): the background prunes a tab's
  // overrides on cross-origin navigation, but a navigation it slept through
  // leaves stale rows the popup must not surface as live — so prune once on
  // open against where the tab actually sits now.
  const prunedRef = useRef(false);
  useEffect(() => {
    if (prunedRef.current || !tabResolved || tabId === undefined) {
      return;
    }
    prunedRef.current = true;
    void pruneForeignOrigins(tabId, tabDomain);
  }, [tabResolved, tabId, tabDomain]);
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
  const openNewRule = () => {
    setSavedPulse(undefined);
    setComposing(false);
    setEditing({ profileId: doc.focusedProfileId });
  };
  const editRule = (profileId: string, ruleId: string) => {
    setSavedPulse(undefined);
    setEditing({ profileId, ruleId });
  };
  const openThisTabComposer = () => {
    setEditing(undefined);
    setComposing(true);
  };
  // Promote a temporary row into a real rule in the focused profile (§3.5):
  // open the editor pre-filled and enter the normal grant flow; the row is
  // retired once the rule commits (saveEditing), not on open, so an Esc keeps
  // the temporary override intact.
  const saveAsRule = (override: TabOverride) => {
    setSavedPulse(undefined);
    setComposing(false);
    setEditing({
      profileId: doc.focusedProfileId,
      prefill: overrideToRuleDraft(override, tabDomain ?? override.originHost),
      promote: { tabId: override.tabId, num: override.num },
    });
  };

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
    profileId: string,
    ruleId: string | undefined,
    draft: RuleDraft,
    promote: Editing["promote"],
  ) =>
    mutations.saveRule(profileId, ruleId, draft).then((outcome) => {
      if (outcome.ok) {
        setPendingUndo(undefined);
        setSavedPulse((prev) => ({
          ruleId: outcome.value.id,
          nonce: (prev?.nonce ?? 0) + 1,
        }));
        // The promotion's source row is retired on its first commit — the one
        // that creates the rule (ruleId was undefined); a later grant-scope
        // save of the same rule must not remove it twice.
        if (ruleId === undefined && promote !== undefined) {
          void removeOverride(promote.tabId, promote.num);
        }
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
          showToast(message);
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
        showToast(copy.toast.ruleDeleted, true);
      }
    });
  };

  const undoDelete = () => {
    if (pendingUndo === undefined) {
      return;
    }
    const { profileId, rule, index } = pendingUndo;
    void mutations.restoreRule(profileId, rule, index).then((outcome) => {
      // One shot either way: a restore that failed (rule cap reached, profile
      // deleted underneath) won't succeed on a retry of the same undo.
      setPendingUndo(undefined);
      if (outcome.ok) {
        setToast(undefined);
        return;
      }
      const message = blockedCommitCopy(outcome.error);
      if (message === undefined) {
        setToast(undefined);
      } else {
        showToast(message);
      }
    });
  };

  // Verify is on-demand and per-tab (SPEC §5): the click/`v` gesture grants
  // activeTab, so the active tab is resolved and its matched-rules record
  // fetched with the tab id explicit. Tallies come from decodeMatches for
  // stable-id attribution; the hints Verify may name stay statically
  // determinable (core/verify). Session matches never enter the profile-rule
  // count, so the decode overrides are empty here.
  const needsAccessRuleIds = useMemo(
    () => new Set(grantGaps.map((gap) => gap.ruleId)),
    [grantGaps],
  );
  // Verify leads with the most basic unmet precondition (verdict P0): a grant
  // gap outranks the caching essay, and its recovery (Grant) is surfaced in the
  // panel so the user never has to dismiss it to reach the banner it covers.
  const blockedHosts = useMemo(() => {
    const hosts: string[] = [];
    for (const gap of grantGaps) {
      for (const origin of gap.missing) {
        const host =
          domainFromOriginPattern(origin) ?? copy.scopeSummary.allSites;
        if (!hosts.includes(host)) {
          hosts.push(host);
        }
      }
    }
    return hosts;
  }, [grantGaps]);
  const verifyBlocked =
    grantGaps.length > 0 && blockedHosts.length > 0
      ? {
          ruleCount: grantGaps.length,
          host: blockedHosts[0] as string,
          moreSites: blockedHosts.length - 1,
        }
      : undefined;
  const runVerify = () => {
    void matchedRulesForActiveTab().then((active) => {
      setVerify(
        summarizeVerify({
          profiles: enabledProfiles,
          matches: decodeMatches(doc, [], active?.matches ?? []),
          tabHost: tabDomain,
          needsAccessRuleIds,
        }),
      );
    });
  };
  const closeVerify = () => {
    setVerify(undefined);
    verifyTrigger.current?.querySelector("button")?.focus();
  };

  const onKeyDown = popupKeyHandler({
    newRule: openNewRule,
    newThisTabOverride: openThisTabComposer,
    verify: runVerify,
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

  // A grant from the editor's panel lands; the loud surfaces clear themselves
  // when the refreshed snapshot empties the gaps. The toast (a polite live
  // region) states the outcome.
  const announceGrant = (sites: readonly string[]) => {
    showReloadToast(
      sites.length === 1
        ? copy.toast.activeOn(sites[0] as string)
        : copy.toast.activeOnSites(sites.length),
    );
  };

  const grantAccess = () => {
    // Must run synchronously in the click gesture; the resulting
    // permissions.onChanged event refreshes every surface at once. The reload
    // handoff (verdict P1) follows the grant's outcome for the annunciator and
    // Verify Grant paths, which name no single site.
    void requestPermissions([
      ...new Set(grantGaps.flatMap((gap) => gap.missing)),
    ]).then((granted) => {
      if (granted) {
        showReloadToast(copy.toast.accessGranted);
      }
    });
  };

  return (
    // tabIndex -1 (not a tab stop) lets removing the last This-tab override,
    // which unmounts its whole section, land focus on the popup landmark rather
    // than <body> (WCAG 2.4.3).
    <main class="popup" tabIndex={-1} onKeyDown={onKeyDown}>
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
        temporaryCount={overrides.length}
        onResume={() => run(mutations.setPaused(false))}
        onGrantAccess={grantAccess}
      />
      <div
        class={status.kind === "paused" ? "popup-body paused" : "popup-body"}
        // The verify panel slides up opaque over the footer and rule region;
        // marking them inert keeps Shift+Tab from landing on controls hidden
        // behind it (WCAG 2.4.11) without trapping focus (SPEC §5/§9).
        inert={verify !== undefined}
      >
        <ThisTab
          tabId={tabId}
          host={tabDomain}
          overrides={overrides}
          composing={composing}
          onSaveAsRule={saveAsRule}
          onCreateRule={openNewRule}
          onCloseComposer={() => setComposing(false)}
        />
        {activeEditing === undefined && firstRun ? (
          // The This-tab section stands in for the hero once it has a row or an
          // open composer; the trust hero only shows on a truly empty open.
          overrides.length > 0 || composing ? null : (
            <FirstRun
              onCreateRule={openNewRule}
              onTryThisTab={openThisTabComposer}
            />
          )
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
            savedRuleId={savedPulse?.ruleId}
            savedNonce={savedPulse?.nonce}
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
                        prefill={activeEditing.prefill}
                        prefillDomain={
                          activeEditing.ruleId === undefined &&
                          activeEditing.prefill === undefined
                            ? tabDomain
                            : undefined
                        }
                        grants={grants}
                        tabDomain={tabDomain}
                        onSave={(ruleId, draft) =>
                          saveEditing(
                            activeEditing.profileId,
                            ruleId,
                            draft,
                            activeEditing.promote,
                          )
                        }
                        onRequestGrant={requestPermissions}
                        onGranted={announceGrant}
                        onClose={() => setEditing(undefined)}
                      />
                    ),
                  }
            }
            onToggle={(profileId, ruleId, enabled) =>
              run(mutations.setRuleEnabled(profileId, ruleId, enabled))
            }
            onEdit={editRule}
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
      <footer class="foot" inert={verify !== undefined}>
        {/* While empty, the first-run hero owns the single primary "Create a
            rule"; the footer's + New rule would be a redundant second one
            (verdict P1), so it collapses until the first rule exists. */}
        {!firstRun && (
          <span class="foot-new-rule" ref={newRuleTrigger}>
            <Button kind="primary" onClick={openNewRule}>
              {copy.actions.newRule}
            </Button>
          </span>
        )}
        <span class="foot-verify" ref={verifyTrigger}>
          <Button kind="quiet" onClick={runVerify}>
            {copy.actions.verify}
          </Button>
        </span>
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
          // The action follows the pending undo, not the toast: a mutation
          // that retires the undo strips the button from a toast still shown.
          actionLabel={
            toast.undo === true && pendingUndo !== undefined
              ? copy.actions.undo
              : toast.reload === true
                ? copy.actions.reloadTab
                : undefined
          }
          onAction={
            toast.undo === true && pendingUndo !== undefined
              ? undoDelete
              : toast.reload === true
                ? reloadTab
                : undefined
          }
        >
          {toast.message}
        </Toast>
      )}
      {verify !== undefined && (
        <VerifyPanel
          readout={verify}
          blocked={verifyBlocked}
          onGrant={grantAccess}
          onReload={() => {
            void browser.tabs.reload();
            closeVerify();
          }}
          onClose={closeVerify}
        />
      )}
    </main>
  );
}

/**
 * First run is onboarding with one obvious act (verdict P1): the wordmark and
 * trust sentence, a single primary "Create a rule" that focus lands on, and two
 * ranked-below routes — "Try it" (with its temporary/persistent tell) and
 * Import — as quiet secondaries.
 */
function FirstRun({
  onCreateRule,
  onTryThisTab,
}: {
  onCreateRule: () => void;
  onTryThisTab: () => void;
}) {
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => {
    first.current?.querySelector("button")?.focus();
  }, []);

  return (
    <div class="first-run" ref={first}>
      <span class="first-run-wordmark mono">{copy.app.name}</span>
      <p class="first-run-tagline">{copy.app.tagline}</p>
      <div class="first-run-actions">
        <Button kind="primary" onClick={onCreateRule}>
          {copy.firstRun.createRule}
        </Button>
        <div class="first-run-secondary">
          <Button kind="quiet" onClick={onTryThisTab}>
            {copy.firstRun.tryThisTab}
          </Button>
          <p class="first-run-subline">{copy.firstRun.tryThisTabSubline}</p>
        </div>
        <Button
          kind="quiet"
          onClick={() =>
            void browser.tabs.create({
              url: browser.runtime.getURL("/options.html#import-export"),
            })
          }
        >
          {copy.firstRun.importFile}
        </Button>
      </div>
    </div>
  );
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

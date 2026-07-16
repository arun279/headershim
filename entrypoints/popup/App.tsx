import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { browser } from "wxt/browser";
import { availableProfileName } from "../../src/core/codec/headershim";
import { domainFromOriginPattern } from "../../src/core/grants";
import { decodeMatches } from "../../src/core/matches";
import {
  BADGE_COLORS,
  type Rule,
  type RuleDraft,
  type TabOverride,
} from "../../src/core/model";
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
import { RuleEditor } from "../../src/ui/components/RuleEditor";
import { RuleList } from "../../src/ui/components/RuleList";
import { overrideToRuleDraft, ThisTab } from "../../src/ui/components/ThisTab";
import { Toast } from "../../src/ui/components/Toast";
import { Toggle } from "../../src/ui/components/Toggle";
import { VerifyResult } from "../../src/ui/components/VerifyPanel";
import { copy } from "../../src/ui/copy";
import { blockedCommitCopy } from "../../src/ui/state/commit-copy";
import {
  createMutations,
  type MutationError,
} from "../../src/ui/state/mutations";
import {
  pruneForeignOrigins,
  removeOverride,
  restoreOverride,
} from "../../src/ui/state/session-mutations";
import { type AppState, useAppState } from "../../src/ui/state/useAppState";
import { useInvalidRules } from "../../src/ui/state/useInvalidRules";
import { applyTheme } from "../../src/ui/theme";
import { popupKeyHandler } from "./keyboard";
import { PopupHeader } from "./PopupHeader";
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
  /** A full draft to seed a new rule from (This-tab "Save as rule…"). */
  prefill?: RuleDraft;
  /** The temporary row this new rule promotes, retained for discard recovery. */
  promote?: { override: TabOverride; index: number };
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
  // The permission-to-reload transition: a grant lands, the change is
  // live, but the open page still holds its pre-grant response. The toast
  // hands over a single Reload-tab action rather than reloading unbidden.
  const showReloadToast = (message: string) => {
    setToast({ message, reload: true });
    announce(message);
  };
  const reloadTab = () => {
    // The click is a fresh gesture, so activeTab covers the reload with no new
    // permission.
    void browser.tabs.reload();
    setToast(undefined);
  };
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | undefined>(
    undefined,
  );
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [composing, setComposing] = useState(false);
  const [verify, setVerify] = useState<VerifyReadout | undefined>(undefined);
  const editorReturn = useRef<
    { kind: "new" } | { kind: "rule"; ruleId: string }
  >({ kind: "new" });
  const [tabDomain, setTabDomain] = useState<string | undefined>(undefined);
  const [tabResolved, setTabResolved] = useState(false);
  useEffect(() => {
    void activeTabDomain().then((host) => {
      setTabDomain(host);
      setTabResolved(true);
    });
  }, []);
  // Fallback lifetime enforcement: the background prunes a tab's
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
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const firstRun = doc.profiles.every((profile) => profile.rules.length === 0);
  const showFirstRun = firstRun && overrides.length === 0 && !composing;
  const focused = doc.profiles.find(
    (profile) => profile.id === doc.focusedProfileId,
  );
  const showEmptyProfile =
    !firstRun && focused !== undefined && focused.rules.length === 0;
  const enabledProfiles = useMemo(
    () => doc.profiles.filter((profile) => profile.enabled),
    [doc],
  );
  const enabledOverrides = useMemo(
    () => overrides.filter((override) => override.enabled),
    [overrides],
  );
  const hasEnabledProfileRules = enabledProfiles.some(
    (profile) => profile.rules.length > 0,
  );
  const showFooterNewRule = !firstRun && !showEmptyProfile;
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
    editorReturn.current = { kind: "new" };
    setVerify(undefined);
    setComposing(false);
    setEditing({ profileId: doc.focusedProfileId });
  };
  const editRule = (profileId: string, ruleId: string) => {
    editorReturn.current = { kind: "rule", ruleId };
    setVerify(undefined);
    setEditing({ profileId, ruleId });
  };
  const openThisTabComposer = () => {
    setEditing(undefined);
    setComposing(true);
  };
  // Promote a temporary row into a real rule in the focused profile:
  // open the editor pre-filled and enter the normal grant flow; the row is
  // retired once the rule commits (saveEditing), not on open, so an Esc keeps
  // the temporary override intact.
  const saveAsRule = (override: TabOverride) => {
    editorReturn.current = { kind: "new" };
    setComposing(false);
    setEditing({
      profileId: doc.focusedProfileId,
      prefill: overrideToRuleDraft(override, tabDomain ?? override.originHost),
      promote: {
        override,
        index: Math.max(
          0,
          overrides.findIndex((candidate) => candidate.num === override.num),
        ),
      },
    });
  };

  const saveEditing = async (
    profileId: string,
    ruleId: string | undefined,
    draft: RuleDraft,
    promote: Editing["promote"],
  ) => {
    const outcome = await mutations.saveRule(profileId, ruleId, draft);
    if (outcome.ok) {
      setPendingUndo(undefined);
      // The promotion's source row is retired on its first commit. Waiting for
      // the removal keeps discard recovery ordered behind this write.
      if (ruleId === undefined && promote !== undefined) {
        await removeOverride(promote.override.tabId, promote.override.num);
      }
    }
    return outcome;
  };

  const updateRuleValue = async (
    profileId: string,
    rule: Rule,
    value: string,
  ): Promise<boolean> => {
    const { id: _id, num: _num, generated: _generated, ...unchanged } = rule;
    const outcome = await mutations.saveRule(profileId, rule.id, {
      ...unchanged,
      value,
    });
    if (!outcome.ok) {
      const message = blockedCommitCopy(outcome.error);
      if (message !== undefined) showToast(message);
      return false;
    }
    setPendingUndo(undefined);
    showToast(copy.toast.changesSaved);
    return true;
  };

  // When the new-rule editor closes and focus fell with it, the + New rule
  // trigger takes it back; a focus the user moved stays put.
  const newRuleTrigger = useRef<HTMLSpanElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    const wasOpen = wasEditing.current;
    wasEditing.current = activeEditing !== undefined;
    if (!wasOpen || activeEditing !== undefined) {
      return;
    }
    const target = editorReturn.current;
    if (target.kind === "rule") {
      document
        .querySelector<HTMLElement>(`[data-rule-id="${target.ruleId}"]`)
        ?.focus();
      return;
    }
    const fallback = document.querySelector<HTMLButtonElement>(
      ".first-run-actions .primary, .empty-state .primary",
    );
    (newRuleTrigger.current?.querySelector("button") ?? fallback)?.focus();
  });

  useEffect(() => {
    if (editing !== undefined && activeEditing === undefined) {
      setEditing(undefined);
    }
  }, [editing, activeEditing]);

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

  const profileCommit = async <T,>(
    mutation: Promise<Result<T, MutationError>>,
  ) => {
    const outcome = await mutation;
    if (outcome.ok) {
      setPendingUndo(undefined);
      return { ok: true } as const;
    }
    return {
      ok: false,
      error: blockedCommitCopy(outcome.error) ?? copy.profiles.saveError,
    } as const;
  };

  const createProfile = (name: string, duplicateCurrentRules: boolean) =>
    profileCommit(
      mutations.createProfile({
        name,
        color:
          BADGE_COLORS[doc.profiles.length % BADGE_COLORS.length] ??
          BADGE_COLORS[0],
        enabled: true,
        exclusive: true,
        ...(duplicateCurrentRules
          ? { duplicateFromProfileId: doc.focusedProfileId }
          : {}),
      }),
    );

  const openOptionsSection = (section: "profiles" | "import-export") => {
    void browser.tabs.create({
      url: browser.runtime.getURL(`/options.html#${section}`),
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

  // Verify is on-demand and per-tab: the click/`v` gesture grants
  // activeTab, so the active tab is resolved and its matched-rules record
  // fetched with the tab id explicit. Tallies come from decodeMatches for
  // stable-id attribution. Session matches never enter the profile-rule count,
  // so the decode overrides are empty here.
  // Verify leads with the most basic unmet precondition: a grant gap outranks
  // the match readout.
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
  const popupBodyRef = useRef<HTMLDivElement>(null);
  const singleBlockedRuleId =
    grantGaps.length === 1 && blockedHosts.length === 1
      ? grantGaps[0]?.ruleId
      : undefined;
  const singleBlockedRowVisible = useBlockedRowVisibility(
    popupBodyRef,
    singleBlockedRuleId,
  );
  const showStatusGrant =
    blockedHosts.length > 1 ||
    (singleBlockedRuleId !== undefined && !singleBlockedRowVisible);
  const runVerify = () => {
    setEditing(undefined);
    void matchedRulesForActiveTab().then((active) => {
      setVerify(
        summarizeVerify({
          profiles: enabledProfiles,
          matches: decodeMatches(doc, [], active?.matches ?? []),
        }),
      );
    });
  };
  const onKeyDown = popupKeyHandler({
    newRule: openNewRule,
    newThisTabOverride: openThisTabComposer,
    verify: () => {
      if (hasEnabledProfileRules) runVerify();
    },
    togglePause: () => {
      if (hasEnabledProfileRules) {
        run(mutations.setPaused(status.kind !== "paused"));
      }
    },
    focusProfile: (position) => {
      const profile = doc.profiles[position - 1];
      if (profile !== undefined) {
        run(mutations.focusProfile(profile.id));
      }
    },
    toggleProfile: (position) => {
      const profile = doc.profiles[position - 1];
      if (profile !== undefined) {
        run(mutations.setProfileEnabled(profile.id, !profile.enabled, false));
      }
    },
    closePopup: () => window.close(),
  });

  // Popup-wide commands stay available before the user places focus. Row,
  // menu, and editor handlers consume their own keys before they reach here.
  useEffect(() => {
    if (activeEditing !== undefined) {
      return;
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeEditing, onKeyDown]);

  // A grant from the editor's panel lands; the loud surfaces clear themselves
  // when the refreshed snapshot empties the gaps. The toast (a polite live
  // region) states the outcome.
  const announceGrant = () => showToast(copy.toast.ruleLive);

  const grantAccess = () => {
    // Must run synchronously in the click gesture; the resulting
    // permissions.onChanged event refreshes every surface at once. The reload
    // prompt follows the grant's outcome for the annunciator path, which names
    // no single site.
    void requestPermissions([
      ...new Set(grantGaps.flatMap((gap) => gap.missing)),
    ]).then((granted) => {
      if (granted) {
        showReloadToast(copy.toast.accessGranted);
      }
    });
  };

  const grantRuleAccess = (origins: readonly string[]) => {
    const granted = requestPermissions([...origins]);
    void granted.then((allowed) => {
      if (allowed) {
        showReloadToast(copy.toast.accessGranted);
      }
    });
  };

  const discardEditingRule = async (
    profileId: string,
    ruleId: string,
    promote: Editing["promote"],
  ) => {
    const outcome = await mutations.deleteRule(profileId, ruleId);
    if (!outcome.ok) {
      const message = blockedCommitCopy(outcome.error);
      if (message !== undefined) {
        showToast(message);
      }
      return;
    }
    if (promote !== undefined) {
      await restoreOverride(promote.override, promote.index);
    }
  };

  const popupHeader = (
    <PopupHeader
      profiles={doc.profiles}
      focusedProfileId={doc.focusedProfileId}
      newProfileName={availableProfileName(
        copy.options.profiles.newName,
        doc.profiles,
        [],
      )}
      theme={theme}
      onFocusProfile={(id) => run(mutations.focusProfile(id))}
      onToggleProfile={(id, enabled) =>
        profileCommit(mutations.setProfileEnabled(id, enabled, false))
      }
      onCreateProfile={createProfile}
      onRenameProfile={(id, name) =>
        profileCommit(mutations.renameProfile(id, name))
      }
      onCloneProfile={(id) => profileCommit(mutations.cloneProfile(id))}
      onManageProfiles={() => openOptionsSection("profiles")}
      onThemeChange={(next) => run(mutations.setTheme(next))}
      onOpenOptions={() => void browser.runtime.openOptionsPage()}
    />
  );

  return (
    // tabIndex -1 (not a tab stop) lets removing the last This-tab override,
    // which unmounts its whole section, land focus on the popup landmark rather
    // than <body> (WCAG 2.4.3).
    <main class={showFirstRun ? "popup first-run-mode" : "popup"} tabIndex={-1}>
      {activeEditing !== undefined && editingProfile !== undefined ? (
        <RuleEditor
          key={activeEditing.ruleId ?? "new-rule"}
          profileName={editingProfile.name}
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
          onCommitted={(kind) =>
            showToast(
              kind === "create"
                ? copy.toast.ruleCreated
                : copy.toast.changesSaved,
            )
          }
          onGrantStep={() => setToast(undefined)}
          onGranted={announceGrant}
          onDiscardRule={(ruleId) =>
            discardEditingRule(
              activeEditing.profileId,
              ruleId,
              activeEditing.promote,
            )
          }
          onClose={() => setEditing(undefined)}
        />
      ) : (
        <>
          {popupHeader}
          {!showFirstRun && (
            <Annunciator
              status={status}
              temporaryCount={enabledOverrides.length}
              activeProfileCount={enabledProfiles.length}
              onResume={() => run(mutations.setPaused(false))}
              onGrantAccess={showStatusGrant ? grantAccess : undefined}
            />
          )}
          <div
            ref={popupBodyRef}
            class={
              status.kind === "paused" ? "popup-body paused" : "popup-body"
            }
          >
            {!showFirstRun && (
              <ThisTab
                tabId={tabId}
                host={tabDomain}
                overrides={overrides}
                composing={composing}
                onOpenComposer={openThisTabComposer}
                onSaveAsRule={saveAsRule}
                onCloseComposer={() => setComposing(false)}
              />
            )}
            {firstRun ? (
              showFirstRun ? (
                <FirstRun
                  onCreateRule={openNewRule}
                  onTryThisTab={openThisTabComposer}
                />
              ) : null
            ) : showEmptyProfile && focused !== undefined ? (
              <EmptyState
                message={copy.emptyState.profile(focused.name)}
                detail={copy.emptyState.otherProfilesUnchanged}
                actions={
                  <Button kind="primary" onClick={openNewRule}>
                    {copy.actions.createRule}
                  </Button>
                }
              />
            ) : (
              <>
                {focused !== undefined && !focused.enabled && (
                  <p class="profile-off-note">{copy.rules.profileOffDetail}</p>
                )}
                <RuleList
                  profiles={focused === undefined ? [] : [focused]}
                  allProfiles={doc.profiles}
                  missingByRule={missingByRule}
                  invalidRuleIds={invalidRuleIds}
                  undoAvailable={pendingUndo !== undefined}
                  onToggle={(profileId, ruleId, enabled) =>
                    run(mutations.setRuleEnabled(profileId, ruleId, enabled))
                  }
                  onGrant={(_profileId, _ruleId, origins) =>
                    grantRuleAccess(origins)
                  }
                  onEdit={editRule}
                  onDelete={deleteRule}
                  onDuplicate={(profileId, ruleId) =>
                    run(mutations.duplicateRule(profileId, ruleId))
                  }
                  onMove={(profileId, ruleId, toProfileId) =>
                    run(
                      mutations.moveRuleToProfile(
                        profileId,
                        ruleId,
                        toProfileId,
                      ),
                    )
                  }
                  onRegenerate={(profileId, ruleId) =>
                    run(mutations.regenerateValue(profileId, ruleId))
                  }
                  onUpdateValue={updateRuleValue}
                  onUndoDelete={undoDelete}
                />
              </>
            )}
          </div>
          {(showFooterNewRule || hasEnabledProfileRules) && (
            <footer class="foot">
              {showFooterNewRule && (
                <span class="foot-new-rule" ref={newRuleTrigger}>
                  <Button kind="primary" onClick={openNewRule}>
                    {copy.actions.newRule}
                  </Button>
                </span>
              )}
              {hasEnabledProfileRules && (
                <>
                  <span class="foot-verify">
                    <button
                      type="button"
                      class="link-btn foot-test"
                      onClick={runVerify}
                    >
                      {copy.actions.testOnThisTab}
                    </button>
                  </span>
                  {verify !== undefined && (
                    <VerifyResult readout={verify} blocked={verifyBlocked} />
                  )}
                  <span class="pause">
                    {copy.actions.pause}
                    <Toggle
                      checked={status.kind === "paused"}
                      label={copy.actions.globalPause}
                      tone="paused"
                      onChange={(paused) => run(mutations.setPaused(paused))}
                    />
                  </span>
                </>
              )}
            </footer>
          )}
        </>
      )}
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
    </main>
  );
}

function useBlockedRowVisibility(
  scrollerRef: { readonly current: HTMLDivElement | null },
  ruleId: string | undefined,
): boolean {
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (ruleId === undefined || scroller === null) {
      setVisible(false);
      return;
    }
    const row = [
      ...scroller.querySelectorAll<HTMLElement>(".rule-row.blocked"),
    ].find((candidate) => candidate.getAttribute("data-rule-id") === ruleId);

    if (row === undefined) {
      setVisible(false);
      return;
    }

    const measure = () => {
      const scrollerRect = scroller.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const next =
        rowRect.top >= scrollerRect.top &&
        rowRect.bottom <= scrollerRect.bottom;
      setVisible((current) => (current === next ? current : next));
    };

    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      scroller.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  });

  return visible;
}

/**
 * First run is onboarding with one obvious act: the wordmark, a factual
 * sentence, one primary action, and two quieter routes.
 */
function FirstRun({
  onCreateRule,
  onTryThisTab,
}: {
  onCreateRule: () => void;
  onTryThisTab: () => void;
}) {
  return (
    <div class="first-run">
      <div class="first-run-brand">
        <span class="first-run-mark mono" aria-hidden="true">
          HS
        </span>
        <span class="first-run-wordmark">{copy.app.name}</span>
      </div>
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

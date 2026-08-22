import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { browser } from "wxt/browser";
import { missingGrants, originCovered } from "../../src/core/grants";
import { HEADER_ERROR_COPY_IDS } from "../../src/core/headers";
import {
  availableProfileName,
  type Direction,
  activeProfile as getActiveProfile,
  type TabOverride,
} from "../../src/core/model";
import { err, type Result } from "../../src/core/result";
import { CURRENT } from "../../src/core/schema";
import { originHost, originPatternForDomain } from "../../src/core/scope";
import { isRegexSupported } from "../../src/platform/dnr";
import { request as requestPermissions } from "../../src/platform/permissions";
import { activeTabOrigin, openAboutPage } from "../../src/platform/tabs";
import { LiveRegionProvider } from "../../src/ui/a11y/LiveRegion";
import { Button } from "../../src/ui/components/Button";
import { EmptyState } from "../../src/ui/components/EmptyState";
import { PauseBanner } from "../../src/ui/components/PauseBanner";
import { ChangeLine } from "../../src/ui/components/readout/ChangeLine";
import { GearGlyph, PlusGlyph } from "../../src/ui/components/readout/glyphs";
import { ReadoutHead } from "../../src/ui/components/readout/ReadoutHead";
import {
  ThisTabComposer,
  type ThisTabError,
} from "../../src/ui/components/readout/ThisTabComposer";
import { TokenHero } from "../../src/ui/components/readout/TokenHero";
import { sentence } from "../../src/ui/components/sentence";
import { ToastHost } from "../../src/ui/components/Toast";
import { Toggle } from "../../src/ui/components/Toggle";
import { copy } from "../../src/ui/copy";
import { loadDeferred } from "../../src/ui/deferred";
import { grantAction } from "../../src/ui/dispositionCopy";
import { blockedCommitCopy } from "../../src/ui/state/commit-copy";
import {
  createMutations,
  type MutationError,
} from "../../src/ui/state/mutations";
import { computeReadout, type TabChange } from "../../src/ui/state/readout";
import {
  addOverride,
  type OverrideDraft,
  pruneForeignOrigins,
  removeOverride,
  setOverrideEnabled,
  updateOverrideValue,
} from "../../src/ui/state/session-mutations";
import { type AppState, useAppState } from "../../src/ui/state/useAppState";
import { useToast } from "../../src/ui/state/useToast";
import { applyTheme } from "../../src/ui/theme";
import { popupKeyHandler } from "./keyboard";
import "../../src/ui/components/readout/readout.css";
import "./App.css";

const mutations = createMutations({ validateRegex: isRegexSupported });

export function App() {
  const app = useAppState();

  if (app.phase !== "ready") {
    const message =
      app.phase === "newer-store"
        ? copy.errors.newerStore(app.foundVersion, CURRENT)
        : app.phase === "unavailable"
          ? copy.errors.unavailable
          : undefined;
    // Local data lands within a frame; a skeleton would only flash.
    return (
      <main class="popup" aria-busy={message === undefined}>
        {message !== undefined && <EmptyState message={message} />}
      </main>
    );
  }
  return (
    <LiveRegionProvider>
      <Ready
        doc={app.doc}
        live={app.live}
        grants={app.grants}
        isRegexSupported={app.isRegexSupported}
        tabId={app.tabId}
        overrides={app.overrides}
      />
    </LiveRegionProvider>
  );
}

type ReadyProps = Omit<
  Extract<AppState, { phase: "ready" }>,
  "phase" | "session"
>;

function Ready({
  doc,
  live,
  grants,
  isRegexSupported,
  tabId,
  overrides,
}: ReadyProps) {
  const { toast, raise, show, dismiss } = useToast();
  const [addingTo, setAddingTo] = useState<string | undefined>(undefined);
  const [Editor, setEditor] =
    useState<typeof import("../../src/ui/components/RuleEditor").RuleEditor>();
  const [composing, setComposing] = useState(false);
  const [tabOrigin, setTabOrigin] = useState<string | undefined>(undefined);
  const [tabResolved, setTabResolved] = useState(false);
  const [switchShortcut, setSwitchShortcut] = useState<string | undefined>(
    undefined,
  );
  const [now, setNow] = useState(() => Date.now());

  const reloadTab = () => {
    // A fresh gesture, so activeTab covers the reload with no new permission.
    void browser.tabs.reload();
    dismiss();
  };

  const run = (
    // biome-ignore lint/suspicious/noConfusingVoidType: mutation completion has no value
    mutation: Promise<Result<unknown, MutationError> | void>,
    fallback?: string,
  ) => {
    void mutation.then(
      (outcome) => {
        if (outcome !== undefined && !outcome.ok) {
          reportBlockedCommit(outcome.error, fallback);
        }
      },
      () => show(copy.errors.saveFailed),
    );
  };

  useEffect(() => {
    void activeTabOrigin().then((origin) => {
      setTabOrigin(origin);
      setTabResolved(true);
    });
    // The bound accelerator makes the profile shortcut discoverable; read once so
    // the switcher can print it on the row it would flip to.
    void browser.commands.getAll().then((commands) => {
      setSwitchShortcut(
        commands.find((command) => command.name === "previous-profile")
          ?.shortcut || undefined,
      );
    });
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    applyTheme(doc.settings.theme);
  }, [doc.settings.theme]);

  // Fallback lifetime enforcement: prune this tab's overrides against where the
  // tab actually sits now, covering a navigation the background slept through.
  const [pruned, setPruned] = useState(false);
  useEffect(() => {
    if (pruned || !tabResolved || tabId === undefined) return;
    setPruned(true);
    run(pruneForeignOrigins(tabId, tabOrigin));
  }, [pruned, tabResolved, tabId, tabOrigin]);

  // An Undo outlives the render that armed it, so a write reads the rule as it
  // stands when it commits: only the value moves, and an edit made elsewhere in
  // between survives being undone.
  const docRef = useRef(doc);
  docRef.current = doc;

  const paused = doc.settings.paused;
  const activeProfile = useMemo(() => getActiveProfile(doc), [doc]);
  const tab = useMemo(
    () =>
      tabOrigin === undefined
        ? undefined
        : { origin: tabOrigin, host: originHost(tabOrigin) },
    [tabOrigin],
  );
  const globalNeedsAccess = activeProfile.rules.some(
    (rule) => rule.enabled && missingGrants(rule, grants).length > 0,
  );
  const readout = useMemo(
    () =>
      computeReadout({
        applied: live,
        doc,
        overrides,
        tab: { tabId, host: tab?.host, origin: tab?.origin },
      }),
    [doc, live, overrides, tab, tabId],
  );

  const reportBlockedCommit = (error: MutationError, fallback?: string) => {
    const message = blockedCommitCopy(error) ?? fallback;
    if (message !== undefined) show(message);
  };

  const switchProfile = (targetId: string) => {
    run(mutations.activateProfile(targetId));
  };

  const newProfile = async () => {
    const outcome = await mutations.createProfile(
      availableProfileName(copy.options.profiles.newName, doc.profiles),
    );
    if (!outcome.ok) {
      reportBlockedCommit(outcome.error);
      return undefined;
    }
    // The profile exists either way, so its id is the result even if the switch
    // does not land: the caller still needs it to open inline rename.
    const activated = await mutations.activateProfile(outcome.value.id);
    if (!activated.ok) reportBlockedCommit(activated.error);
    return outcome.value.id;
  };

  const renameProfile = (profileId: string, name: string) => {
    run(mutations.renameProfile(profileId, name), copy.errors.saveFailed);
  };

  const toggleChange = (change: TabChange, next: boolean) => {
    if (change.source === "override") {
      if (tabId !== undefined && change.overrideNum !== undefined) {
        run(setOverrideEnabled(tabId, change.overrideNum, next));
      }
      return;
    }
    if (change.profileId !== undefined && change.ruleId !== undefined) {
      run(mutations.setRuleEnabled(change.profileId, change.ruleId, next));
    }
  };

  const grantChange = (change: TabChange) => {
    // Must run synchronously in the click gesture; the permissions.onChanged
    // event refreshes every surface at once, and the page keeps its pre-grant
    // response, so the toast hands over a Reload-tab action rather than reloading.
    const action = grantAction(change.outcome);
    if (action === undefined) return;
    void requestPermissions([...action.origins]).then((granted) => {
      if (granted) {
        raise(copy.toast.accessGranted, {
          label: copy.actions.reloadTab,
          run: reloadTab,
        });
      }
    });
  };

  const writeChangeValue = async (
    change: TabChange,
    value: string,
  ): Promise<Result<unknown, MutationError> | undefined> => {
    if (change.source === "override") {
      if (tabId === undefined || change.overrideNum === undefined) {
        show(copy.errors.saveFailed);
        return;
      }
      const outcome = await updateOverrideValue(
        tabId,
        change.overrideNum,
        value,
      );
      if (!outcome.ok) {
        return outcome;
      }
      if (outcome.value === undefined) {
        show(copy.errors.saveFailed);
        return;
      }
      return outcome;
    }
    const rule = docRef.current.profiles
      .find((profile) => profile.id === change.profileId)
      ?.rules.find((candidate) => candidate.id === change.ruleId);
    if (rule === undefined || change.profileId === undefined) {
      show(copy.errors.saveFailed);
      return;
    }
    const { id: _id, num: _num, generated: _generated, ...unchanged } = rule;
    const outcome = await mutations.saveRule(change.profileId, rule.id, {
      ...unchanged,
      value,
    });
    return outcome;
  };

  // A value edit overwrites bytes that may be the only copy of a live
  // credential, and the field opens empty for a secret, so one stray Enter can
  // wipe it. Undo rides every commit rather than only the losses we predicted.
  const editChangeValue = async (
    change: TabChange,
    value: string,
  ): Promise<boolean> => {
    const previous = change.value ?? "";
    let outcome: Result<unknown, MutationError> | undefined;
    try {
      outcome = await writeChangeValue(change, value);
    } catch {
      show(copy.errors.saveFailed);
      return false;
    }
    if (outcome === undefined) return false;
    if (!outcome.ok) {
      reportBlockedCommit(outcome.error, copy.errors.saveFailed);
      return false;
    }
    raise(copy.toast.changesSaved, {
      label: copy.actions.undo,
      run: () => {
        run(writeChangeValue(change, previous), copy.errors.saveFailed);
        dismiss();
      },
    });
    return true;
  };

  const removeChange = (change: TabChange) => {
    if (tabId !== undefined && change.overrideNum !== undefined) {
      run(removeOverride(tabId, change.overrideNum));
    }
  };

  const submitThisTab = async (
    draft: OverrideDraft,
  ): Promise<Result<TabOverride, ThisTabError>> => {
    if (tabId === undefined || tab === undefined) {
      return err({
        kind: "name-required" as const,
        copyId: HEADER_ERROR_COPY_IDS["name-required"],
      });
    }
    // A permission request is needed only when the current origin is not
    // already covered; without access, its override would apply to nothing.
    const granted =
      originCovered(tab.origin, grants) ||
      (await requestPermissions([originPatternForDomain(tab.host)]));
    if (!granted) {
      return err({
        kind: "grant-declined" as const,
        host: tab.host,
      });
    }
    return addOverride(tabId, tab.origin, draft);
  };

  // Starting a fresh attempt retires the verdict on the last one, so a spent
  // confirmation cannot sit under the new form's own errors. A toast still
  // offering an action is a live offer, not a verdict, so it stands.
  const retireVerdict = () => {
    if (toast?.action === undefined) dismiss();
  };
  const openAddChange = () => {
    retireVerdict();
    setComposing(false);
    setAddingTo(activeProfile.id);
  };
  const openComposer = () => {
    if (tabOrigin === undefined) return;
    retireVerdict();
    setAddingTo(undefined);
    setComposing(true);
  };

  const editing = addingTo !== undefined;
  // A stable listener delegates to the current handler so popup-wide keys always
  // see fresh state (the resolved tab host, the live pause flag); the editor
  // layer owns its own keys, so popup commands go inert while it is open.
  const handlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  handlerRef.current = editing
    ? () => undefined
    : popupKeyHandler({
        addChange: openAddChange,
        justThisTab: openComposer,
        togglePause: () => run(mutations.setPaused(!paused)),
        closePopup: () => window.close(),
      });
  // Bound in the commit that paints this view, not after it. A passive effect
  // leaves a frame in which the popup is on screen with its commands dead, and
  // a key struck in that frame is dropped with nothing to tell the user why.
  useLayoutEffect(() => {
    const listener = (event: KeyboardEvent) => handlerRef.current(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const addingProfile =
    addingTo === undefined
      ? undefined
      : doc.profiles.find((profile) => profile.id === addingTo);
  useEffect(() => {
    if (addingTo !== undefined && addingProfile === undefined) {
      setAddingTo(undefined);
    }
  }, [addingTo, addingProfile]);
  useEffect(() => {
    if (addingProfile !== undefined && Editor === undefined) {
      void loadDeferred(
        () => import("../../src/ui/components/RuleEditor"),
      ).then(
        (module) => setEditor(() => module.RuleEditor),
        () => window.location.reload(),
      );
    }
  }, [addingProfile, Editor]);

  // The editor is a full-surface swap that unmounts whatever held focus, so the
  // dialog's own restore would land on <body> once it closes. Return focus to
  // the readout landmark instead, so it is never stranded (WCAG 2.4.3).
  const readoutRef = useRef<HTMLElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) {
      wasEditing.current = true;
    } else if (wasEditing.current) {
      wasEditing.current = false;
      readoutRef.current?.focus();
    }
  }, [editing]);

  if (addingProfile !== undefined) {
    return (
      <main class="popup" tabIndex={-1}>
        {paused && <PauseBanner />}
        {Editor === undefined ? (
          <div aria-busy="true" />
        ) : (
          <Editor
            key="new-rule"
            profileName={addingProfile.name}
            grants={grants}
            tabDomain={tab?.host}
            prefillDomain={tab?.host}
            onSave={(ruleId, draft) =>
              mutations.saveRule(addingProfile.id, ruleId, draft)
            }
            onRequestGrant={requestPermissions}
            // The permission prompt closes the popup, so a grant's outcome has
            // no surface here: it is disclosed on the button before the
            // request, and the rule's own row carries any needs-access state
            // afterward. This fires only when no grant was needed, and reads
            // that saved row.
            onCommitted={() => show(copy.toast.ruleCreated)}
            onClose={() => setAddingTo(undefined)}
          />
        )}
        <ToastHost toast={toast} onDismiss={dismiss} />
      </main>
    );
  }

  // Bound once so the callbacks act on the token this render drew, not on
  // whatever the readout holds by the time the click lands.
  const token = readout.token;
  const hasRows =
    token !== undefined ||
    readout.request.length > 0 ||
    readout.response.length > 0 ||
    readout.overrides.length > 0;
  const nothing = !composing && !hasRows;

  return (
    // tabIndex -1 lets a removed section land focus on the landmark, not <body>.
    <main
      class="popup"
      tabIndex={-1}
      ref={readoutRef}
      aria-busy={live.confirmation === "pending" ? "true" : undefined}
    >
      {paused && <PauseBanner />}
      <ReadoutHead
        readout={readout}
        hasRows={hasRows}
        globalNeedsAccess={globalNeedsAccess}
        profiles={doc.profiles}
        activeProfile={activeProfile}
        previousProfileId={doc.previousProfileId}
        switchShortcut={switchShortcut}
        projection={live}
        tab={{ tabId, host: tab?.host, origin: tab?.origin }}
        grants={grants}
        overrides={overrides}
        isRegexSupported={isRegexSupported}
        paused={paused}
        onSwitchProfile={switchProfile}
        onNewProfile={newProfile}
        onRenameProfile={renameProfile}
      />
      {live.confirmation === "pending" && (
        <p class="pending-receipt" role="status">
          {copy.readout.outOfSync}
        </p>
      )}
      {/* Pause is drawn where it is true: the count says how many are held and
          each held line says what it would do, so the state is in the words and
          not only in the hue. Desaturating the region on top of that would grey
          live controls with the platform's word for disabled. */}
      <footer class="foot">
        {!nothing && (
          <button type="button" class="add" onClick={openAddChange}>
            <PlusGlyph />
            {copy.readout.addChange}
          </button>
        )}
        {tab !== undefined && (
          <button type="button" class="tab-btn" onClick={openComposer}>
            {copy.readout.justThisTab}
          </button>
        )}
        <span class="foot-sp" />
        <Button
          kind="ghost"
          label={copy.actions.options}
          onClick={() => void openAboutPage()}
        >
          <GearGlyph />
        </Button>
        <Toggle
          checked={!paused}
          label={copy.readout.pauseSwitch}
          onChange={(next) => run(mutations.setPaused(!next))}
        />
      </footer>
      <div class="popup-body">
        {composing && tab !== undefined && (
          <ThisTabComposer
            host={tab.host}
            needsGrant={!originCovered(tab.origin, grants)}
            onSubmit={submitThisTab}
            onClose={() => setComposing(false)}
            onCommitted={() => show(copy.toast.changesSaved)}
          />
        )}
        {token !== undefined && (
          <TokenHero
            change={token}
            now={now}
            onSwap={(value) => editChangeValue(token, value)}
            onGrant={() => grantChange(token)}
          />
        )}
        {readout.overrides.length > 0 && (
          <ThisTabStrip
            overrides={readout.overrides}
            onToggle={toggleChange}
            onGrant={grantChange}
            onRemove={removeChange}
            onEditValue={editChangeValue}
          />
        )}
        <DirectionGroup
          direction="request"
          changes={readout.request}
          onToggle={toggleChange}
          onGrant={grantChange}
          onEditValue={editChangeValue}
        />
        <DirectionGroup
          direction="response"
          changes={readout.response}
          onToggle={toggleChange}
          onGrant={grantChange}
          onEditValue={editChangeValue}
        />
        {nothing && (
          <ReadoutEmpty
            host={readout.host}
            paused={paused}
            onAdd={openAddChange}
          />
        )}
      </div>
      <ToastHost toast={toast} onDismiss={dismiss} />
    </main>
  );
}

function DirectionGroup({
  direction,
  changes,
  onToggle,
  onGrant,
  onEditValue,
}: {
  direction: Direction;
  changes: readonly TabChange[];
  onToggle: (change: TabChange, next: boolean) => void;
  onGrant: (change: TabChange) => void;
  onEditValue: (change: TabChange, value: string) => Promise<boolean>;
}) {
  if (changes.length === 0) return null;
  return (
    <section class="group" aria-label={copy.readout.direction[direction]}>
      {/* No count: the head already states the one total, and a second count
          drawn over a different set of lines only ever disagrees with it. */}
      <div class="dir">
        <span class="ar mono" aria-hidden="true">
          {direction === "request" ? "→" : "←"}
        </span>
        <span class="t silk">{copy.readout.direction[direction]}</span>
        <span class="rule" aria-hidden="true" />
      </div>
      {changes.map((change) => (
        <ChangeLine
          key={change.key}
          change={change}
          onToggle={(next) => onToggle(change, next)}
          onGrant={() => onGrant(change)}
          onEditValue={(value) => onEditValue(change, value)}
        />
      ))}
    </section>
  );
}

function ThisTabStrip({
  overrides,
  onToggle,
  onGrant,
  onRemove,
  onEditValue,
}: {
  overrides: readonly TabChange[];
  onToggle: (change: TabChange, next: boolean) => void;
  onGrant: (change: TabChange) => void;
  onRemove: (change: TabChange) => void;
  onEditValue: (change: TabChange, value: string) => Promise<boolean>;
}) {
  return (
    <section class="thistab" aria-label={copy.readout.thisTabTag}>
      <div class="thistab-head">
        <span class="tag mono">{copy.readout.thisTabTag}</span>
        <span class="clears">{copy.readout.thisTabClears}</span>
      </div>
      {overrides.map((change) => (
        <ChangeLine
          key={change.key}
          change={change}
          onRemove={() => onRemove(change)}
          onEditValue={(value) => onEditValue(change, value)}
          onGrant={() => onGrant(change)}
          onToggle={(next) => onToggle(change, next)}
        />
      ))}
    </section>
  );
}

// One honest sentence and one action: add a change where there is a site to
// change, and otherwise the list of rules, which is the only thing left to look
// at from a tab with no site to read. While paused the banner above states the
// cause, so the site-shaped line drops rather than restate it under it.
function ReadoutEmpty({
  host,
  paused,
  onAdd,
}: {
  host: string | undefined;
  paused: boolean;
  onAdd: () => void;
}) {
  if (host === undefined) {
    return (
      <div class="empty">
        <p class="l1">{copy.readout.noHost}</p>
        <button
          type="button"
          class="add"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          <GearGlyph />
          {copy.readout.seeAllRules}
        </button>
      </div>
    );
  }
  return (
    <div class="empty">
      {!paused && <p class="l1">{sentence(copy.readout.empty(host))}</p>}
      <button type="button" class="add" onClick={onAdd}>
        <PlusGlyph />
        {copy.readout.addChange}
      </button>
    </div>
  );
}

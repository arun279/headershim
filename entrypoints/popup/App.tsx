import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import { availableProfileName } from "../../src/core/codec/headershim";
import { HEADER_ERROR_COPY_IDS } from "../../src/core/headers";
import {
  BADGE_COLORS,
  type Direction,
  type TabOverride,
} from "../../src/core/model";
import { err, type Result } from "../../src/core/result";
import { CURRENT } from "../../src/core/schema";
import { originPatternForDomain } from "../../src/core/scope";
import { isRegexSupported } from "../../src/platform/dnr";
import { request as requestPermissions } from "../../src/platform/permissions";
import { activeTabDomain } from "../../src/platform/tabs";
import { LiveRegionProvider, useAnnounce } from "../../src/ui/a11y/LiveRegion";
import { Button } from "../../src/ui/components/Button";
import { EmptyState } from "../../src/ui/components/EmptyState";
import { RuleEditor } from "../../src/ui/components/RuleEditor";
import { ChangeLine } from "../../src/ui/components/readout/ChangeLine";
import {
  GearGlyph,
  PlusGlyph,
  TabGlyph,
} from "../../src/ui/components/readout/glyphs";
import { ReadoutHead } from "../../src/ui/components/readout/ReadoutHead";
import {
  ThisTabComposer,
  type ThisTabError,
} from "../../src/ui/components/readout/ThisTabComposer";
import { TokenHero } from "../../src/ui/components/readout/TokenHero";
import { sentence } from "../../src/ui/components/sentence";
import { Toast } from "../../src/ui/components/Toast";
import { Toggle } from "../../src/ui/components/Toggle";
import { copy } from "../../src/ui/copy";
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
import { applyTheme } from "../../src/ui/theme";
import { popupKeyHandler } from "./keyboard";
import "../../src/ui/components/readout/readout.css";
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
        isRegexSupported={app.isRegexSupported}
        tabId={app.tabId}
        overrides={app.overrides}
      />
    </LiveRegionProvider>
  );
}

type ReadyProps = Omit<
  Extract<AppState, { phase: "ready" }>,
  "phase" | "grantGaps"
>;

/** A toast, and the one thing it can offer to do about what it just said. */
interface PopupToast {
  message: string;
  action?: { label: string; run: () => void };
}

function Ready({
  doc,
  status,
  grants,
  isRegexSupported,
  tabId,
  overrides,
}: ReadyProps) {
  const announce = useAnnounce();
  const [toast, setToast] = useState<PopupToast | undefined>(undefined);
  const [addingTo, setAddingTo] = useState<string | undefined>(undefined);
  const [composing, setComposing] = useState(false);
  const [tabDomain, setTabDomain] = useState<string | undefined>(undefined);
  const [tabResolved, setTabResolved] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Every toast also speaks through the persistent polite region: a freshly
  // mounted role=status node with text already present is not reliably read.
  const raise = (next: PopupToast) => {
    setToast(next);
    announce(next.message);
  };
  const showToast = (message: string) => raise({ message });
  const reloadTab = () => {
    // A fresh gesture, so activeTab covers the reload with no new permission.
    void browser.tabs.reload();
    setToast(undefined);
  };

  useEffect(() => {
    void activeTabDomain().then((host) => {
      setTabDomain(host);
      setTabResolved(true);
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
    void pruneForeignOrigins(tabId, tabDomain);
  }, [pruned, tabResolved, tabId, tabDomain]);

  // An Undo outlives the render that armed it, so a write reads the rule as it
  // stands when it commits: only the value moves, and an edit made elsewhere in
  // between survives being undone.
  const docRef = useRef(doc);
  docRef.current = doc;

  const paused = status.kind === "paused";
  const activeProfile = useMemo(
    () => doc.profiles.find((profile) => profile.id === doc.activeProfileId),
    [doc],
  );
  const readout = useMemo(
    () =>
      computeReadout({
        doc,
        host: tabDomain,
        grants,
        overrides,
        isRegexSupported,
        status,
      }),
    [doc, tabDomain, grants, overrides, isRegexSupported, status],
  );

  const run = <T,>(mutation: Promise<Result<T, MutationError>>) => {
    void mutation.then((outcome) => {
      if (!outcome.ok) {
        const message = blockedCommitCopy(outcome.error);
        if (message !== undefined) showToast(message);
      }
    });
  };

  const switchProfile = (targetId: string) => {
    run(mutations.activateProfile(targetId));
  };

  const newProfile = () => {
    run(
      mutations.createProfile({
        name: availableProfileName(
          copy.options.profiles.newName,
          doc.profiles,
          [],
        ),
        color:
          BADGE_COLORS[doc.profiles.length % BADGE_COLORS.length] ??
          BADGE_COLORS[0],
        enabled: true,
      }),
    );
  };

  const toggleChange = (change: TabChange, next: boolean) => {
    if (change.source === "override") {
      if (tabId !== undefined && change.overrideNum !== undefined) {
        void setOverrideEnabled(tabId, change.overrideNum, next);
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
    void requestPermissions([...(change.missing ?? [])]).then((granted) => {
      if (granted) {
        raise({
          message: copy.toast.accessGranted,
          action: { label: copy.actions.reloadTab, run: reloadTab },
        });
      }
    });
  };

  const writeChangeValue = async (
    change: TabChange,
    value: string,
  ): Promise<boolean> => {
    if (change.source === "override") {
      if (tabId === undefined || change.overrideNum === undefined) return false;
      const outcome = await updateOverrideValue(
        tabId,
        change.overrideNum,
        value,
      );
      return outcome.ok;
    }
    const rule = docRef.current.profiles
      .find((profile) => profile.id === change.profileId)
      ?.rules.find((candidate) => candidate.id === change.ruleId);
    if (rule === undefined || change.profileId === undefined) return false;
    const { id: _id, num: _num, generated: _generated, ...unchanged } = rule;
    const outcome = await mutations.saveRule(change.profileId, rule.id, {
      ...unchanged,
      value,
    });
    if (!outcome.ok) {
      const message = blockedCommitCopy(outcome.error);
      if (message !== undefined) showToast(message);
      return false;
    }
    return true;
  };

  // A value edit overwrites bytes that may be the only copy of a live
  // credential, and the field opens empty for a secret, so one stray Enter can
  // wipe it. Undo rides every commit rather than only the losses we predicted.
  const editChangeValue = async (
    change: TabChange,
    value: string,
  ): Promise<boolean> => {
    const previous = change.value ?? "";
    if (!(await writeChangeValue(change, value))) return false;
    raise({
      message: copy.toast.changesSaved,
      action: {
        label: copy.actions.undo,
        run: () => {
          void writeChangeValue(change, previous);
          setToast(undefined);
        },
      },
    });
    return true;
  };

  const removeChange = (change: TabChange) => {
    if (tabId !== undefined && change.overrideNum !== undefined) {
      void removeOverride(tabId, change.overrideNum);
    }
  };

  const submitThisTab = async (
    draft: OverrideDraft,
  ): Promise<Result<TabOverride, ThisTabError>> => {
    if (tabId === undefined || tabDomain === undefined) {
      return err({
        kind: "name-required" as const,
        copyId: HEADER_ERROR_COPY_IDS["name-required"],
      });
    }
    // The request fires inside the commit gesture, and its answer decides the
    // write: an override on a host Chrome will not let us touch applies to
    // nothing, and this-tab lines have no needs-access reading to fall back on.
    const granted = await requestPermissions([
      originPatternForDomain(tabDomain),
    ]);
    if (!granted) {
      return err({ kind: "grant-declined" as const, host: tabDomain });
    }
    return addOverride(tabId, tabDomain, draft);
  };

  const openAddChange = () => {
    setComposing(false);
    setAddingTo((activeProfile ?? doc.profiles[0])?.id);
  };
  const openComposer = () => {
    if (tabDomain === undefined) return;
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
  useEffect(() => {
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

  // Drawn once so no surface can render a toast that has quietly dropped the one
  // action it was raised to offer.
  const toastNode = toast !== undefined && (
    <Toast
      onDismiss={() => setToast(undefined)}
      persist={toast.action !== undefined}
      actionLabel={toast.action?.label}
      onAction={toast.action?.run}
    >
      {toast.message}
    </Toast>
  );

  if (addingProfile !== undefined) {
    return (
      <main class="popup" tabIndex={-1}>
        <RuleEditor
          key="new-rule"
          profileName={addingProfile.name}
          grants={grants}
          tabDomain={tabDomain}
          prefillDomain={tabDomain}
          onSave={(ruleId, draft) =>
            mutations.saveRule(addingProfile.id, ruleId, draft)
          }
          onRequestGrant={requestPermissions}
          onGrantDeclined={(host) => showToast(copy.errors.grantDeclined(host))}
          onCommitted={() => showToast(copy.toast.ruleCreated)}
          onGranted={() => showToast(copy.toast.ruleLive)}
          onClose={() => setAddingTo(undefined)}
        />
        {toastNode}
      </main>
    );
  }

  // Bound once so the callbacks act on the token this render drew, not on
  // whatever the readout holds by the time the click lands.
  const token = readout.token;
  const nothing =
    !composing &&
    token === undefined &&
    readout.request.length === 0 &&
    readout.response.length === 0 &&
    readout.overrides.length === 0;

  return (
    // tabIndex -1 lets a removed section land focus on the landmark, not <body>.
    <main class="popup" tabIndex={-1}>
      <ReadoutHead
        readout={readout}
        profiles={doc.profiles}
        activeProfile={activeProfile}
        paused={paused}
        onSwitchProfile={switchProfile}
        onNewProfile={newProfile}
      />
      {paused && (
        <div class="pausebar" role="status">
          <PauseGlyph />
          {copy.readout.pausedBanner}
        </div>
      )}
      {/* Pause is drawn where it is true: every line reads paused in the
          readout's own grammar, and desaturating the region on top of that
          would grey live controls with the platform's word for disabled. */}
      <div class="popup-body">
        {composing && (
          <ThisTabComposer
            onSubmit={submitThisTab}
            onClose={() => setComposing(false)}
            onCommitted={() => showToast(copy.toast.changesSaved)}
          />
        )}
        {token !== undefined && (
          <TokenHero
            change={token}
            host={tabDomain}
            now={now}
            onSwap={(value) => editChangeValue(token, value)}
            onGrant={() => grantChange(token)}
          />
        )}
        {readout.overrides.length > 0 && (
          <ThisTabStrip
            overrides={readout.overrides}
            onToggle={toggleChange}
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
        {nothing && <ReadoutEmpty host={readout.host} onAdd={openAddChange} />}
      </div>
      <footer class="foot">
        {/* The empty state carries the one Add; the footer's copy of it would
            be the same button twice, 80px apart, offering the same thing. */}
        {!nothing && (
          <button type="button" class="add" onClick={openAddChange}>
            <PlusGlyph />
            {copy.readout.addChange}
          </button>
        )}
        {tabDomain !== undefined && (
          <button type="button" class="tab-btn" onClick={openComposer}>
            <TabGlyph />
            {copy.readout.justThisTab}
          </button>
        )}
        <span class="foot-sp" />
        <Button
          kind="ghost"
          label={copy.actions.options}
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          <GearGlyph />
        </Button>
        <span class="pause">
          <Toggle
            checked={!paused}
            label={copy.readout.pauseSwitch}
            onChange={(next) => run(mutations.setPaused(!next))}
          />
          {paused ? copy.readout.pausedLabel : copy.readout.onLabel}
        </span>
      </footer>
      {toastNode}
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
  onRemove,
  onEditValue,
}: {
  overrides: readonly TabChange[];
  onToggle: (change: TabChange, next: boolean) => void;
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
          onToggle={(next) => onToggle(change, next)}
          onGrant={() => undefined}
          onEditValue={(value) => onEditValue(change, value)}
          onRemove={() => onRemove(change)}
        />
      ))}
    </section>
  );
}

// One honest sentence and, where there is a site to change, one action.
function ReadoutEmpty({
  host,
  onAdd,
}: {
  host: string | undefined;
  onAdd: () => void;
}) {
  return (
    <div class="empty">
      <p class="l1">
        {host === undefined
          ? copy.readout.noHost
          : sentence(copy.readout.empty(host))}
      </p>
      {host !== undefined && (
        <button type="button" class="add" onClick={onAdd}>
          <PlusGlyph />
          {copy.readout.addChange}
        </button>
      )}
    </div>
  );
}

function PauseGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="4" y="3" width="3" height="10" rx="1" />
      <rect x="9" y="3" width="3" height="10" rx="1" />
    </svg>
  );
}

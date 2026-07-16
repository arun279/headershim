import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import { availableProfileName } from "../../src/core/codec/headershim";
import { HEADER_ERROR_COPY_IDS } from "../../src/core/headers";
import { BADGE_COLORS, type Direction, type Rule } from "../../src/core/model";
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
import { ThisTabComposer } from "../../src/ui/components/readout/ThisTabComposer";
import { TokenHero } from "../../src/ui/components/readout/TokenHero";
import { sentence } from "../../src/ui/components/sentence";
import { ThemeControl } from "../../src/ui/components/ThemeControl";
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

function Ready({ doc, status, grants, tabId, overrides }: ReadyProps) {
  const announce = useAnnounce();
  const [toast, setToast] = useState<
    { message: string; reload?: boolean } | undefined
  >(undefined);
  const [addingTo, setAddingTo] = useState<string | undefined>(undefined);
  const [composing, setComposing] = useState(false);
  const [tabDomain, setTabDomain] = useState<string | undefined>(undefined);
  const [tabResolved, setTabResolved] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Every toast also speaks through the persistent polite region: a freshly
  // mounted role=status node with text already present is not reliably read.
  const showToast = (message: string) => {
    setToast({ message });
    announce(message);
  };
  const showReloadToast = (message: string) => {
    setToast({ message, reload: true });
    announce(message);
  };
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

  const paused = status.kind === "paused";
  const enabledProfiles = useMemo(
    () => doc.profiles.filter((profile) => profile.enabled),
    [doc],
  );
  const readout = useMemo(
    () =>
      computeReadout({
        enabledProfiles,
        host: tabDomain,
        grants,
        overrides,
        paused,
      }),
    [enabledProfiles, tabDomain, grants, overrides, paused],
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
    void (async () => {
      // Enable and focus the target first so a profile is never briefly all-off,
      // then drop the rest: an exclusive switch composed from the fixed store.
      await mutations.setProfileEnabled(targetId, true, true);
      for (const profile of enabledProfiles) {
        if (profile.id !== targetId) {
          await mutations.setProfileEnabled(profile.id, false, false);
        }
      }
    })();
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
        exclusive: true,
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
      if (granted) showReloadToast(copy.toast.accessGranted);
    });
  };

  const editChangeValue = async (
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
    const rule = doc.profiles
      .find((profile) => profile.id === change.profileId)
      ?.rules.find((candidate) => candidate.id === change.ruleId);
    if (rule === undefined || change.profileId === undefined) return false;
    return updateRuleValue(change.profileId, rule, value);
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
    showToast(copy.toast.changesSaved);
    return true;
  };

  const removeChange = (change: TabChange) => {
    if (tabId !== undefined && change.overrideNum !== undefined) {
      void removeOverride(tabId, change.overrideNum);
    }
  };

  const swapToken = async (
    change: TabChange,
    value: string,
  ): Promise<boolean> => {
    if (change.source === "override" && change.overrideNum !== undefined) {
      if (tabId === undefined) return false;
      const outcome = await updateOverrideValue(
        tabId,
        change.overrideNum,
        value,
      );
      return outcome.ok;
    }
    if (tabId === undefined || tabDomain === undefined) return false;
    // The host grant fires inside this same gesture; the swap writes a this-tab
    // override so the new value never becomes a permanent line on the card.
    void requestPermissions([originPatternForDomain(tabDomain)]);
    const outcome = await addOverride(tabId, tabDomain, {
      direction: "request",
      operation: "set",
      header: change.header,
      value,
    });
    return outcome.ok;
  };

  const submitThisTab = (draft: Parameters<typeof addOverride>[2]) => {
    if (tabId === undefined || tabDomain === undefined) {
      return Promise.resolve(
        err({
          kind: "name-required" as const,
          copyId: HEADER_ERROR_COPY_IDS["name-required"],
        }),
      );
    }
    void requestPermissions([originPatternForDomain(tabDomain)]);
    return addOverride(tabId, tabDomain, draft);
  };

  const openAddChange = () => {
    setComposing(false);
    setAddingTo(doc.focusedProfileId);
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
        {toast !== undefined && (
          <Toast onDismiss={() => setToast(undefined)}>{toast.message}</Toast>
        )}
      </main>
    );
  }

  const nothing =
    !composing &&
    readout.token === undefined &&
    readout.request.length === 0 &&
    readout.response.length === 0 &&
    readout.overrides.length === 0;

  return (
    // tabIndex -1 lets a removed section land focus on the landmark, not <body>.
    <main class="popup" tabIndex={-1}>
      <ReadoutHead
        readout={readout}
        profiles={doc.profiles}
        enabledProfiles={enabledProfiles}
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
      <div class={paused ? "popup-body paused" : "popup-body"}>
        {composing && (
          <ThisTabComposer
            host={tabDomain}
            onSubmit={submitThisTab}
            onClose={() => setComposing(false)}
            onCommitted={() => showToast(copy.toast.changesSaved)}
          />
        )}
        {readout.token !== undefined && (
          <TokenHero
            change={readout.token}
            host={tabDomain}
            now={now}
            onSwap={(value) => swapToken(readout.token as TabChange, value)}
            onGrant={() => grantChange(readout.token as TabChange)}
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
        <button type="button" class="add" onClick={openAddChange}>
          <PlusGlyph />
          {copy.readout.addChange}
        </button>
        {tabDomain !== undefined && (
          <button type="button" class="tab-btn" onClick={openComposer}>
            <TabGlyph />
            {copy.readout.justThisTab}
          </button>
        )}
        <span class="foot-sp" />
        <ThemeControl
          theme={doc.settings.theme}
          onChange={(next) => run(mutations.setTheme(next))}
        />
        <Button
          kind="ghost"
          label={copy.actions.options}
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          <GearGlyph />
        </Button>
        <span class="pause">
          <Toggle
            checked={paused}
            label={copy.readout.pauseSwitch}
            tone="paused"
            onChange={(next) => run(mutations.setPaused(next))}
          />
          {paused ? copy.readout.pausedLabel : copy.readout.onLabel}
        </span>
      </footer>
      {toast !== undefined && (
        <Toast
          onDismiss={() => setToast(undefined)}
          actionLabel={
            toast.reload === true ? copy.actions.reloadTab : undefined
          }
          onAction={toast.reload === true ? reloadTab : undefined}
        >
          {toast.message}
        </Toast>
      )}
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
      <div class="dir">
        <span class="ar mono" aria-hidden="true">
          {direction === "request" ? "→" : "←"}
        </span>
        <span class="t silk">{copy.readout.direction[direction]}</span>
        <span class="rule" aria-hidden="true" />
        <span class="c mono">{changes.length}</span>
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
      <button type="button" class="add" onClick={onAdd}>
        <PlusGlyph />
        {copy.readout.addChange}
      </button>
      {host !== undefined && <p class="perm">{copy.readout.emptyPermNote}</p>}
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

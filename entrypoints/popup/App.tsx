import { useEffect, useRef, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import type { Result } from "../../src/core/result";
import { CURRENT } from "../../src/core/schema";
import { isRegexSupported } from "../../src/platform/dnr";
import { request as requestPermissions } from "../../src/platform/permissions";
import { LiveRegionProvider } from "../../src/ui/a11y/LiveRegion";
import { Annunciator } from "../../src/ui/components/Annunciator";
import { Button } from "../../src/ui/components/Button";
import { EmptyState } from "../../src/ui/components/EmptyState";
import { ProfileSwitcher } from "../../src/ui/components/ProfileSwitcher";
import { Toast } from "../../src/ui/components/Toast";
import { Toggle } from "../../src/ui/components/Toggle";
import { copy } from "../../src/ui/copy";
import {
  createMutations,
  type MutationError,
} from "../../src/ui/state/mutations";
import { type AppState, useAppState } from "../../src/ui/state/useAppState";
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

function Ready({ doc, status, grantGaps, overrideCount }: ReadyProps) {
  const [error, setError] = useState<string | undefined>(undefined);
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

  const run = <T,>(mutation: Promise<Result<T, MutationError>>) => {
    void mutation.then((outcome) => {
      if (!outcome.ok) {
        setError(blockedCommitCopy(outcome.error));
      }
    });
  };

  const grantAccess = () => {
    // Must run synchronously in the click gesture; the resulting
    // permissions.onChanged event refreshes every surface at once.
    void requestPermissions([
      ...new Set(grantGaps.flatMap((gap) => gap.missing)),
    ]);
  };

  return (
    <main class="popup">
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
        {firstRun ? (
          <FirstRun />
        ) : someProfileEnabled &&
          enabledProfilesEmpty &&
          focused !== undefined ? (
          <EmptyState
            message={copy.emptyState.profile(focused.name)}
            actions={<Button kind="primary">{copy.actions.newRule}</Button>}
          />
        ) : (
          <div class="rules" />
        )}
      </div>
      <footer class="foot">
        <Button kind="primary">{copy.actions.newRule}</Button>
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
      {error !== undefined && (
        <Toast onDismiss={() => setError(undefined)}>{error}</Toast>
      )}
    </main>
  );
}

/** First run is onboarding: the trust sentence and three equal ways in. */
function FirstRun() {
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => {
    first.current?.querySelector("button")?.focus();
  }, []);

  return (
    <div class="first-run" ref={first}>
      <p class="first-run-tagline">{copy.app.tagline}</p>
      <div class="first-run-actions">
        <Button kind="quiet">{copy.firstRun.tryThisTab}</Button>
        <Button kind="quiet">{copy.firstRun.createRule}</Button>
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

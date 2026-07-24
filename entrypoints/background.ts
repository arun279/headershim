import { planBadge } from "../src/core/badge";
import {
  compileDynamic,
  compileSession,
  dropInapplicable,
} from "../src/core/compile";
import { originGranted } from "../src/core/grants";
import {
  activateNextProfile,
  type StateDoc,
  type TabOverride,
} from "../src/core/model";
import { planReconcile } from "../src/core/reconcile";
import { createV1Seed, migrate } from "../src/core/schema";
import { applyBadge } from "../src/platform/badge";
import {
  getDynamicRules,
  getSessionRules,
  resolveRegexSupport,
  updateDynamicRules,
  updateSessionRules,
} from "../src/platform/dnr";
import {
  snapshot as grantSnapshot,
  onChanged as onGrantsChanged,
} from "../src/platform/permissions";
import {
  getReconcileError,
  read as readSession,
  setReconcileError,
  subscribe as subscribeSession,
  write as writeSession,
} from "../src/platform/session-store";
import {
  locked,
  quarantine,
  readRaw,
  subscribe as subscribeState,
  write as writeState,
} from "../src/platform/store";
import { domainFromUrl } from "../src/platform/tabs";

export default defineBackground(() => {
  // Wake-local coordination for the single-flight scheduler, not durable
  // state: a service-worker death mid-write self-heals on the next trigger.
  let running: Promise<void> | undefined;
  let dirty = false;

  // Every listener registers synchronously at wake time; one registered after
  // an await would be silently dropped on event-driven service-worker wakes.
  browser.runtime.onInstalled.addListener(() => reconcile());
  browser.runtime.onStartup.addListener(() => reconcile());
  subscribeState(() => void reconcile());
  subscribeSession(() => void reconcile());
  // Grants are a compile input, so a grant change is a reconcile: it installs
  // the rules a grant was waiting on and pulls the dynamic ones a revoke took
  // back. Reconcile runs first and unconditionally so those leave the batch at
  // once; pruning the This-tab rows a revoked host still holds runs alongside,
  // and its own session write reconciles them. Both swallow their rejections, as
  // the fire-and-forget cleanup listeners do, so no rejected write escapes.
  onGrantsChanged(() => {
    void reconcile();
    void endUngrantedOverrides().catch(noop);
  });
  browser.tabs.onRemoved.addListener((tabId) =>
    pruneOverrides((_row, id) => id !== tabId).catch(noop),
  );
  browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) =>
    enforceOverrideLifetime(tabId, tab.url).catch(noop),
  );
  browser.commands.onCommand.addListener((command) =>
    handleCommand(command)?.catch(noop),
  );

  function reconcile(): Promise<void> {
    if (running !== undefined) {
      dirty = true;
      return running;
    }
    running = runUntilSettled().finally(() => {
      running = undefined;
      if (dirty) {
        void reconcile();
      }
    });
    return running;
  }

  async function runUntilSettled(): Promise<void> {
    try {
      do {
        dirty = false;
        const applied = (await applyOnce()) || (await applyOnce());
        await flagReconcileError(!applied);
        await refreshBadge();
      } while (dirty);
    } catch {
      // A throw outside the update*Rules window (a rejected read, a compile
      // RangeError, a storage write) must still fail closed and visible rather
      // than escape unhandled and leave state silently unreconciled.
      await flagReconcileError(true).catch(noop);
      await refreshBadge().catch(noop);
    }
  }

  async function applyOnce(): Promise<boolean> {
    const doc = await loadDoc();
    if (doc === undefined) {
      return true;
    }
    // Resolve every enabled regex against the browser's RE2 (async) and read
    // the live grants, so the pure core drop can strip the rules that must not
    // reach the batch before compilation sees them.
    const [session, granted, isRegexSupported] = await Promise.all([
      readSession(),
      grantSnapshot(),
      resolveRegexSupport(doc),
    ]);
    const desiredDynamic = compileDynamic(
      dropInapplicable(doc, isRegexSupported, granted),
    );
    const desiredSession = compileSession(
      Object.values(session.tabs).flat(),
      doc.settings.paused,
    );
    const [actualDynamic, actualSession] = await Promise.all([
      getDynamicRules(),
      getSessionRules(),
    ]);
    const dynamicPlan = planReconcile(desiredDynamic, actualDynamic);
    const sessionPlan = planReconcile(desiredSession, actualSession);
    try {
      if (dynamicPlan !== null) {
        await updateDynamicRules(dynamicPlan);
      }
      if (sessionPlan !== null) {
        await updateSessionRules(sessionPlan);
      }
    } catch {
      // Inputs are pre-validated, so a rejected update is unexpected — but
      // storage has already changed, so the caller retries from a fresh read
      // and raises the health flag rather than leaving stale rules live.
      return false;
    }
    return true;
  }

  async function flagReconcileError(value: boolean): Promise<void> {
    if ((await getReconcileError()) !== value) {
      await setReconcileError(value);
    }
  }

  async function loadDoc(): Promise<StateDoc | undefined> {
    const raw = await readRaw();
    const outcome = migrate(raw);
    if (outcome.ok) {
      // An already-current doc is returned lock-free; a real migration is
      // persisted under the lock (re-reading first, so a commit that landed
      // since this unlocked read is not clobbered by the migrated older doc).
      return outcome.value === raw ? outcome.value : resolveStoredDoc();
    }
    // No downgrade chain exists; the newer version installed the live rules
    // deliberately, so leave storage and DNR untouched.
    if (outcome.error.kind === "newer-store") {
      return undefined;
    }
    // A corrupt doc to quarantine or an absent doc to seed, under the lock.
    return resolveStoredDoc();
  }

  // Fail closed: persist a real migration, quarantine an unreadable state and
  // reseed, so no header rules survive a state the user can no longer inspect.
  // The whole read-migrate-write cycle runs inside the state lock.
  function resolveStoredDoc(): Promise<StateDoc | undefined> {
    return locked(async () => {
      const raw = await readRaw();
      const outcome = migrate(raw);
      if (outcome.ok) {
        if (outcome.value !== raw) {
          await writeState(outcome.value);
        }
        return outcome.value;
      }
      if (outcome.error.kind === "newer-store") {
        return undefined;
      }
      if (raw !== undefined) {
        await quarantine(raw);
      }
      const seed = createV1Seed();
      await writeState(seed);
      return seed;
    });
  }

  async function refreshBadge(): Promise<void> {
    const outcome = migrate(await readRaw());
    if (outcome.ok) {
      const { state, title } = planBadge(outcome.value);
      await applyBadge(state, title);
    }
  }

  // The one session-row pruner: keep the rows the predicate accepts, across
  // every tab, in a single locked write. Tab close, cross-origin navigation and
  // a revoked grant are the same operation with different predicates, so a
  // revoke is one write however many tabs held the host.
  async function pruneOverrides(
    keep: (row: TabOverride, tabId: number) => boolean,
  ): Promise<void> {
    await locked(async () => {
      const current = await readSession();
      const entries = Object.entries(current.tabs)
        .map(([id, rows]): [string, TabOverride[]] => [
          id,
          rows.filter((row) => keep(row, Number(id))),
        ])
        .filter(([, rows]) => rows.length > 0);
      const tabs = Object.fromEntries(entries);
      if (
        Object.values(tabs).flat().length !==
        Object.values(current.tabs).flat().length
      ) {
        await writeSession({ ...current, tabs });
      }
    });
  }

  // A this-tab row lives exactly as long as its grant: a revoke takes it out
  // with the dynamic rules that shared the host, so activeTab has nothing left
  // to widen on that tab.
  async function endUngrantedOverrides(): Promise<void> {
    const granted = await grantSnapshot();
    await pruneOverrides((row) => originGranted(row.originHost, granted));
  }

  function enforceOverrideLifetime(
    tabId: number,
    url: string | undefined,
  ): Promise<void> {
    // activeTab exposes tab.url exactly while its grant is alive; a missing,
    // empty, or cross-origin url means the override's lifetime ended (the rows
    // must be gone before the user can re-click the icon after an A→B→A trip).
    // domainFromUrl parses defensively — an uncommitted tab hands back "".
    const host = domainFromUrl(url);
    return pruneOverrides((row, id) => id !== tabId || row.originHost === host);
  }

  function handleCommand(command: string): Promise<void> | undefined {
    if (command === "toggle-pause") {
      return mutateState((doc) => ({
        ...doc,
        settings: { ...doc.settings, paused: !doc.settings.paused },
      }));
    }
    if (command === "next-profile") {
      return mutateState(activateNextProfile);
    }
    return undefined;
  }

  function mutateState(update: (doc: StateDoc) => StateDoc): Promise<void> {
    return locked(async () => {
      const outcome = migrate(await readRaw());
      if (outcome.ok) {
        await writeState(update(outcome.value));
      }
    });
  }
});

function noop(): void {}

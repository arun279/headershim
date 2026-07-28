import { planBadge } from "../src/core/badge";
import { compile } from "../src/core/compile";
import {
  activatePreviousProfile,
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
  publishReconcileState,
  read as readSession,
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
  subscribeState(() => void reconcile());
  subscribeSession(() => void reconcile());
  // Grants are a compile input, so a grant change is a reconcile: it installs
  // the rules a grant was waiting on and pulls back the ones a revoke covered,
  // stored and This-tab alike.
  onGrantsChanged(() => void reconcile());
  browser.tabs.onRemoved.addListener((tabId) =>
    pruneOverrides((_row, id) => id !== tabId).catch(noop),
  );
  browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) =>
    enforceOverrideLifetime(tabId, tab.url).catch(noop),
  );
  browser.commands.onCommand.addListener((command) =>
    handleCommand(command)?.catch(noop),
  );
  browser.runtime.onStartup.addListener(() => void reconcile());
  browser.runtime.onInstalled.addListener(() => void reconcile());
  // A worker wake is itself a reconciliation trigger. Browser events are not
  // durable, so this also retries a stale rule left by a failed update before
  // the previous worker stopped.
  void reconcile();

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
        let failures = 0;
        // Three attempts survive two consecutive DNR update or readback
        // failures, allowing a revoked origin's installed rule to be removed
        // in the same pass.
        while (!(await applyOnce())) {
          if (++failures === 3) {
            await publishReconcileState(true);
            break;
          }
        }
        await refreshBadge();
      } while (dirty);
    } catch {
      // A throw outside the update*Rules window must still fail closed and
      // visible rather than escape unhandled and leave state unreconciled.
      await publishReconcileState(true).catch(noop);
      await refreshBadge().catch(noop);
    }
  }

  async function applyOnce(): Promise<boolean> {
    const doc = await loadDoc();
    if (doc === undefined) {
      // This build cannot compile a newer store. Retain the last published
      // identity while the health flag marks it unverified.
      await publishReconcileState(true);
      return true;
    }
    // Resolve every enabled regex against the browser's RE2 and read the live
    // grants before compiling both bands.
    const [session, granted, isRegexSupported] = await Promise.all([
      readSession(),
      grantSnapshot(),
      resolveRegexSupport(doc),
    ]);
    const batch = compile({
      doc,
      overrides: Object.values(session.tabs).flat(),
      granted,
      isRegexSupported,
    });
    const actual = await readRuleBands();
    if (actual === undefined) {
      return false;
    }
    const [actualDynamic, actualSession] = actual;
    const dynamicPlan = planReconcile(batch.dynamic, actualDynamic);
    const sessionPlan = planReconcile(batch.session, actualSession);
    if (dynamicPlan === null && sessionPlan === null) {
      await publishReconcileState(batch.overLimit);
      return true;
    }
    await publishReconcileState(true);
    try {
      if (dynamicPlan !== null) {
        await updateDynamicRules(dynamicPlan);
      }
      if (sessionPlan !== null) {
        await updateSessionRules(sessionPlan);
      }
    } catch {
      // Inputs are pre-validated, so a rejected update is unexpected, but
      // storage has already changed. Retry from a fresh read and keep the
      // health flag raised until both bands are verified.
      return false;
    }
    const installed = await readRuleBands();
    if (installed === undefined) {
      return false;
    }
    if (
      planReconcile(batch.dynamic, installed[0]) !== null ||
      planReconcile(batch.session, installed[1]) !== null
    ) {
      return false;
    }
    await publishReconcileState(batch.overLimit);
    return true;
  }

  async function readRuleBands(): Promise<
    | readonly [
        Awaited<ReturnType<typeof getDynamicRules>>,
        Awaited<ReturnType<typeof getSessionRules>>,
      ]
    | undefined
  > {
    for (const delay of [0, 50, 200]) {
      if (delay !== 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      try {
        return await Promise.all([getDynamicRules(), getSessionRules()]);
      } catch {}
    }
    return undefined;
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
  // every tab, in a single locked write. Tab close and cross-origin navigation
  // are the two lifetime ends that remove rows before the tab can reuse them.
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

  function enforceOverrideLifetime(
    tabId: number,
    url: string | undefined,
  ): Promise<void> {
    // activeTab exposes tab.url exactly while its grant is alive; a missing,
    // empty, or cross-origin url means the override's lifetime ended (the rows
    // must be gone before the user can re-click the icon after an A→B→A trip).
    // domainFromUrl parses defensively because an uncommitted tab hands back "".
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
    if (command === "previous-profile") {
      return mutateState(activatePreviousProfile);
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

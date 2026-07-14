import { planBadge } from "../src/core/badge";
import {
  compileDynamic,
  compileSession,
  dropUncompilable,
} from "../src/core/compile";
import { docMissingGrants } from "../src/core/grants";
import {
  type StateDoc,
  switchToNextProfile,
  type TabOverride,
} from "../src/core/model";
import { planReconcile } from "../src/core/reconcile";
import { createV1Seed, migrate } from "../src/core/schema";
import { computeStatus } from "../src/core/status";
import { applyBadge } from "../src/platform/badge";
import {
  getDynamicRules,
  getSessionRules,
  isRegexSupported,
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
  type SessionState,
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
  // Grants are not a compile input: Chrome enforces host access at match time,
  // so a grant change only moves the badge and needs-access surfaces, never the
  // resident rule set. Keeping the resident set a pure function of the stored doc
  // is deliberate — it lets the single-flight reconcile stay race-free and
  // deterministic. Accepted residual: a rule whose grant is revoked stays
  // resident in DNR but is inert, because Chrome declines to fire it at match
  // time; it clears on the next stored-doc reconcile. Fire-and-forget: a rejected
  // refresh is swallowed rather than left unhandled, matching runUntilSettled.
  onGrantsChanged(() => refreshBadge().catch(noop));
  browser.tabs.onRemoved.addListener((tabId) =>
    endOverrides(tabId).catch(noop),
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
    const session = await readSession();
    const desiredDynamic = compileDynamic(await compilableDoc(doc));
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

  // Resolve every enabled regex against the browser's RE2 (async) so the pure
  // core drop can strip rules Chrome would reject before they reach the atomic
  // batch. Distinct regexes only; the common case (none, or all already valid)
  // stays cheap.
  async function compilableDoc(doc: StateDoc): Promise<StateDoc> {
    const regexes = new Set<string>();
    for (const profile of doc.profiles) {
      if (!profile.enabled) {
        continue;
      }
      for (const rule of profile.rules) {
        if (rule.enabled && rule.scope.type === "regex") {
          regexes.add(rule.scope.regex);
        }
      }
    }
    const supported = new Set<string>();
    await Promise.all(
      [...regexes].map(async (regex) => {
        if ((await isRegexSupported(regex)).ok) {
          supported.add(regex);
        }
      }),
    );
    return dropUncompilable(doc, (regex) => supported.has(regex));
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
    if (!outcome.ok) {
      return;
    }
    const [granted, session, reconcileError] = await Promise.all([
      grantSnapshot(),
      readSession(),
      getReconcileError(),
    ]);
    const { state, tabBadges, title } = planBadge({
      doc: outcome.value,
      status: computeStatus({
        doc: outcome.value,
        grantGaps: docMissingGrants(outcome.value, granted),
        reconcileError,
      }),
      overrideTabIds: overrideTabIds(session),
    });
    await applyBadge(state, tabBadges, title);
  }

  async function endOverrides(
    tabId: number,
    keep: (row: TabOverride) => boolean = () => false,
  ): Promise<void> {
    const session = await readSession();
    if ((session.tabs[tabId] ?? []).length === 0) {
      return;
    }
    await locked(async () => {
      const current = await readSession();
      const rows = current.tabs[tabId] ?? [];
      const kept = rows.filter(keep);
      if (kept.length === rows.length) {
        return;
      }
      const tabs = Object.fromEntries(
        Object.entries(current.tabs)
          .map(([id, tabRows]): [string, TabOverride[]] =>
            Number(id) === tabId ? [id, kept] : [id, tabRows],
          )
          .filter(([, tabRows]) => tabRows.length > 0),
      );
      await writeSession({ ...current, tabs });
    });
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
    return endOverrides(tabId, (row) => row.originHost === host);
  }

  function handleCommand(command: string): Promise<void> | undefined {
    if (command === "toggle-pause") {
      return mutateState((doc) => ({
        ...doc,
        settings: { ...doc.settings, paused: !doc.settings.paused },
      }));
    }
    if (command === "next-profile") {
      return mutateState(switchToNextProfile);
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

function overrideTabIds(session: SessionState): number[] {
  return Object.entries(session.tabs)
    .filter(([, rows]) => rows.length > 0)
    .map(([tabId]) => Number(tabId));
}

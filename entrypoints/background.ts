import { planBadge } from "../src/core/badge";
import {
  compileDynamic,
  compileSession,
  dropUncompilable,
} from "../src/core/compile";
import { docMissingGrants } from "../src/core/grants";
import {
  activateProfile,
  type StateDoc,
  type TabOverride,
} from "../src/core/model";
import { planReconcile } from "../src/core/reconcile";
import { createV1Seed, migrate } from "../src/core/schema";
import { computeStatus } from "../src/core/status";
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
  // Grants are not a compile input: Chrome enforces host access at match
  // time, so a grant change only moves badge and needs-access surfaces.
  // Fire-and-forget cleanup listeners swallow their own rejections (a rejected
  // write must not escape unhandled, matching runUntilSettled's fail-closed
  // discipline) while still returning the promise so callers can await settling.
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
    return dropUncompilable(doc, await resolveRegexSupport(doc));
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

function activateNextProfile(doc: StateDoc): StateDoc {
  const activeIndex = doc.profiles.findIndex(
    (profile) => profile.id === doc.activeProfileId,
  );
  for (let step = 1; step <= doc.profiles.length; step += 1) {
    const next = doc.profiles[(activeIndex + step) % doc.profiles.length];
    if (next === undefined) {
      continue;
    }
    const activated = activateProfile(doc, next.id);
    if (activated.activeProfileId === next.id) {
      return activated;
    }
  }
  return doc;
}

function noop(): void {}

function overrideTabIds(session: SessionState): number[] {
  return Object.entries(session.tabs)
    .filter(([, rows]) => rows.some((row) => row.enabled))
    .map(([tabId]) => Number(tabId));
}

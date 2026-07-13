import { planBadge } from "../src/core/badge";
import { compileDynamic, compileSession } from "../src/core/compile";
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
  onGrantsChanged(() => void refreshBadge());
  browser.tabs.onRemoved.addListener((tabId) => endOverrides(tabId));
  browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) =>
    enforceOverrideLifetime(tabId, tab.url),
  );
  browser.commands.onCommand.addListener((command) => handleCommand(command));

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
      await flagReconcileError(true).catch(() => {});
      await refreshBadge().catch(() => {});
    }
  }

  async function applyOnce(): Promise<boolean> {
    const doc = await loadDoc();
    if (doc === undefined) {
      return true;
    }
    const session = await readSession();
    const desiredDynamic = compileDynamic(doc);
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
    if (raw !== undefined) {
      const outcome = migrate(raw);
      if (outcome.ok) {
        if (outcome.value !== raw) {
          await locked(() => writeState(outcome.value));
        }
        return outcome.value;
      }
      if (outcome.error.kind === "newer-store") {
        // No downgrade chain exists; the newer version installed the live
        // rules deliberately, so leave storage and DNR untouched.
        return undefined;
      }
    }
    return recoverDoc();
  }

  // Fail closed: quarantine whatever was stored and reseed, so no header
  // rules survive a state the user can no longer inspect.
  function recoverDoc(): Promise<StateDoc | undefined> {
    return locked(async () => {
      const raw = await readRaw();
      const outcome = migrate(raw);
      if (outcome.ok) {
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
    const { state, tabBadges } = planBadge({
      doc: outcome.value,
      status: computeStatus({
        doc: outcome.value,
        grantGaps: docMissingGrants(outcome.value, granted),
        reconcileError,
      }),
      overrideTabIds: overrideTabIds(session),
    });
    await applyBadge(state, tabBadges);
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

function overrideTabIds(session: SessionState): number[] {
  return Object.entries(session.tabs)
    .filter(([, rows]) => rows.length > 0)
    .map(([tabId]) => Number(tabId));
}

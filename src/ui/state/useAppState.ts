import { useEffect, useState } from "preact/hooks";
import {
  docMissingGrants,
  type GrantSnapshot,
  type RuleGrantGap,
} from "../../core/grants";
import type { StateDoc } from "../../core/model";
import { migrate } from "../../core/schema";
import { computeStatus, type SystemStatus } from "../../core/status";
import {
  snapshot as grantSnapshot,
  onChanged as onGrantsChanged,
} from "../../platform/permissions";
import {
  getReconcileError,
  read as readSession,
  type SessionState,
  subscribeReconcileError,
  subscribe as subscribeSession,
} from "../../platform/session-store";
import { readRaw, subscribe as subscribeStore } from "../../platform/store";
import { activeTabId } from "../../platform/tabs";

export type AppState =
  | { readonly phase: "initializing" }
  | { readonly phase: "newer-store"; readonly foundVersion: number }
  | {
      readonly phase: "ready";
      readonly doc: StateDoc;
      readonly status: SystemStatus;
      readonly grants: GrantSnapshot;
      readonly grantGaps: readonly RuleGrantGap[];
      readonly overrideCount: number;
    };

type DocSource = { readonly doc: StateDoc } | { readonly newerVersion: number };

/**
 * Projects the popup's world from its two buses: the state document over
 * `storage.onChanged` and the live grant snapshot over `permissions.onChanged`
 * (plus the session store for This-tab rows and the reconcile health flag).
 * A grant revoked while the popup is open flips the needs-access surfaces at
 * the same moment it flips the badge — both read `computeStatus`.
 */
export function useAppState(): AppState {
  const [docSource, setDocSource] = useState<DocSource | undefined>(undefined);
  const [grants, setGrants] = useState<GrantSnapshot | undefined>(undefined);
  const [session, setSession] = useState<SessionState>({
    nextNum: 1,
    tabs: {},
  });
  const [reconcileError, setReconcileError] = useState(false);
  const [tabId, setTabId] = useState<number | undefined>(undefined);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let disposed = false;
    const assign =
      <T>(set: (value: T) => void) =>
      (value: T) => {
        if (!disposed) {
          set(value);
        }
      };

    const loadDoc = async () => {
      const outcome = migrate(await readRaw());
      if (disposed) {
        return;
      }
      if (outcome.ok) {
        setDocSource({ doc: outcome.value });
      } else if (outcome.error.kind === "newer-store") {
        setDocSource({ newerVersion: outcome.error.foundVersion });
      }
      // A missing or corrupt doc stays in the initializing phase: the
      // background quarantines and reseeds, and that write lands here through
      // the storage subscription.
    };
    const loadGrants = () => grantSnapshot().then(assign(setGrants));
    const loadSession = () => readSession().then(assign(setSession));
    const loadHealth = () =>
      getReconcileError().then(assign(setReconcileError));

    // Ready only once every source has answered, so the first rendered state
    // never flashes a false Live while the health flag or session rows are
    // still in flight.
    void Promise.all([
      loadDoc(),
      loadGrants(),
      loadSession(),
      loadHealth(),
      activeTabId().then(assign(setTabId)),
    ]).then(() => assign(setBooted)(true));

    const unsubscribe = [
      subscribeStore(() => void loadDoc()),
      onGrantsChanged(() => void loadGrants()),
      subscribeSession(() => void loadSession()),
      subscribeReconcileError(() => void loadHealth()),
    ];
    return () => {
      disposed = true;
      for (const dispose of unsubscribe) {
        dispose();
      }
    };
  }, []);

  if (!booted || docSource === undefined || grants === undefined) {
    return { phase: "initializing" };
  }
  if ("newerVersion" in docSource) {
    return { phase: "newer-store", foundVersion: docSource.newerVersion };
  }

  const grantGaps = docMissingGrants(docSource.doc, grants);
  return {
    phase: "ready",
    doc: docSource.doc,
    status: computeStatus({ doc: docSource.doc, grantGaps, reconcileError }),
    grants,
    grantGaps,
    overrideCount: tabId === undefined ? 0 : (session.tabs[tabId] ?? []).length,
  };
}

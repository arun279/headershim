import { useEffect, useMemo, useState } from "preact/hooks";
import { confirm, type Live } from "../../core/applied";
import { compile } from "../../core/compile";
import type { GrantSnapshot } from "../../core/grants";
import type { StateDoc, TabOverride } from "../../core/model";
import { type RulesRevision, revisionOf } from "../../core/revision";
import { migrate } from "../../core/schema";
import type { Batch } from "../../core/verdict";
import { resolveRegexSupport } from "../../platform/dnr";
import {
  snapshot as grantSnapshot,
  onChanged as onGrantsChanged,
} from "../../platform/permissions";
import {
  getAppliedRevision,
  read as readSession,
  type SessionState,
  subscribeAppliedRevision,
  subscribe as subscribeSession,
} from "../../platform/session-store";
import { readRaw, subscribe as subscribeStore } from "../../platform/store";
import { activeTabId } from "../../platform/tabs";

export const BOOT_GRACE_MS = 3000;

export type AppState =
  | { readonly phase: "initializing" }
  | { readonly phase: "unavailable" }
  | { readonly phase: "newer-store"; readonly foundVersion: number }
  | {
      readonly phase: "ready";
      readonly doc: StateDoc;
      readonly live: Live;
      readonly grants: GrantSnapshot;
      readonly isRegexSupported: (regex: string) => boolean;
      /** The active tab's id; undefined on chrome:// and store pages. */
      readonly tabId: number | undefined;
      /** This-tab session overrides for the active tab, in insertion order. */
      readonly overrides: readonly TabOverride[];
      readonly session: SessionState;
    };

type DocSource =
  | {
      readonly doc: StateDoc;
      readonly isRegexSupported: (regex: string) => boolean;
    }
  | { readonly newerVersion: number };

export function useAppState(): AppState {
  const [docSource, setDocSource] = useState<DocSource | undefined>(undefined);
  const [grants, setGrants] = useState<GrantSnapshot | undefined>(undefined);
  const [session, setSession] = useState<SessionState>({
    nextNum: 1,
    tabs: {},
  });
  const [appliedRevision, setAppliedRevision] = useState<RulesRevision>();
  const [expected, setExpected] = useState<{
    readonly batch: Batch;
    readonly revision: RulesRevision;
  }>();
  const [tabId, setTabId] = useState<number | undefined>(undefined);
  const [boot, setBoot] = useState<"pending" | "ready" | "failed">("pending");
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let docGeneration = 0;
    let appliedGeneration = 0;
    const graceTimer = setTimeout(() => setGraceElapsed(true), BOOT_GRACE_MS);
    const setLoadedDoc = (source: DocSource) => {
      clearTimeout(graceTimer);
      setDocSource(source);
    };
    const assign =
      <T>(set: (value: T) => void) =>
      (value: T) => {
        if (!disposed) {
          set(value);
        }
      };

    const loadDoc = async () => {
      const generation = ++docGeneration;
      const outcome = migrate(await readRaw());
      if (disposed || generation !== docGeneration) {
        return;
      }
      if (outcome.ok) {
        const isRegexSupported = await resolveRegexSupport(outcome.value);
        if (!disposed && generation === docGeneration) {
          setLoadedDoc({ doc: outcome.value, isRegexSupported });
        }
      } else if (outcome.error.kind === "newer-store") {
        setLoadedDoc({ newerVersion: outcome.error.foundVersion });
      }
    };
    const loadGrants = () => grantSnapshot().then(assign(setGrants));
    const loadSession = () => readSession().then(assign(setSession));
    const loadApplied = async () => {
      const generation = ++appliedGeneration;
      const revision = await getAppliedRevision();
      if (!disposed && generation === appliedGeneration) {
        setAppliedRevision(revision);
      }
    };

    // Wait for the applied revision and session rows before projecting live
    // state.
    void Promise.all([
      loadDoc(),
      loadGrants(),
      loadSession(),
      loadApplied(),
      activeTabId().then(assign(setTabId)),
    ]).then(
      () => assign(setBoot)("ready"),
      () => assign(setBoot)("failed"),
    );

    const unsubscribe = [
      subscribeStore(() => void loadDoc()),
      onGrantsChanged(() => void loadGrants()),
      subscribeSession(() => void loadSession()),
      subscribeAppliedRevision(() => void loadApplied()),
    ];
    return () => {
      disposed = true;
      clearTimeout(graceTimer);
      for (const dispose of unsubscribe) {
        dispose();
      }
    };
  }, []);

  const batch = useMemo(
    () =>
      docSource !== undefined &&
      !("newerVersion" in docSource) &&
      grants !== undefined
        ? compile({
            doc: docSource.doc,
            overrides: Object.values(session.tabs).flat(),
            granted: grants,
            isRegexSupported: docSource.isRegexSupported,
          })
        : undefined,
    [docSource, grants, session],
  );
  useEffect(() => {
    let disposed = false;
    if (batch !== undefined) {
      void revisionOf(batch.dynamic, batch.session).then((revision) => {
        if (!disposed) {
          setExpected({ batch, revision });
        }
      });
    }
    return () => {
      disposed = true;
    };
  }, [batch]);

  if (docSource && "newerVersion" in docSource) {
    return { phase: "newer-store", foundVersion: docSource.newerVersion };
  }

  if (boot === "failed" || (graceElapsed && docSource === undefined)) {
    return { phase: "unavailable" };
  }

  if (
    boot !== "ready" ||
    docSource === undefined ||
    grants === undefined ||
    batch === undefined
  ) {
    return { phase: "initializing" };
  }

  return {
    phase: "ready",
    doc: docSource.doc,
    live: confirm(
      batch,
      expected?.batch === batch ? expected.revision : undefined,
      appliedRevision,
    ),
    grants,
    isRegexSupported: docSource.isRegexSupported,
    tabId,
    overrides: tabId === undefined ? [] : (session.tabs[tabId] ?? []),
    session,
  };
}

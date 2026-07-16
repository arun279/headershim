import { type HeaderValidationError, validateHeader } from "../../core/headers";
import { checkSessionOverrideLimit, type LimitError } from "../../core/limits";
import type { Direction, HeaderOp, TabOverride } from "../../core/model";
import { ok, type Result } from "../../core/result";
import {
  read as readSession,
  write as writeSession,
} from "../../platform/session-store";
import { locked } from "../../platform/store";

/**
 * The popup's write path for This-tab session overrides. It touches only the
 * session store's metadata; it never calls `updateSessionRules`. The background
 * scheduler is the sole DNR writer — it observes this write over
 * `storage.session.onChanged` and reconciles the live session rule set. Writes
 * share the state lock so they interleave cleanly with the background's own
 * lifetime pruning (tab close, cross-origin navigation).
 */

export interface OverrideDraft {
  readonly direction: Direction;
  readonly operation: HeaderOp;
  readonly header: string;
  readonly value?: string;
}

// addOverride can fail only on the session-override cap or header validation;
// the dynamic store's rule/regex/byte caps never gate this write path, so they
// stay out of the type (and out of ThisTab's error mapping).
export type SessionMutationError =
  | Extract<LimitError, { kind: "session-override-limit-exceeded" }>
  | HeaderValidationError;

export function addOverride(
  tabId: number,
  originHost: string,
  draft: OverrideDraft,
): Promise<Result<TabOverride, SessionMutationError>> {
  const validated = validateHeader({
    direction: draft.direction,
    operation: draft.operation,
    header: draft.header,
    ...(draft.value === undefined ? {} : { value: draft.value }),
  });
  if (!validated.ok) {
    return Promise.resolve(validated);
  }
  return locked(async () => {
    const session = await readSession();
    const total = totalOverrides(session.tabs);
    const cap = checkSessionOverrideLimit(total + 1);
    if (!cap.ok) {
      return cap;
    }
    const row: TabOverride = {
      num: session.nextNum,
      tabId,
      originHost,
      direction: draft.direction,
      operation: draft.operation,
      header: validated.value.header,
      enabled: true,
      ...(validated.value.value === undefined
        ? {}
        : { value: validated.value.value }),
    };
    await writeSession({
      nextNum: session.nextNum + 1,
      tabs: { ...session.tabs, [tabId]: [...(session.tabs[tabId] ?? []), row] },
    });
    return ok(row);
  });
}

export function removeOverride(tabId: number, num: number): Promise<void> {
  return locked(async () => {
    const session = await readSession();
    const kept = (session.tabs[tabId] ?? []).filter((row) => row.num !== num);
    await writeSession({
      ...session,
      tabs: withTab(session.tabs, tabId, kept),
    });
  });
}

/** Enables or suspends one temporary row without changing its lifetime. */
export function setOverrideEnabled(
  tabId: number,
  num: number,
  enabled: boolean,
): Promise<void> {
  return locked(async () => {
    const session = await readSession();
    const rows = session.tabs[tabId] ?? [];
    if (!rows.some((row) => row.num === num && row.enabled !== enabled)) {
      return;
    }
    await writeSession({
      ...session,
      tabs: {
        ...session.tabs,
        [tabId]: rows.map((row) =>
          row.num === num ? { ...row, enabled } : row,
        ),
      },
    });
  });
}

/** Replaces only a temporary row's value; structure and insertion order stay put. */
export function updateOverrideValue(
  tabId: number,
  num: number,
  value: string,
): Promise<Result<TabOverride | undefined, SessionMutationError>> {
  return locked(async () => {
    const session = await readSession();
    const current = (session.tabs[tabId] ?? []).find((row) => row.num === num);
    if (current === undefined) return ok(undefined);
    const validated = validateHeader({
      direction: current.direction,
      operation: current.operation,
      header: current.header,
      value,
    });
    if (!validated.ok) return validated;
    const { value: _value, ...withoutValue } = current;
    const updated: TabOverride = {
      ...withoutValue,
      ...(validated.value.value === undefined
        ? {}
        : { value: validated.value.value }),
    };
    await writeSession({
      ...session,
      tabs: {
        ...session.tabs,
        [tabId]: (session.tabs[tabId] ?? []).map((row) =>
          row.num === num ? updated : row,
        ),
      },
    });
    return ok(updated);
  });
}

/** Restores a promoted row at its prior position when its rule is discarded. */
export function restoreOverride(
  override: TabOverride,
  index: number,
): Promise<void> {
  return locked(async () => {
    const session = await readSession();
    const rows = session.tabs[override.tabId] ?? [];
    if (rows.some((row) => row.num === override.num)) {
      return;
    }
    const restored = [...rows];
    restored.splice(Math.max(0, Math.min(index, restored.length)), 0, override);
    await writeSession({
      nextNum: Math.max(session.nextNum, override.num + 1),
      tabs: {
        ...session.tabs,
        [override.tabId]: restored,
      },
    });
  });
}

/**
 * Fallback lifetime enforcement on popup open: drop this tab's overrides whose
 * origin no longer matches where the tab sits (or all of them when the tab has
 * no web origin). The background's `tabs.onUpdated` handler is the primary
 * enforcer; this covers a navigation it missed while the worker was asleep.
 */
export function pruneForeignOrigins(
  tabId: number,
  host: string | undefined,
): Promise<void> {
  return locked(async () => {
    const session = await readSession();
    const rows = session.tabs[tabId] ?? [];
    const kept =
      host === undefined ? [] : rows.filter((row) => row.originHost === host);
    if (kept.length === rows.length) {
      return;
    }
    await writeSession({
      ...session,
      tabs: withTab(session.tabs, tabId, kept),
    });
  });
}

function totalOverrides(tabs: { [tabId: number]: TabOverride[] }): number {
  return Object.values(tabs).reduce((count, rows) => count + rows.length, 0);
}

function withTab(
  tabs: { [tabId: number]: TabOverride[] },
  tabId: number,
  rows: TabOverride[],
): { [tabId: number]: TabOverride[] } {
  const next = { ...tabs };
  if (rows.length === 0) {
    delete next[tabId];
  } else {
    next[tabId] = rows;
  }
  return next;
}

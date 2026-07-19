import { describe, expect, it } from "vitest";
import { MAX_SESSION_OVERRIDES } from "../../core/limits";
import type { TabOverride } from "../../core/model";
import { read as readSession, write } from "../../platform/session-store";
import {
  addOverride,
  type OverrideDraft,
  pruneForeignOrigins,
  removeOverride,
  setOverrideEnabled,
  updateOverrideValue,
} from "./session-mutations";

const draft: OverrideDraft = {
  direction: "request",
  operation: "set",
  header: "x-debug-trace",
  value: "1",
};

function row(num: number, tabId: number, originHost: string): TabOverride {
  return {
    num,
    tabId,
    originHost,
    direction: "request",
    operation: "set",
    header: "x-tab",
    value: "on",
    enabled: true,
  };
}

describe("session mutations", () => {
  it("adds a row with an allocated num and lowercased header", async () => {
    const outcome = await addOverride(5, "app.example.com", {
      ...draft,
      header: "X-Debug-Trace",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value).toMatchObject({
      num: 1,
      tabId: 5,
      originHost: "app.example.com",
      header: "x-debug-trace",
      value: "1",
    });
    const session = await readSession();
    expect(session.nextNum).toBe(2);
    expect(session.tabs[5]).toEqual([outcome.value]);
  });

  it("appends to the tab and advances nextNum across tabs", async () => {
    await addOverride(5, "app.example.com", draft);
    await addOverride(5, "app.example.com", { ...draft, header: "x-two" });
    await addOverride(9, "other.example.com", { ...draft, header: "x-three" });

    const session = await readSession();
    expect(session.nextNum).toBe(4);
    expect(session.tabs[5]?.map((entry) => entry.num)).toEqual([1, 2]);
    expect(session.tabs[9]?.map((entry) => entry.num)).toEqual([3]);
  });

  it("rejects an invalid header before writing anything", async () => {
    const outcome = await addOverride(5, "app.example.com", {
      ...draft,
      header: ":authority",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("name-not-modifiable");
    }
    expect((await readSession()).tabs[5]).toBeUndefined();
  });

  it("surfaces the session cap once the global count is at the limit", async () => {
    const tabs: { [tabId: number]: TabOverride[] } = {
      5: Array.from({ length: MAX_SESSION_OVERRIDES }, (_, index) =>
        row(index + 1, 5, "app.example.com"),
      ),
    };
    await write({ nextNum: MAX_SESSION_OVERRIDES + 1, tabs });

    const outcome = await addOverride(9, "other.example.com", draft);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("session-override-limit-exceeded");
    }
    expect((await readSession()).tabs[9]).toBeUndefined();
  });

  it("removes one row and prunes an emptied tab entry", async () => {
    await write({
      nextNum: 3,
      tabs: { 5: [row(1, 5, "app.example.com"), row(2, 5, "app.example.com")] },
    });

    await removeOverride(5, 1);
    expect((await readSession()).tabs[5]?.map((entry) => entry.num)).toEqual([
      2,
    ]);

    await removeOverride(5, 2);
    expect((await readSession()).tabs).toEqual({});
  });

  it("toggles one row without changing its identity or neighbors", async () => {
    const first = row(1, 5, "app.example.com");
    const second = row(2, 5, "app.example.com");
    await write({ nextNum: 3, tabs: { 5: [first, second] } });

    await setOverrideEnabled(5, 1, false);

    expect((await readSession()).tabs[5]).toEqual([
      { ...first, enabled: false },
      second,
    ]);
  });

  it("updates only a row's complete value through header validation", async () => {
    const first = row(1, 5, "app.example.com");
    await write({ nextNum: 2, tabs: { 5: [first] } });

    const updated = await updateOverrideValue(5, 1, "rotated");
    expect(updated.ok).toBe(true);
    expect((await readSession()).tabs[5]?.[0]).toEqual({
      ...first,
      value: "rotated",
    });

    const rejected = await updateOverrideValue(5, 1, "line\nbreak");
    expect(rejected.ok).toBe(false);
    expect((await readSession()).tabs[5]?.[0]?.value).toBe("rotated");
  });

  it("returns an empty success when the row was removed before the update", async () => {
    const outcome = await updateOverrideValue(5, 1, "rotated");

    expect(outcome).toEqual({ ok: true, value: undefined });
    expect((await readSession()).tabs).toEqual({});
  });

  it("prunes rows whose origin no longer matches where the tab sits", async () => {
    await write({
      nextNum: 3,
      tabs: {
        5: [row(1, 5, "app.example.com"), row(2, 5, "stale.example.com")],
      },
    });

    await pruneForeignOrigins(5, "app.example.com");

    expect((await readSession()).tabs[5]?.map((entry) => entry.num)).toEqual([
      1,
    ]);
  });

  it("prunes every row when the tab has no web origin", async () => {
    await write({
      nextNum: 2,
      tabs: { 5: [row(1, 5, "app.example.com")] },
    });

    await pruneForeignOrigins(5, undefined);

    expect((await readSession()).tabs).toEqual({});
  });

  it("leaves the store untouched when nothing needs pruning", async () => {
    await write({
      nextNum: 2,
      tabs: { 5: [row(1, 5, "app.example.com")] },
    });

    await pruneForeignOrigins(5, "app.example.com");

    expect((await readSession()).tabs[5]).toHaveLength(1);
  });
});

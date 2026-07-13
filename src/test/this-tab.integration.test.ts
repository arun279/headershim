import { fakeBrowser } from "@webext-core/fake-browser";
import { beforeEach, describe, expect, it } from "vitest";
import background from "../../entrypoints/background";
import { compileSession } from "../core/compile";
import { createV1Seed } from "../core/schema";
import { read as readSession } from "../platform/session-store";
import { write as writeState } from "../platform/store";
import { addOverride, removeOverride } from "../ui/state/session-mutations";
import { installDnr, settle, tabInfo } from "./dnr-harness";

let dnr: ReturnType<typeof installDnr>;

beforeEach(() => {
  dnr = installDnr();
});

/**
 * The popup writes This-tab overrides as session metadata only; the background
 * scheduler is the sole DNR writer. These tests drive the real popup write path
 * (`addOverride`/`removeOverride`) against the real background and assert that
 * exactly one `updateSessionRules` per change originates from the background.
 */
describe("This-tab session overrides — end to end", () => {
  it("applies a popup override with exactly one background session write", async () => {
    background.main();
    await writeState(createV1Seed());
    await settle();
    dnr.updateSessionRules.mockClear();

    const outcome = await addOverride(5, "app.example.com", {
      direction: "request",
      operation: "set",
      header: "x-debug-trace",
      value: "1",
    });
    await settle();
    expect(outcome.ok).toBe(true);

    const rows = (await readSession()).tabs[5] ?? [];
    expect(dnr.updateSessionRules).toHaveBeenCalledExactlyOnceWith({
      removeRuleIds: [],
      addRules: compileSession(rows, false),
    });
    // The popup never touches the dynamic set for a session change.
    expect(dnr.updateDynamicRules).not.toHaveBeenCalled();
    const [applied] = await dnr.fake.getSessionRules();
    expect(applied?.condition).toMatchObject({
      tabIds: [5],
      requestDomains: ["app.example.com"],
    });
  });

  it("removes the session rule when the popup drops the row", async () => {
    background.main();
    await writeState(createV1Seed());
    const added = await addOverride(5, "app.example.com", {
      direction: "request",
      operation: "set",
      header: "x-debug-trace",
      value: "1",
    });
    await settle();
    if (!added.ok) {
      throw new Error("override was not added");
    }
    dnr.updateSessionRules.mockClear();

    await removeOverride(5, added.value.num);
    await settle();

    expect(dnr.updateSessionRules).toHaveBeenCalledExactlyOnceWith({
      removeRuleIds: [added.value.num],
      addRules: [],
    });
    expect(await dnr.fake.getSessionRules()).toEqual([]);
  });

  it("drops a popup override on tab close and cross-origin navigation", async () => {
    background.main();
    await writeState(createV1Seed());
    await addOverride(5, "app.example.com", {
      direction: "request",
      operation: "set",
      header: "x-a",
      value: "1",
    });
    await addOverride(7, "kept.example.com", {
      direction: "request",
      operation: "set",
      header: "x-b",
      value: "1",
    });
    await settle();

    await fakeBrowser.tabs.onRemoved.trigger(5, {
      windowId: 1,
      isWindowClosing: false,
    });
    await settle();
    expect(Object.keys((await readSession()).tabs)).toEqual(["7"]);

    await fakeBrowser.tabs.onUpdated.trigger(
      7,
      { status: "loading" },
      tabInfo(7, "https://other.example.com/"),
    );
    await settle();
    expect((await readSession()).tabs).toEqual({});
    expect(await dnr.fake.getSessionRules()).toEqual([]);
  });

  it("suspends popup overrides under global pause", async () => {
    background.main();
    const seed = createV1Seed();
    await writeState(seed);
    await addOverride(5, "app.example.com", {
      direction: "request",
      operation: "set",
      header: "x-a",
      value: "1",
    });
    await settle();
    expect(await dnr.fake.getSessionRules()).toHaveLength(1);

    await writeState({ ...seed, settings: { ...seed.settings, paused: true } });
    await settle();
    expect(await dnr.fake.getSessionRules()).toEqual([]);

    await writeState({
      ...seed,
      settings: { ...seed.settings, paused: false },
    });
    await settle();
    expect(await dnr.fake.getSessionRules()).toHaveLength(1);
  });
});

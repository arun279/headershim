import { fakeBrowser } from "@webext-core/fake-browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import background from "../../entrypoints/background";
import { compileDynamic, compileSession, type DnrRule } from "../core/compile";
import {
  createProfile,
  createRule,
  type Rule,
  type RuleDraft,
  type StateDoc,
} from "../core/model";
import { createV1Seed } from "../core/schema";
import {
  getReconcileError,
  read as readSessionState,
  write as writeSession,
} from "../platform/session-store";
import {
  locked,
  read as readState,
  write as writeState,
} from "../platform/store";
import {
  installDnr,
  settle,
  tabInfo as tabInfoAt,
  tabOverride,
} from "./dnr-harness";

let dnr: ReturnType<typeof installDnr>;

beforeEach(() => {
  dnr = installDnr();
});

function start() {
  background.main();
}

const baseDraft: RuleDraft = {
  direction: "request",
  operation: "set",
  header: "x-test",
  value: "1",
  scope: { type: "domains", domains: ["example.com"] },
  resourceTypes: "all",
  initiators: [],
  enabled: true,
};

function withRule(doc: StateDoc, header: string): StateDoc {
  const [rule, next] = createRule(doc, { ...baseDraft, header });
  return {
    ...next,
    profiles: next.profiles.map((profile, index) =>
      index === 0 ? { ...profile, rules: [...profile.rules, rule] } : profile,
    ),
  };
}

const override = (tabId: number, originHost: string) =>
  tabOverride({ tabId, originHost });

const tabInfo = (url?: string) => tabInfoAt(5, url);

function triggerCommand(command: string): Promise<unknown> {
  const event = fakeBrowser.commands.onCommand as unknown as {
    trigger(name: string): Promise<unknown[]>;
  };
  return event.trigger(command);
}

function registered(event: object): boolean {
  return (event as { hasListeners(): boolean }).hasListeners();
}

async function storedValue(key: string): Promise<unknown> {
  const stored = await fakeBrowser.storage.local.get(key);
  return stored[key];
}

function quarantinedValue(): Promise<unknown> {
  return storedValue("state_quarantine");
}

function uiMutate(update: (doc: StateDoc) => StateDoc): Promise<void> {
  return locked(async () => {
    const doc = await readState();
    await writeState(update(doc));
  });
}

const addRule = (header: string) => (doc: StateDoc) => withRule(doc, header);

describe("background lifecycle", () => {
  it("seeds the Default profile on install without touching rule sets", async () => {
    start();

    await fakeBrowser.runtime.onInstalled.trigger({
      reason: "install",
      temporary: false,
    });
    await settle();

    const doc = await readState();
    expect(doc.v).toBe(1);
    expect(doc.profiles).toHaveLength(1);
    expect(doc.profiles[0]).toMatchObject({
      name: "Default",
      rules: [],
    });
    expect(doc.activeProfileId).toBe(doc.profiles[0]?.id);
    expect(doc.profiles[0]).not.toHaveProperty("enabled");
    expect(await quarantinedValue()).toBeUndefined();
    expect(dnr.updateDynamicRules).not.toHaveBeenCalled();
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
  });

  it("applies a storage change with exactly one dynamic replace", async () => {
    start();
    const doc = withRule(createV1Seed(), "x-one");

    await writeState(doc);
    await settle();

    expect(dnr.updateDynamicRules).toHaveBeenCalledExactlyOnceWith({
      removeRuleIds: [],
      addRules: compileDynamic(doc),
    });
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
  });

  it("makes no DNR writes when already converged", async () => {
    start();
    await writeState(withRule(createV1Seed(), "x-one"));
    await settle();
    dnr.updateDynamicRules.mockClear();
    dnr.updateSessionRules.mockClear();

    await fakeBrowser.runtime.onStartup.trigger();
    await settle();

    expect(dnr.getDynamicRules).toHaveBeenCalled();
    expect(dnr.getSessionRules).toHaveBeenCalled();
    expect(dnr.updateDynamicRules).not.toHaveBeenCalled();
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
  });

  it("self-heals drifted rule sets on a non-install browser event", async () => {
    start();
    const doc = withRule(createV1Seed(), "x-one");
    await writeState(doc);
    await settle();
    const stray: DnrRule = {
      id: 99,
      priority: 7,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "x-stray", operation: "set", value: "z" }],
      },
      condition: { resourceTypes: ["xmlhttprequest"] },
    };
    dnr.fake.dynamicRules = [stray];
    dnr.updateDynamicRules.mockClear();

    await fakeBrowser.runtime.onInstalled.trigger({
      reason: "update",
      temporary: false,
    });
    await settle();

    expect(dnr.updateDynamicRules).toHaveBeenCalledExactlyOnceWith({
      removeRuleIds: [99],
      addRules: compileDynamic(doc),
    });
    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(doc));
  });

  it("recomputes the badge on a grant change with zero DNR writes", async () => {
    start();
    const setBackground = vi.spyOn(browser.action, "setBadgeBackgroundColor");
    const setOptions = vi.spyOn(
      browser.declarativeNetRequest,
      "setExtensionActionOptions",
    );
    await writeState(withRule(createV1Seed(), "x-one"));
    await settle();
    expect(setBackground).toHaveBeenCalledWith({ color: "#B07B00" });
    dnr.updateDynamicRules.mockClear();
    dnr.updateSessionRules.mockClear();
    setBackground.mockClear();
    setOptions.mockClear();

    await fakeBrowser.permissions.request({
      origins: ["*://*.example.com/*"],
    });
    await settle();

    expect(setBackground).toHaveBeenCalledWith({ color: "#4F5BC4" });
    expect(setOptions).toHaveBeenCalledWith({
      displayActionCountAsBadgeText: true,
    });
    expect(dnr.updateDynamicRules).not.toHaveBeenCalled();
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
  });

  it("serializes overlapping triggers onto the newest stored revision", async () => {
    start();
    const docA = withRule(createV1Seed(), "x-a");
    const docB = withRule(docA, "x-b");
    let release = () => {};
    dnr.updateDynamicRules.mockImplementationOnce(
      (options) =>
        new Promise<void>((resolve) => {
          release = () => {
            void dnr.fake.updateDynamicRules(options);
            resolve();
          };
        }),
    );

    await writeState(docA);
    await settle();
    expect(dnr.updateDynamicRules).toHaveBeenCalledTimes(1);

    await writeState(docB);
    await settle();
    expect(dnr.updateDynamicRules).toHaveBeenCalledTimes(1);

    release();
    await settle();

    expect(dnr.updateDynamicRules).toHaveBeenCalledTimes(2);
    expect(dnr.updateDynamicRules.mock.calls[1]?.[0]?.removeRuleIds).toEqual(
      compileDynamic(docA).map((rule) => rule.id),
    );
    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(docB));
  });

  it("reconciles a revision stored while the badge refresh is in flight", async () => {
    start();
    const docA = withRule(createV1Seed(), "x-a");
    const docB = withRule(docA, "x-b");
    vi.spyOn(
      browser.declarativeNetRequest,
      "setExtensionActionOptions",
    ).mockImplementationOnce(async () => {
      await writeState(docB);
    });

    await writeState(docA);
    await settle();

    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(docB));
  });

  it("retries a rejected update once from a fresh read", async () => {
    start();
    const doc = withRule(createV1Seed(), "x-one");
    dnr.updateDynamicRules.mockRejectedValueOnce(new Error("rejected"));

    await writeState(doc);
    await settle();

    expect(dnr.updateDynamicRules).toHaveBeenCalledTimes(2);
    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(doc));
    expect(await getReconcileError()).toBe(false);
  });

  it("raises the health flag after a failed retry and clears it on convergence", async () => {
    start();
    const doc = withRule(createV1Seed(), "x-one");
    dnr.updateDynamicRules.mockRejectedValue(new Error("rejected"));

    await writeState(doc);
    await settle();

    expect(dnr.updateDynamicRules).toHaveBeenCalledTimes(2);
    expect(await getReconcileError()).toBe(true);

    dnr.updateDynamicRules.mockImplementation((options) =>
      dnr.fake.updateDynamicRules(options),
    );
    await fakeBrowser.runtime.onStartup.trigger();
    await settle();

    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(doc));
    expect(await getReconcileError()).toBe(false);
  });

  it("paints the amber can't-run badge from the health flag alone, then restores color on convergence", async () => {
    start();
    await fakeBrowser.permissions.request({ origins: ["*://*.example.com/*"] });
    const doc = withRule(createV1Seed(), "x-one");
    dnr.updateDynamicRules.mockRejectedValue(new Error("rejected"));
    const setBackground = vi.spyOn(browser.action, "setBadgeBackgroundColor");
    const setOptions = vi.spyOn(
      browser.declarativeNetRequest,
      "setExtensionActionOptions",
    );

    await writeState(doc);
    await settle();

    // Access is granted, so only the failed reconcile can turn the badge amber.
    expect(await getReconcileError()).toBe(true);
    expect(setBackground).toHaveBeenLastCalledWith({ color: "#B07B00" });
    expect(setOptions).toHaveBeenLastCalledWith({
      displayActionCountAsBadgeText: false,
    });
    expect(await browser.action.getBadgeText({})).toBe("");

    dnr.updateDynamicRules.mockImplementation((options) =>
      dnr.fake.updateDynamicRules(options),
    );
    await fakeBrowser.runtime.onStartup.trigger();
    await settle();

    expect(await getReconcileError()).toBe(false);
    expect(setBackground).toHaveBeenLastCalledWith({ color: "#4F5BC4" });
  });

  it("registers every listener before any init promise resolves", () => {
    vi.spyOn(fakeBrowser.storage.local, "get").mockImplementation(
      () => new Promise(() => {}),
    );
    vi.spyOn(fakeBrowser.storage.session, "get").mockImplementation(
      () => new Promise(() => {}),
    );

    start();
    void fakeBrowser.runtime.onInstalled.trigger({
      reason: "install",
      temporary: false,
    });

    for (const event of [
      fakeBrowser.runtime.onInstalled,
      fakeBrowser.runtime.onStartup,
      fakeBrowser.storage.local.onChanged,
      fakeBrowser.storage.session.onChanged,
      fakeBrowser.permissions.onAdded,
      fakeBrowser.permissions.onRemoved,
      fakeBrowser.tabs.onRemoved,
      fakeBrowser.tabs.onUpdated,
      fakeBrowser.commands.onCommand,
    ]) {
      expect(registered(event)).toBe(true);
    }
  });

  it("loses no writes when a command races a popup mutation", async () => {
    start();
    await writeState(createV1Seed());
    await settle();

    await Promise.all([
      triggerCommand("toggle-pause"),
      uiMutate(addRule("x-popup")),
    ]);
    await settle();

    const doc = await readState();
    expect(doc.settings.paused).toBe(true);
    expect(doc.profiles[0]?.rules.map((rule) => rule.header)).toEqual([
      "x-popup",
    ]);
  });

  it("loses no writes when popup and options mutate concurrently", async () => {
    start();
    await writeState(createV1Seed());
    await settle();

    await Promise.all([
      uiMutate(addRule("x-popup")),
      uiMutate(addRule("x-options")),
    ]);
    await settle();

    const headers = (await readState()).profiles[0]?.rules.map(
      (rule) => rule.header,
    );
    expect(headers).toHaveLength(2);
    expect(headers).toEqual(expect.arrayContaining(["x-popup", "x-options"]));
  });

  it("loses no writes when an import races a pause command", async () => {
    start();
    await writeState(createV1Seed());
    await settle();
    const imported = createProfile({
      name: "Imported",
      badgeText: "IM",
      color: "teal",
    });

    await Promise.all([
      uiMutate((doc) => ({ ...doc, profiles: [...doc.profiles, imported] })),
      triggerCommand("toggle-pause"),
    ]);
    await settle();

    const doc = await readState();
    expect(doc.settings.paused).toBe(true);
    expect(doc.profiles.map((profile) => profile.name)).toEqual([
      "Default",
      "Imported",
    ]);
  });

  it("quarantines a corrupt document, reseeds, and clears rule sets", async () => {
    start();
    const doc = withRule(createV1Seed(), "x-live");
    await writeState(doc);
    await settle();
    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(doc));
    const corrupt = { v: 1, profiles: "gone" };

    await fakeBrowser.storage.local.set({ state: corrupt });
    await settle();

    expect(await quarantinedValue()).toEqual(corrupt);
    const reseeded = await readState();
    expect(reseeded.profiles[0]).toMatchObject({ name: "Default", rules: [] });
    expect(await dnr.fake.getDynamicRules()).toEqual([]);
  });

  it("preserves a stored document when a profile name exceeds the UI limit", async () => {
    start();
    const doc = withRule(createV1Seed(), "x-live");
    const stored = {
      ...doc,
      profiles: doc.profiles.map((profile, index) =>
        index === 0 ? { ...profile, name: "x".repeat(49) } : profile,
      ),
    };

    await writeState(stored);
    await settle();

    expect(await storedValue("state")).toEqual(stored);
    expect(await quarantinedValue()).toBeUndefined();
    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(stored));
  });

  it("repairs a dangling active profile id without quarantining the document", async () => {
    start();
    const doc = withRule(createV1Seed(), "x-live");
    const stored = { ...doc, activeProfileId: "missing" };

    await writeState(stored);
    await settle();

    expect(await storedValue("state")).toEqual({
      ...stored,
      activeProfileId: undefined,
    });
    expect(await quarantinedValue()).toBeUndefined();
    expect(await dnr.fake.getDynamicRules()).toEqual([]);
  });

  it("refuses to write when the store is newer than this build", async () => {
    start();
    const stray: DnrRule = {
      id: 42,
      priority: 9,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "x-newer", operation: "remove" }],
      },
      condition: { resourceTypes: ["main_frame"] },
    };
    dnr.fake.dynamicRules = [stray];
    const newer = { v: 2, unknownShape: true };

    await fakeBrowser.storage.local.set({ state: newer });
    await settle();
    await fakeBrowser.runtime.onStartup.trigger();
    await settle();

    expect(dnr.updateDynamicRules).not.toHaveBeenCalled();
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
    expect(await dnr.fake.getDynamicRules()).toEqual([stray]);
    expect(await storedValue("state")).toEqual(newer);
    expect(await quarantinedValue()).toBeUndefined();
  });

  it("empties both rule sets on pause and restores them on resume", async () => {
    start();
    const doc = withRule(createV1Seed(), "x-live");
    const row = override(5, "app.example");
    const expectRuleSets = async (dynamic: DnrRule[], session: DnrRule[]) => {
      expect(await dnr.fake.getDynamicRules()).toEqual(dynamic);
      expect(await dnr.fake.getSessionRules()).toEqual(session);
    };
    await writeState(doc);
    await writeSession({ nextNum: 2, tabs: { 5: [row] } });
    await settle();
    await expectRuleSets(compileDynamic(doc), compileSession([row], false));

    await triggerCommand("toggle-pause");
    await settle();
    await expectRuleSets([], []);

    await triggerCommand("toggle-pause");
    await settle();
    await expectRuleSets(compileDynamic(doc), compileSession([row], false));
  });

  it("drops a tab's session rows when the tab closes", async () => {
    start();
    const kept = override(7, "kept.example");
    await writeSession({
      nextNum: 3,
      tabs: { 5: [override(5, "app.example")], 7: [kept] },
    });
    await settle();

    await fakeBrowser.tabs.onRemoved.trigger(5, {
      windowId: 1,
      isWindowClosing: false,
    });
    await settle();

    expect((await readSessionState()).tabs).toEqual({ 7: [kept] });
    expect(await dnr.fake.getSessionRules()).toEqual(
      compileSession([kept], false),
    );
  });

  it("ends overrides on cross-origin navigation but keeps them for same-origin updates", async () => {
    start();
    const row = override(5, "app.example");
    await writeSession({ nextNum: 2, tabs: { 5: [row] } });
    await settle();

    await fakeBrowser.tabs.onUpdated.trigger(
      5,
      { status: "complete" },
      tabInfo("https://app.example/spa/route"),
    );
    await settle();
    expect((await readSessionState()).tabs).toEqual({ 5: [row] });

    await fakeBrowser.tabs.onUpdated.trigger(
      5,
      { status: "loading" },
      tabInfo("https://other.example/"),
    );
    await settle();
    expect((await readSessionState()).tabs).toEqual({});
    expect(await dnr.fake.getSessionRules()).toEqual([]);
  });

  it("ends overrides when the tab's url is no longer visible", async () => {
    start();
    await writeSession({
      nextNum: 2,
      tabs: { 5: [override(5, "app.example")] },
    });
    await settle();

    await fakeBrowser.tabs.onUpdated.trigger(5, {}, tabInfo());
    await settle();

    expect((await readSessionState()).tabs).toEqual({});
  });

  it("restores the paused badge on startup", async () => {
    start();
    const doc = withRule(createV1Seed(), "x-live");
    await writeState({
      ...doc,
      settings: { ...doc.settings, paused: true },
    });
    await settle();
    const setBackground = vi.spyOn(browser.action, "setBadgeBackgroundColor");
    const setTitle = vi.spyOn(browser.action, "setTitle");
    const setOptions = vi.spyOn(
      browser.declarativeNetRequest,
      "setExtensionActionOptions",
    );

    await fakeBrowser.runtime.onStartup.trigger();
    await settle();

    expect(setOptions).toHaveBeenCalledWith({
      displayActionCountAsBadgeText: false,
    });
    expect(setBackground).toHaveBeenCalledWith({ color: "#6E7B88" });
    expect(setTitle).toHaveBeenCalledWith({ title: "HeaderShim: paused" });
    expect(await browser.action.getBadgeText({})).toBe("");
  });

  it("restores the needs-access badge on startup", async () => {
    start();
    await writeState(withRule(createV1Seed(), "x-live"));
    await settle();
    const setBackground = vi.spyOn(browser.action, "setBadgeBackgroundColor");

    await fakeBrowser.runtime.onStartup.trigger();
    await settle();

    expect(setBackground).toHaveBeenCalledWith({ color: "#B07B00" });
    expect(await browser.action.getBadgeText({})).toBe("");
  });

  it("switches to the next profile with one active id on command", async () => {
    start();
    const seed = createV1Seed();
    const staging = createProfile({
      name: "Staging",
      badgeText: "ST",
      color: "blue",
    });
    const qa = createProfile({
      name: "QA",
      badgeText: "QA",
      color: "teal",
    });
    await writeState({ ...seed, profiles: [...seed.profiles, staging, qa] });
    await settle();

    await triggerCommand("next-profile");
    let doc = await readState();
    expect(doc.activeProfileId).toBe(staging.id);
    expect(doc.profiles.every((profile) => !("enabled" in profile))).toBe(true);

    await triggerCommand("next-profile");
    await triggerCommand("next-profile");
    doc = await readState();
    expect(doc.activeProfileId).toBe(seed.activeProfileId);
    expect(doc.profiles.every((profile) => !("enabled" in profile))).toBe(true);
  });

  // The next-profile command writes state without the commit guard, so an
  // imported inactive profile can carry an enabled rule Chrome rejects (a bad
  // urlFilter, a CRLF value) that would sink the whole atomic batch when the
  // command enables it. The reconcile drops that one rule from the compiled set,
  // so the profile's other rules still apply and the ruleset never freezes.
  it("drops an invalid rule enabled by the next-profile command instead of freezing the batch", async () => {
    start();
    const seed = createV1Seed();
    const shell = createProfile({
      name: "Imported",
      badgeText: "IM",
      color: "plum",
    });
    const good: Rule = {
      id: "good",
      num: 8001,
      direction: "request",
      operation: "set",
      header: "x-good",
      value: "1",
      scope: { type: "domains", domains: ["example.com"] },
      resourceTypes: "all",
      initiators: [],
      enabled: true,
    };
    const bad: Rule = {
      ...good,
      id: "bad",
      num: 8002,
      header: "x-bad",
      scope: { type: "pattern", pattern: "||*", hosts: [] },
    };
    const imported = { ...shell, rules: [good, bad] };
    await writeState({
      ...seed,
      profiles: [...seed.profiles, imported],
      nextRuleNum: 8003,
    });
    await settle();

    await triggerCommand("next-profile");
    await settle();

    const doc = await readState();
    // The command activates the profile and preserves both rules on disk …
    expect(doc.activeProfileId).toBe(imported.id);
    expect(doc.profiles.at(-1)?.rules.map((rule) => rule.id)).toEqual([
      "good",
      "bad",
    ]);
    // … but only the compilable rule reaches Chrome, so the batch reconciles.
    expect((await dnr.fake.getDynamicRules()).map((rule) => rule.id)).toEqual([
      good.num,
    ]);
    expect(await getReconcileError()).toBe(false);
  });
});

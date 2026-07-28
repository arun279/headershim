import { fakeBrowser } from "@webext-core/fake-browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import background from "../../entrypoints/background";
import { compileDynamic, compileSession, type DnrRule } from "../core/compile";
import type { GrantSnapshot } from "../core/grants";
import { MAX_DYNAMIC_RULES } from "../core/limits";
import {
  createProfile,
  createRule,
  type Rule,
  type RuleDraft,
  type StateDoc,
  type TabOverride,
} from "../core/model";
import { createV1Seed } from "../core/schema";
import {
  getReconcileError,
  publishReconcileState,
  read as readSessionState,
  type SessionState,
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

// Every rule and This-tab row below is scoped under example.com, and grants are
// a compile input for both rule kinds, so the reconcile mechanics under test
// start from a granted host. The gate itself is the subject of its own cases,
// which revoke first.
const RULE_ORIGIN = "*://*.example.com/*";
const RULE_GRANT: GrantSnapshot = { origins: [RULE_ORIGIN], allSites: false };

beforeEach(async () => {
  dnr = installDnr();
  await fakeBrowser.permissions.request({ origins: [RULE_ORIGIN] });
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

// The session store as the popup leaves it: rows grouped under their own tab.
async function seedRows(...rows: TabOverride[]): Promise<TabOverride[]> {
  const tabs: SessionState["tabs"] = {};
  const numberedRows = rows.map((row, index) => ({
    ...row,
    num: index + 1,
  }));
  numberedRows.forEach((numbered) => {
    tabs[numbered.tabId] = [...(tabs[numbered.tabId] ?? []), numbered];
  });
  await writeSession({ nextNum: numberedRows.length + 1, tabs });
  return numberedRows;
}

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
  it("seeds the Default profile on worker wake without touching rule sets", async () => {
    start();
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

  it("marks the rules unverified before changing a rule band", async () => {
    const doc = withRule(createV1Seed(), "x-one");
    dnr.updateDynamicRules.mockImplementation(async (options) => {
      expect(await getReconcileError()).toBe(true);
      await dnr.fake.updateDynamicRules(options);
    });

    await writeState(doc);
    start();
    await settle();

    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(doc));
    expect(await getReconcileError()).toBe(false);
  });

  it("makes no DNR writes when already converged", async () => {
    const doc = withRule(createV1Seed(), "x-one");
    await writeState(doc);
    dnr.fake.dynamicRules = compileDynamic(doc);
    dnr.updateDynamicRules.mockClear();
    dnr.updateSessionRules.mockClear();

    start();
    await settle();

    expect(dnr.getDynamicRules).toHaveBeenCalledOnce();
    expect(dnr.getSessionRules).toHaveBeenCalledOnce();
    expect(dnr.updateDynamicRules).not.toHaveBeenCalled();
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
  });

  it("does not rewrite converged session metadata", async () => {
    const doc = withRule(createV1Seed(), "x-one");
    await writeState(doc);
    const sessionWrites = vi.spyOn(fakeBrowser.storage.session, "set");

    start();
    await settle();
    sessionWrites.mockClear();
    await fakeBrowser.runtime.onStartup.trigger();
    await settle();

    expect(sessionWrites).not.toHaveBeenCalled();
  });

  it("retries when the post-update readback has not converged", async () => {
    const doc = withRule(createV1Seed(), "x-one");
    await writeState(doc);
    dnr.getDynamicRules.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    start();

    await vi.waitFor(() => {
      expect(dnr.getDynamicRules).toHaveBeenCalledTimes(3);
    });
    expect(dnr.updateDynamicRules).toHaveBeenCalledOnce();
    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(doc));
    expect(await getReconcileError()).toBe(false);
  });

  it("retries a transient post-update readback", async () => {
    const doc = withRule(createV1Seed(), "x-one");
    await writeState(doc);
    dnr.getDynamicRules
      .mockImplementationOnce(() => dnr.fake.getDynamicRules())
      .mockRejectedValueOnce(new Error("transient readback"));

    start();

    await vi.waitFor(() => {
      expect(dnr.getDynamicRules).toHaveBeenCalledTimes(3);
    });
    expect(dnr.getDynamicRules).toHaveBeenCalledTimes(3);
    expect(await getReconcileError()).toBe(false);
  });

  it("retries a transient readback before planning an update", async () => {
    const doc = withRule(createV1Seed(), "x-one");
    await writeState(doc);
    dnr.getDynamicRules.mockRejectedValueOnce(
      new Error("transient initial readback"),
    );

    start();

    await vi.waitFor(async () => {
      expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(doc));
    });
    expect(dnr.updateDynamicRules).toHaveBeenCalledOnce();
    expect(await getReconcileError()).toBe(false);
  });

  it("does not report a transient read of converged rules as unhealthy", async () => {
    const doc = withRule(createV1Seed(), "x-one");
    await writeState(doc);
    dnr.fake.dynamicRules = compileDynamic(doc);
    dnr.getDynamicRules.mockRejectedValueOnce(new Error("transient readback"));
    const sessionWrites = vi.spyOn(fakeBrowser.storage.session, "set");

    start();
    await vi.waitFor(() => {
      expect(dnr.getDynamicRules).toHaveBeenCalledTimes(2);
    });

    expect(
      sessionWrites.mock.calls.some(
        ([value]) => Reflect.get(value, "reconcileError") === true,
      ),
    ).toBe(false);
  });

  it("reports exhausted readback retries", async () => {
    const doc = withRule(createV1Seed(), "x-one");
    await writeState(doc);
    start();
    await settle();
    dnr.getDynamicRules.mockClear();
    dnr.getDynamicRules.mockRejectedValue(new Error("readback failed"));

    await fakeBrowser.runtime.onStartup.trigger();

    await vi.waitFor(
      async () => {
        expect(await getReconcileError()).toBe(true);
      },
      { timeout: 2_000 },
    );
    expect(dnr.getDynamicRules).toHaveBeenCalledTimes(9);
  });

  it("self-heals drifted rule sets on profile startup", async () => {
    const doc = withRule(createV1Seed(), "x-one");
    await writeState(doc);
    start();
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

    await fakeBrowser.runtime.onStartup.trigger();
    await settle();

    expect(dnr.updateDynamicRules).toHaveBeenCalledExactlyOnceWith({
      removeRuleIds: [99],
      addRules: compileDynamic(doc),
    });
    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(doc));
  });

  // Invoking the action hands the extension activeTab, which is host access for
  // that tab, and the engine applies whatever is installed to a host it has
  // access to. So an ungranted rule is only harmless while it is absent, and the
  // grant is what puts it in.
  it("installs a rule only once its host is granted, and takes it back out on revoke", async () => {
    await fakeBrowser.permissions.remove({ origins: [RULE_ORIGIN] });
    start();
    const doc = withRule(createV1Seed(), "x-one");
    await writeState(doc);
    await settle();

    expect(await dnr.fake.getDynamicRules()).toEqual([]);

    await fakeBrowser.permissions.request({ origins: [RULE_ORIGIN] });
    await settle();

    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(doc));

    await fakeBrowser.permissions.remove({ origins: [RULE_ORIGIN] });
    await settle();

    expect(await dnr.fake.getDynamicRules()).toEqual([]);
  });

  // The same statement for This-tab rows, which activeTab reaches just as
  // readily: the row is a compile input, so the grant is what puts its rule in
  // and a revoke is what takes it out.
  it("installs a session rule only once its host is granted", async () => {
    await fakeBrowser.permissions.remove({ origins: [RULE_ORIGIN] });
    start();
    const row = override(5, "app.example.com");
    await seedRows(row);
    await settle();

    expect(await dnr.fake.getSessionRules()).toEqual([]);

    await fakeBrowser.permissions.request({ origins: [RULE_ORIGIN] });
    await settle();

    expect(await dnr.fake.getSessionRules()).toEqual(
      compileSession([row], false, RULE_GRANT),
    );

    await fakeBrowser.permissions.remove({ origins: [RULE_ORIGIN] });
    await settle();

    expect(await dnr.fake.getSessionRules()).toEqual([]);
  });

  it("removes a session rule for a grant revoked while the worker was down", async () => {
    // Nothing is listening for the revoke, so no prune runs: the wake has to
    // re-derive the session band from the grants it reads now and remove the
    // stale installed rule without waiting for another browser event.
    const row = override(5, "app.example.com");
    await seedRows(row);
    dnr.fake.sessionRules = compileSession([row], false, RULE_GRANT);
    await fakeBrowser.permissions.remove({ origins: [RULE_ORIGIN] });

    start();
    await settle();

    expect(await dnr.fake.getSessionRules()).toEqual([]);
  });

  it("keeps a revoked tab row stored while taking its session rule out", async () => {
    const row = override(5, "app.example.com");
    start();
    await seedRows(row);
    await settle();
    expect(await dnr.fake.getSessionRules()).toHaveLength(1);

    await fakeBrowser.permissions.remove({ origins: [RULE_ORIGIN] });
    await settle();

    expect((await readSessionState()).tabs[5]).toEqual([row]);
    expect(await dnr.fake.getSessionRules()).toEqual([]);
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
    vi.spyOn(browser.action, "setBadgeText").mockImplementationOnce(
      async () => {
        await writeState(docB);
      },
    );

    await writeState(docA);
    await settle();

    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(docB));
  });

  it("retries a rejected update from a fresh read", async () => {
    start();
    await settle();
    const sessionWrites = vi.spyOn(fakeBrowser.storage.session, "set");
    const doc = withRule(createV1Seed(), "x-one");
    dnr.updateDynamicRules.mockRejectedValueOnce(new Error("rejected"));

    await writeState(doc);
    await settle();

    expect(dnr.updateDynamicRules).toHaveBeenCalledTimes(2);
    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(doc));
    expect(await getReconcileError()).toBe(false);
    expect(sessionWrites.mock.calls[0]?.[0]).toEqual({
      reconcileError: true,
    });
  });

  it("raises the health flag after bounded retries and clears it on convergence", async () => {
    start();
    await settle();
    const doc = withRule(createV1Seed(), "x-one");
    dnr.updateDynamicRules.mockRejectedValue(new Error("rejected"));

    await writeState(doc);
    await settle();

    expect(dnr.updateDynamicRules).toHaveBeenCalledTimes(3);
    expect(await getReconcileError()).toBe(true);

    dnr.updateDynamicRules.mockImplementation((options) =>
      dnr.fake.updateDynamicRules(options),
    );
    await fakeBrowser.permissions.request({
      origins: ["*://*.retry-trigger.test/*"],
    });
    await settle();

    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(doc));
    expect(await getReconcileError()).toBe(false);
  });

  it("keeps the admissible rules and reports overflow without escaping the pass", async () => {
    const seed = createV1Seed();
    const active = seed.profiles[0];
    if (active === undefined) {
      throw new Error("seed must contain an active profile");
    }
    const overflow: StateDoc = {
      ...seed,
      nextRuleNum: MAX_DYNAMIC_RULES + 2,
      profiles: [
        {
          ...active,
          rules: Array.from({ length: MAX_DYNAMIC_RULES + 1 }, (_, index) => ({
            ...baseDraft,
            id: `overflow-${index}`,
            num: index + 1,
          })),
        },
      ],
    };
    const installed: DnrRule = {
      id: 90_001,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "x-existing", operation: "remove" }],
      },
      condition: { resourceTypes: ["main_frame"] },
    };
    dnr.fake.dynamicRules = [installed];

    await writeState(overflow);
    const sessionWrites = vi.spyOn(fakeBrowser.storage.session, "set");
    start();
    await settle();

    const expected = compileDynamic(overflow);
    expect(await dnr.fake.getDynamicRules()).toEqual(expected);
    expect(dnr.updateDynamicRules).toHaveBeenCalledExactlyOnceWith({
      removeRuleIds: [installed.id],
      addRules: expected,
    });
    expect(await getReconcileError()).toBe(true);
    expect(
      sessionWrites.mock.calls.map(([value]) => Object.keys(value)),
    ).toEqual([["reconcileError"]]);
  });

  it("removes a revoked session rule after two rejected removals", async () => {
    start();
    await seedRows(override(5, "app.example.com"));
    await settle();
    expect(await dnr.fake.getSessionRules()).toHaveLength(1);
    dnr.updateSessionRules.mockClear();

    dnr.updateSessionRules.mockRejectedValueOnce(
      new Error("first removal rejected"),
    );
    dnr.updateSessionRules.mockRejectedValueOnce(
      new Error("second removal rejected"),
    );

    await fakeBrowser.permissions.remove({ origins: [RULE_ORIGIN] });
    await settle();

    expect(dnr.updateSessionRules).toHaveBeenCalledTimes(3);
    expect(await dnr.fake.getSessionRules()).toEqual([]);
    expect(await getReconcileError()).toBe(false);
  });

  it("registers every listener before any init promise resolves", () => {
    vi.spyOn(fakeBrowser.storage.local, "get").mockImplementation(
      () => new Promise(() => {}),
    );
    vi.spyOn(fakeBrowser.storage.session, "get").mockImplementation(
      () => new Promise(() => {}),
    );

    start();

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

  it("preserves a stored document with a long profile name", async () => {
    start();
    const doc = withRule(createV1Seed(), "x-live");
    const stored = {
      ...doc,
      profiles: doc.profiles.map((profile, index) =>
        index === 0 ? { ...profile, name: "x".repeat(200) } : profile,
      ),
    };

    await writeState(stored);
    await settle();

    expect(await storedValue("state")).toEqual(stored);
    expect(await quarantinedValue()).toBeUndefined();
    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(stored));
  });

  it("repairs a dangling active profile id to the first profile without quarantining", async () => {
    start();
    const doc = withRule(createV1Seed(), "x-live");
    const stored = { ...doc, activeProfileId: "missing" };
    const repaired = { ...stored, activeProfileId: doc.activeProfileId };

    await writeState(stored);
    await settle();

    expect(await storedValue("state")).toEqual(repaired);
    expect(await quarantinedValue()).toBeUndefined();
    expect(await dnr.fake.getDynamicRules()).toEqual(compileDynamic(repaired));
  });

  it("refuses to write when the store is newer than this build", async () => {
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
    await publishReconcileState(false);
    start();
    await settle();

    expect(dnr.updateDynamicRules).not.toHaveBeenCalled();
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
    expect(await dnr.fake.getDynamicRules()).toEqual([stray]);
    expect(await storedValue("state")).toEqual(newer);
    expect(await quarantinedValue()).toBeUndefined();
    expect(await getReconcileError()).toBe(true);
  });

  it("reports an unreadable newer store as unhealthy", async () => {
    await fakeBrowser.storage.local.set({
      state: { v: 2, unknownShape: true },
    });

    start();
    await settle();

    expect(dnr.updateDynamicRules).not.toHaveBeenCalled();
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
    expect(await getReconcileError()).toBe(true);
  });

  it("empties both rule sets on pause and restores them on resume", async () => {
    start();
    const doc = withRule(createV1Seed(), "x-live");
    const row = override(5, "app.example.com");
    const expectRuleSets = async (dynamic: DnrRule[], session: DnrRule[]) => {
      expect(await dnr.fake.getDynamicRules()).toEqual(dynamic);
      expect(await dnr.fake.getSessionRules()).toEqual(session);
    };
    await writeState(doc);
    await seedRows(row);
    await settle();
    await expectRuleSets(
      compileDynamic(doc),
      compileSession([row], false, RULE_GRANT),
    );

    await triggerCommand("toggle-pause");
    await settle();
    await expectRuleSets([], []);

    await triggerCommand("toggle-pause");
    await settle();
    await expectRuleSets(
      compileDynamic(doc),
      compileSession([row], false, RULE_GRANT),
    );
  });

  it("drops a tab's session rows when the tab closes", async () => {
    start();
    const [, kept] = await seedRows(
      override(5, "app.example.com"),
      override(7, "kept.example.com"),
    );
    if (kept === undefined) throw new Error("missing kept row");
    await settle();

    await fakeBrowser.tabs.onRemoved.trigger(5, {
      windowId: 1,
      isWindowClosing: false,
    });
    await settle();

    expect((await readSessionState()).tabs).toEqual({ 7: [kept] });
    expect(await dnr.fake.getSessionRules()).toEqual(
      compileSession([kept], false, RULE_GRANT),
    );
  });

  it("ends overrides on cross-origin navigation but keeps them for same-origin updates", async () => {
    start();
    const row = override(5, "app.example.com");
    await seedRows(row);
    await settle();

    await fakeBrowser.tabs.onUpdated.trigger(
      5,
      { status: "complete" },
      tabInfo("https://app.example.com/spa/route"),
    );
    await settle();
    expect((await readSessionState()).tabs).toEqual({ 5: [row] });

    await fakeBrowser.tabs.onUpdated.trigger(
      5,
      { status: "loading" },
      tabInfo("https://other.example.com/"),
    );
    await settle();
    expect((await readSessionState()).tabs).toEqual({});
    expect(await dnr.fake.getSessionRules()).toEqual([]);
  });

  it("ends overrides when the tab's url is no longer visible", async () => {
    start();
    await seedRows(override(5, "app.example.com"));
    await settle();

    await fakeBrowser.tabs.onUpdated.trigger(5, {}, tabInfo());
    await settle();

    expect((await readSessionState()).tabs).toEqual({});
  });

  it("restores the paused badge on worker wake", async () => {
    const doc = withRule(createV1Seed(), "x-live");
    await writeState({
      ...doc,
      settings: { ...doc.settings, paused: true },
    });
    const setBackground = vi.spyOn(browser.action, "setBadgeBackgroundColor");
    const setTitle = vi.spyOn(browser.action, "setTitle");

    start();
    await settle();

    expect(setBackground).toHaveBeenCalledWith({ color: "#6E7B88" });
    expect(setTitle).toHaveBeenCalledWith({ title: "HeaderShim: paused" });
    expect(await browser.action.getBadgeText({})).toBe("II");
  });

  it("paints the active profile badge on worker wake regardless of grant state", async () => {
    await fakeBrowser.permissions.remove({ origins: [RULE_ORIGIN] });
    await writeState(withRule(createV1Seed(), "x-live"));
    const setBackground = vi.spyOn(browser.action, "setBadgeBackgroundColor");

    start();
    await settle();

    // The seed's Default profile paints its own badge even though the rule's
    // host is ungranted; the toolbar never carries a needs-access glyph.
    expect(setBackground).toHaveBeenCalledWith({ color: "#4F5BC4" });
    expect(await browser.action.getBadgeText({})).toBe("DE");
  });

  it("flips between the two most recent profiles on command", async () => {
    start();
    const seed = createV1Seed();
    const staging = createProfile({
      name: "Staging",
      badgeText: "ST",
      color: "blue",
    });
    // Staging is active with the seed profile the one it was reached from, the
    // pair a switcher click would have established.
    await writeState({
      ...seed,
      profiles: [...seed.profiles, staging],
      activeProfileId: staging.id,
      previousProfileId: seed.activeProfileId,
    });
    await settle();

    await triggerCommand("previous-profile");
    let doc = await readState();
    expect(doc.activeProfileId).toBe(seed.activeProfileId);
    expect(doc.previousProfileId).toBe(staging.id);
    expect(doc.profiles.every((profile) => !("enabled" in profile))).toBe(true);

    // A second press toggles back rather than walking to a third profile.
    await triggerCommand("previous-profile");
    doc = await readState();
    expect(doc.activeProfileId).toBe(staging.id);
    expect(doc.previousProfileId).toBe(seed.activeProfileId);
  });

  // The profile command writes state without the commit guard, so an imported
  // inactive profile can carry an enabled rule Chrome rejects (a bad urlFilter,
  // a CRLF value) that would sink the whole atomic batch when the command
  // enables it. The reconcile drops that one rule from the compiled set, so the
  // profile's other rules still apply and the ruleset never freezes.
  it("drops an invalid rule enabled by the profile command instead of freezing the batch", async () => {
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
    // The command flips to the imported profile as the pair's other half.
    await writeState({
      ...seed,
      profiles: [...seed.profiles, imported],
      previousProfileId: imported.id,
      nextRuleNum: 8003,
    });
    await settle();

    await triggerCommand("previous-profile");
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

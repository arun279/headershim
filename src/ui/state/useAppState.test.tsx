// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { describe, expect, it, vi } from "vitest";
import type { Profile, Rule, StateDoc } from "../../core/model";
import {
  setReconcileError,
  write as writeSession,
} from "../../platform/session-store";
import { write } from "../../platform/store";
import { render, settle } from "../test/render";
import { useAppState } from "./useAppState";

// fake-browser does not model tab focus, so pin the popup's tab directly.
vi.mock("../../platform/tabs", () => ({
  activeTabId: () => Promise.resolve(7),
}));

function Probe() {
  const app = useAppState();
  return (
    <output data-phase={app.phase}>
      {app.phase === "ready"
        ? `${app.status.kind}:${app.overrides.length}`
        : app.phase === "newer-store"
          ? String(app.foundVersion)
          : ""}
    </output>
  );
}

function probe(root: HTMLElement) {
  const output = root.querySelector("output") as HTMLElement;
  return {
    phase: () => output.getAttribute("data-phase"),
    text: () => output.textContent,
  };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    num: 1,
    direction: "request",
    operation: "set",
    header: "x-test",
    value: "1",
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...overrides,
  };
}

function doc(profileOverrides: Partial<Profile> = {}): StateDoc {
  return {
    v: 1,
    profiles: [
      {
        id: "p1",
        name: "Default",
        badgeText: "DE",
        color: "indigo",
        enabled: true,
        rules: [],
        ...profileOverrides,
      },
    ],
    focusedProfileId: "p1",
    nextRuleNum: 10,
    settings: { paused: false, theme: "system", badgeMode: "count" },
  };
}

describe("useAppState", () => {
  it("stays initializing on an empty store and becomes ready on the seed write", async () => {
    const view = probe(render(<Probe />));
    await settle();
    expect(view.phase()).toBe("initializing");

    await write(doc());
    await settle();
    expect(view.phase()).toBe("ready");
    expect(view.text()).toBe("live:0");
  });

  it("refuses a newer store with its version", async () => {
    await fakeBrowser.storage.local.set({ state: { v: 9 } });
    const view = probe(render(<Probe />));
    await settle();
    expect(view.phase()).toBe("newer-store");
    expect(view.text()).toBe("9");
  });

  it("treats a corrupt store as still initializing", async () => {
    await fakeBrowser.storage.local.set({ state: { v: 1, profiles: [] } });
    const view = probe(render(<Probe />));
    await settle();
    expect(view.phase()).toBe("initializing");
  });

  it("surfaces the reconcile health flag as out-of-sync when it changes", async () => {
    await write(doc());
    const view = probe(render(<Probe />));
    await settle();
    expect(view.text()).toBe("live:0");

    await setReconcileError(true);
    await settle();
    expect(view.text()).toBe("out-of-sync:0");

    await setReconcileError(false);
    await settle();
    expect(view.text()).toBe("live:0");
  });

  it("computes needs-access from the live grant snapshot", async () => {
    await write(doc({ rules: [rule()] }));
    const view = probe(render(<Probe />));
    await settle();
    expect(view.text()).toBe("needs-access:0");

    await fakeBrowser.permissions.request({
      origins: ["*://*.example.com/*"],
    });
    await settle();
    expect(view.text()).toBe("live:0");
  });

  it("counts this-tab overrides for the active tab only", async () => {
    await write(doc());
    const row = {
      num: 1,
      tabId: 7,
      originHost: "example.com",
      direction: "request",
      operation: "set",
      header: "x-debug",
      value: "1",
      enabled: true,
    } as const;
    await writeSession({
      nextNum: 3,
      tabs: { 7: [row], 9: [{ ...row, num: 2, tabId: 9 }] },
    });

    const view = probe(render(<Probe />));
    await settle();
    expect(view.text()).toBe("live:1");
  });
});

// @vitest-environment happy-dom

import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { compile } from "../../core/compile";
import type { Profile, StateDoc, TabOverride } from "../../core/model";
import { revisionOf } from "../../core/revision";
import {
  clearAppliedRevision,
  setAppliedRevision,
  write as writeSession,
} from "../../platform/session-store";
import { write } from "../../platform/store";
import { atPaint, render, settle } from "../test/render";
import { BOOT_GRACE_MS, useAppState } from "./useAppState";

vi.mock("../../platform/tabs", () => ({
  activeTabId: () => Promise.resolve(7),
}));

function Probe() {
  const app = useAppState();
  return (
    <output data-phase={app.phase}>
      {app.phase === "ready"
        ? `${app.live.confirmation}:${app.overrides.length}:${Object.keys(app.session.tabs).length}`
        : app.phase === "newer-store"
          ? String(app.foundVersion)
          : ""}
    </output>
  );
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
        rules: [],
        ...profileOverrides,
      },
    ],
    activeProfileId: "p1",
    nextRuleNum: 10,
    settings: { paused: false, theme: "system" },
  };
}

function override(num: number, tabId: number): TabOverride {
  return {
    num,
    tabId,
    origin: "https://example.com",
    direction: "request",
    operation: "set",
    header: "x-debug",
    value: String(num),
    enabled: true,
  };
}

async function publish(
  state: StateDoc,
  overrides: readonly TabOverride[] = [],
): Promise<void> {
  const batch = compile({
    doc: state,
    overrides,
    granted: {
      origins: ["*://*.example.com/*"],
      allSites: false,
    },
    isRegexSupported: () => true,
  });
  await setAppliedRevision(await revisionOf(batch.dynamic, batch.session));
}

function output(root: HTMLElement): HTMLOutputElement {
  const element = root.querySelector("output");
  if (!(element instanceof HTMLOutputElement)) {
    throw new Error("missing output");
  }
  return element;
}

afterEach(() => {
  vi.useRealTimers();
});

async function reachUnavailable(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(BOOT_GRACE_MS);
  });
}

describe("useAppState", () => {
  it("stays initializing until a valid document arrives", async () => {
    const root = render(<Probe />);
    await settle();
    expect(output(root).getAttribute("data-phase")).toBe("initializing");

    const state = doc();
    await publish(state);
    await write(state);
    await settle();
    expect(output(root).textContent).toBe("applied:0:0");
  });

  it("reports unavailable when a boot loader rejects", async () => {
    vi.spyOn(fakeBrowser.storage.local, "get").mockRejectedValueOnce(
      new Error("unavailable"),
    );
    const root = render(<Probe />);
    await settle();

    expect(output(root).getAttribute("data-phase")).toBe("unavailable");
  });

  it("keeps a rejected boot loader unavailable after a document reload", async () => {
    vi.spyOn(fakeBrowser.permissions, "getAll").mockRejectedValueOnce(
      new Error("unavailable"),
    );
    const root = render(<Probe />);
    await settle();
    expect(output(root).getAttribute("data-phase")).toBe("unavailable");

    const state = doc();
    await publish(state);
    await write(state);
    await settle();

    expect(output(root).getAttribute("data-phase")).toBe("unavailable");
  });

  it("reports unavailable when the document does not arrive in time", async () => {
    vi.useFakeTimers();
    const root = render(<Probe />);
    await reachUnavailable();

    expect(output(root).getAttribute("data-phase")).toBe("unavailable");
  });

  it("becomes ready when a document arrives after the grace period", async () => {
    vi.useFakeTimers();
    const root = render(<Probe />);
    await reachUnavailable();
    expect(output(root).getAttribute("data-phase")).toBe("unavailable");
    const state = doc();
    await publish(state);
    await write(state);
    await act(async () => {
      await Promise.resolve();
    });

    expect(output(root).getAttribute("data-phase")).toBe("ready");
  });

  it("reports a newer stored version", async () => {
    await fakeBrowser.storage.local.set({ state: { v: 9 } });
    const root = render(<Probe />);
    await settle();
    expect(output(root).textContent).toBe("9");
  });

  it("checks regex support for profile-switch targets", async () => {
    const regex = "^https://preview\\.example\\.com/";
    const state = doc();
    state.profiles.push({
      id: "p2",
      name: "Preview",
      badgeText: "PR",
      color: "blue",
      rules: [
        {
          id: "target-regex",
          num: 1,
          direction: "request",
          operation: "set",
          header: "x-preview",
          value: "on",
          scope: { type: "regex", regex, hosts: ["preview.example.com"] },
          resourceTypes: "all",
          initiators: [],
          enabled: true,
        },
      ],
    });
    const support = vi.fn(async () => ({ isSupported: true }));
    Object.assign(fakeBrowser.declarativeNetRequest, {
      isRegexSupported: support,
    });
    await publish(state);
    await write(state);

    const root = render(<Probe />);
    await settle();

    expect(output(root).textContent).toBe("applied:0:0");
    expect(support).toHaveBeenCalledExactlyOnceWith({ regex });
  });

  it("keeps a mismatched batch unprojectable", async () => {
    const state = doc();
    await setAppliedRevision({ dynamic: "different", session: "different" });
    await write(state);
    const root = render(<Probe />);
    await settle();
    expect(output(root).textContent).toBe("pending:0:0");
  });

  it("keeps a changed batch pending on its first projection", async () => {
    const state = doc();
    await fakeBrowser.permissions.request({
      origins: ["*://*.example.com/*"],
    });
    await publish(state);
    await write(state);
    const root = render(<Probe />);
    await settle();
    expect(output(root).textContent).toBe("applied:0:0");

    const firstProjection = atPaint(
      () => output(root).textContent?.endsWith(":1:1") === true,
      () => output(root).textContent,
    );
    await writeSession({
      nextNum: 2,
      tabs: { 7: [override(1, 7)] },
    });

    expect(await firstProjection).toBe("pending:1:1");
  });

  it("ignores an older applied-revision read that resolves last", async () => {
    const state = doc();
    await publish(state);
    await write(state);
    const stale = await fakeBrowser.storage.session.get("appliedRules");
    const readSession = fakeBrowser.storage.session.get.bind(
      fakeBrowser.storage.session,
    );
    let release: ((value: Awaited<typeof stale>) => void) | undefined;
    const delayed = new Promise<Awaited<typeof stale>>((resolve) => {
      release = resolve;
    });
    const get = vi.spyOn(fakeBrowser.storage.session, "get");
    get
      .mockImplementationOnce(readSession)
      .mockImplementationOnce(() => delayed);

    const root = render(<Probe />);
    await Promise.resolve();
    await clearAppliedRevision();
    release?.(stale);
    await settle();

    expect(output(root).textContent).toBe("pending:0:0");
    get.mockRestore();
  });

  it("compiles every tab's overrides while exposing only the active tab's", async () => {
    const state = doc();
    const row7 = override(1, 7);
    const row9 = override(2, 9);
    const rows = [row7, row9];
    await fakeBrowser.permissions.request({
      origins: ["*://*.example.com/*"],
    });
    await writeSession({
      nextNum: 3,
      tabs: { 7: [row7], 9: [row9] },
    });
    await publish(state, rows);
    await write(state);

    const root = render(<Probe />);
    await settle();
    expect(output(root).textContent).toBe("applied:1:2");
  });

  it("stays applied when an edit does not change emitted rules", async () => {
    const state = doc();
    await publish(state);
    await write(state);
    const root = render(<Probe />);
    await settle();

    await write(doc({ name: "Renamed" }));
    await settle();
    expect(output(root).textContent).toBe("applied:0:0");
  });
});

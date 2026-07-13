import { fakeBrowser } from "@webext-core/fake-browser";
import { vi } from "vitest";
import type { TabOverride } from "../core/model";
import type { UpdateRulesOptions } from "../platform/dnr";
import { FakeDnr } from "../platform/dnr.fake";

/**
 * Shared integration-test scaffolding: an in-memory DNR double wired onto the
 * fake browser with spied handlers, a macrotask flush, a tab-update payload
 * builder, and a `TabOverride` factory. Kept in one place so the lifecycle and
 * This-tab suites drive the background through the same seams.
 */
export function installDnr() {
  const fake = new FakeDnr();
  const handlers = {
    getDynamicRules: vi.fn(() => fake.getDynamicRules()),
    updateDynamicRules: vi.fn((options: UpdateRulesOptions) =>
      fake.updateDynamicRules(options),
    ),
    getSessionRules: vi.fn(() => fake.getSessionRules()),
    updateSessionRules: vi.fn((options: UpdateRulesOptions) =>
      fake.updateSessionRules(options),
    ),
  };
  Object.assign(fakeBrowser.declarativeNetRequest, handlers);
  return { fake, ...handlers };
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

type FakeTab = Parameters<typeof fakeBrowser.tabs.onUpdated.trigger>[2];

export function tabInfo(id: number, url?: string): FakeTab {
  return {
    id,
    index: 0,
    windowId: 1,
    highlighted: true,
    active: true,
    pinned: false,
    incognito: false,
    discarded: false,
    autoDiscardable: true,
    ...(url === undefined ? {} : { url }),
  };
}

export function tabOverride(overrides: Partial<TabOverride> = {}): TabOverride {
  return {
    num: 1,
    tabId: 5,
    originHost: "app.example.com",
    direction: "request",
    operation: "set",
    header: "x-tab",
    value: "on",
    ...overrides,
  };
}

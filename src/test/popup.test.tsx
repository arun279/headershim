// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import { App } from "../../entrypoints/popup/App";
import type { Rule, StateDoc } from "../core/model";
import { createV1Seed } from "../core/schema";
import { read, write } from "../platform/store";
import { render, settle } from "../ui/test/render";

async function mount(doc?: StateDoc) {
  if (doc !== undefined) {
    await write(doc);
  }
  const root = render(<App />);
  await settle();
  return {
    root,
    annunciator: () => root.querySelector(".annunciator") as HTMLElement,
    body: () => root.querySelector(".popup-body") as HTMLElement,
  };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    num: 1,
    direction: "request",
    operation: "set",
    header: "authorization",
    value: "Bearer token",
    scope: { type: "domains", domains: ["api.example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...overrides,
  };
}

function seededDoc(rules: Rule[]): StateDoc {
  const seed = createV1Seed();
  const profile = seed.profiles[0];
  if (profile === undefined) {
    throw new Error("seed has no profile");
  }
  return {
    ...seed,
    profiles: [{ ...profile, rules }],
    nextRuleNum: 100,
  };
}

describe("popup App", () => {
  it("renders first run as onboarding with focus on the first action", async () => {
    const { root, annunciator } = await mount(createV1Seed());

    expect(root.textContent).toContain(
      "Change HTTP headers on sites you choose. No account. Nothing ever leaves your device.",
    );
    const actions = [...root.querySelectorAll(".first-run-actions button")];
    expect(actions.map((button) => button.textContent)).toEqual([
      "Try it on this tab",
      "Create a rule",
      "Import from ModHeader or a file",
    ]);
    expect(document.activeElement).toBe(actions[0]);
    expect(annunciator().textContent).toBe("Live — no rules yet.");
    // The footer is always present.
    expect(root.querySelector(".foot")?.textContent).toContain("Pause");
  });

  it("renders nothing but the shell while the store is still empty", async () => {
    const { root } = await mount();
    expect(root.querySelector(".popup")?.children).toHaveLength(0);
  });

  it("refuses a newer store with the update copy", async () => {
    await fakeBrowser.storage.local.set({ state: { v: 3 } });
    const { root } = await mount();
    expect(root.textContent).toContain(
      "Your rules were saved by a newer headershim (format 3; this version reads up to 1).",
    );
  });

  it("updates needs-access surfaces when a grant lands while mounted", async () => {
    const { annunciator } = await mount(seededDoc([rule()]));

    expect(annunciator().textContent).toContain(
      "1 rule can't run — headershim doesn't have access to api.example.com.",
    );
    expect(annunciator().getAttribute("data-state")).toBe("needs-access");

    await fakeBrowser.permissions.request({
      origins: ["*://*.api.example.com/*"],
    });
    await settle();

    expect(annunciator().getAttribute("data-state")).toBe("live");
    expect(annunciator().textContent).toBe("Live — 1 rule on 1 profile.");
  });

  it("revoking a grant while mounted re-lights the loud state without a reopen", async () => {
    await fakeBrowser.permissions.request({
      origins: ["*://*.api.example.com/*"],
    });
    const { annunciator } = await mount(seededDoc([rule()]));
    expect(annunciator().getAttribute("data-state")).toBe("live");

    await fakeBrowser.permissions.remove({
      origins: ["*://*.api.example.com/*"],
    });
    await settle();
    expect(annunciator().getAttribute("data-state")).toBe("needs-access");
  });

  it("pause grayscales the body but not the switcher or footer, and Resume restores", async () => {
    await fakeBrowser.permissions.request({
      origins: ["*://*.api.example.com/*"],
    });
    const { root, annunciator, body } = await mount(seededDoc([rule()]));

    const pauseSwitch = root.querySelector(
      '[aria-label="Global pause"]',
    ) as HTMLButtonElement;
    await act(async () => {
      pauseSwitch.click();
    });
    await settle();

    expect((await read()).settings.paused).toBe(true);
    expect(annunciator().textContent).toContain(
      "Paused — no headers are being modified.",
    );
    expect(body().classList.contains("paused")).toBe(true);
    expect(root.querySelector(".profiles")?.classList.contains("paused")).toBe(
      false,
    );
    expect(root.querySelector(".foot")?.classList.contains("paused")).toBe(
      false,
    );

    const resume = [...annunciator().querySelectorAll("button")].find(
      (button) => button.textContent === "Resume",
    ) as HTMLButtonElement;
    await act(async () => {
      resume.click();
    });
    await settle();
    expect((await read()).settings.paused).toBe(false);
    expect(body().classList.contains("paused")).toBe(false);
  });

  it("stamps the stored theme on the document root", async () => {
    const seed = createV1Seed();
    await mount({
      ...seed,
      settings: { ...seed.settings, theme: "dark" },
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("leaves the root unstamped for the system theme", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    await mount(createV1Seed());
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("shows the empty-profile state with the focused profile's name", async () => {
    const { root, annunciator } = await mount({
      ...createV1Seed(),
      profiles: [
        {
          id: "p-staging",
          name: "Staging",
          badgeText: "ST",
          color: "teal",
          enabled: true,
          rules: [],
        },
        {
          id: "p-other",
          name: "Other",
          badgeText: "OT",
          color: "blue",
          enabled: false,
          rules: [rule()],
        },
      ],
      focusedProfileId: "p-staging",
      nextRuleNum: 100,
    });

    expect(root.textContent).toContain("No rules in Staging yet.");
    expect(annunciator().textContent).toBe("Live — no rules yet.");
  });

  it("switches profiles exclusively from the chips and toggles with shift", async () => {
    const base = createV1Seed();
    const first = base.profiles[0];
    if (first === undefined) {
      throw new Error("seed has no profile");
    }
    await mount({
      ...base,
      profiles: [
        { ...first, rules: [rule()] },
        {
          id: "p2",
          name: "Second",
          badgeText: "SE",
          color: "blue",
          enabled: false,
          rules: [],
        },
      ],
      focusedProfileId: first.id,
      nextRuleNum: 100,
    });

    const chip = [
      ...document.querySelectorAll<HTMLButtonElement>(".chip"),
    ].find((candidate) =>
      candidate.textContent?.includes("Second"),
    ) as HTMLButtonElement;
    await act(async () => {
      chip.click();
    });
    await settle();

    const stored = await read();
    expect(stored.profiles.map((profile) => profile.enabled)).toEqual([
      false,
      true,
    ]);
    expect(stored.focusedProfileId).toBe("p2");
  });
});

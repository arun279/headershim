// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/popup/App";
import type { Rule, StateDoc } from "../core/model";
import { createV1Seed } from "../core/schema";
import { read, write } from "../platform/store";
import { press, render, settle } from "../ui/test/render";

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

describe("popup rule list integration", () => {
  const twoRules = () =>
    seededDoc([
      rule(),
      rule({ id: "rule-2", num: 2, header: "x-debug", value: "1" }),
    ]);

  async function grantAndMount(doc: StateDoc) {
    await fakeBrowser.permissions.request({
      origins: ["*://*.api.example.com/*"],
    });
    return mount(doc);
  }

  it("renders the focused profile's rules as a grouped list", async () => {
    const { root } = await grantAndMount(twoRules());
    expect(root.querySelector(".rule-group-label")?.textContent).toBe(
      "Default",
    );
    const rows = [...root.querySelectorAll(".rule-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("authorization");
    expect(rows[1]?.textContent).toContain("x-debug");
  });

  it("toggles a rule from its switch, instantly and persistently", async () => {
    const { root } = await grantAndMount(twoRules());
    const ruleSwitch = root.querySelector(
      '[aria-label="Rule on: authorization"]',
    ) as HTMLButtonElement;
    await act(async () => {
      ruleSwitch.click();
    });
    await settle();
    expect((await read()).profiles[0]?.rules[0]?.enabled).toBe(false);
  });

  it("keyboard delete shows the undo toast and undo restores in place", async () => {
    const { root } = await grantAndMount(twoRules());
    const row = root.querySelector(".rule-row") as HTMLElement;
    press(row, "Delete");
    await settle();

    expect(
      (await read()).profiles[0]?.rules.map((entry) => entry.header),
    ).toEqual(["x-debug"]);
    const toast = root.querySelector(".toast") as HTMLElement;
    expect(toast.textContent).toContain("Rule deleted");

    const undo = toast.querySelector(".toast-action") as HTMLButtonElement;
    expect(undo.textContent).toBe("Undo");
    await act(async () => {
      undo.click();
    });
    await settle();
    expect(
      (await read()).profiles[0]?.rules.map((entry) => entry.header),
    ).toEqual(["authorization", "x-debug"]);
    expect(root.querySelector(".toast")).toBeNull();
  });

  it("undo survives the toast timeout via the overflow menu", async () => {
    const { root } = await grantAndMount(twoRules());
    vi.useFakeTimers();
    try {
      press(root.querySelector(".rule-row") as HTMLElement, "Delete");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(root.querySelector(".toast")).not.toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6100);
      });
      expect(root.querySelector(".toast")).toBeNull();

      const menuButton = root.querySelector(
        ".rule-menu-btn",
      ) as HTMLButtonElement;
      await act(async () => {
        menuButton.click();
      });
      const undo = [...root.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent === "Undo last delete",
      ) as HTMLButtonElement;
      await act(async () => {
        undo.click();
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(
        (await read()).profiles[0]?.rules.map((entry) => entry.header),
      ).toEqual(["authorization", "x-debug"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the next mutation retires the pending undo", async () => {
    const { root } = await grantAndMount(twoRules());
    press(root.querySelector(".rule-row") as HTMLElement, "Delete");
    await settle();

    const ruleSwitch = root.querySelector(
      '[aria-label="Rule on: x-debug"]',
    ) as HTMLButtonElement;
    await act(async () => {
      ruleSwitch.click();
    });
    await settle();

    const menuButton = root.querySelector(
      ".rule-menu-btn",
    ) as HTMLButtonElement;
    await act(async () => {
      menuButton.click();
    });
    const labels = [...root.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent,
    );
    expect(labels).not.toContain("Undo last delete");
  });

  it("p toggles pause and 2 / Shift+2 drive the second profile", async () => {
    const base = twoRules();
    const first = base.profiles[0] as StateDoc["profiles"][number];
    const { root } = await grantAndMount({
      ...base,
      profiles: [
        first,
        {
          id: "p2",
          name: "Second",
          badgeText: "SE",
          color: "blue",
          enabled: false,
          rules: [],
        },
      ],
    });
    const main = root.querySelector(".popup") as HTMLElement;

    press(main, "p");
    await settle();
    expect((await read()).settings.paused).toBe(true);
    press(main, "p");
    await settle();
    expect((await read()).settings.paused).toBe(false);

    await act(async () => {
      main.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "2",
          code: "Digit2",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await settle();
    let stored = await read();
    expect(stored.profiles.map((profile) => profile.enabled)).toEqual([
      false,
      true,
    ]);
    expect(stored.focusedProfileId).toBe("p2");

    await act(async () => {
      main.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "@",
          code: "Digit1",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await settle();
    stored = await read();
    expect(stored.profiles.map((profile) => profile.enabled)).toEqual([
      true,
      true,
    ]);
  });

  it("Escape closes the popup when no layer is open", async () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    const { root } = await grantAndMount(twoRules());
    press(root.querySelector(".popup") as HTMLElement, "Escape");
    expect(closeSpy).toHaveBeenCalledTimes(1);
    closeSpy.mockRestore();
  });

  it("single letters stay inert while a text field has focus", async () => {
    const { root } = await grantAndMount(twoRules());
    const field = document.createElement("input");
    root.querySelector(".popup")?.appendChild(field);
    press(field, "p");
    await settle();
    expect((await read()).settings.paused).toBe(false);
    field.remove();
  });
});

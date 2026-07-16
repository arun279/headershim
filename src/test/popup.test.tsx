// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/popup/App";
import type { Rule, StateDoc } from "../core/model";
import { createV1Seed } from "../core/schema";
import { read, write } from "../platform/store";
import {
  findButton,
  fire,
  press,
  render,
  settle,
  typeInto,
} from "../ui/test/render";
import { THEME_CACHE_KEY } from "../ui/theme";

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
  it("renders first run with one primary action and quiet in-popup tools", async () => {
    const { root } = await mount(createV1Seed());

    expect(root.textContent).toContain(
      "Add, change, and remove HTTP headers on the sites you choose.",
    );
    const actions = [...root.querySelectorAll(".first-run-actions button")];
    expect(actions.map((button) => button.textContent)).toEqual([
      "Create your first rule",
      "Try it on this tab",
      "Import from a file",
    ]);
    expect(actions[0]?.classList.contains("primary")).toBe(true);
    expect(document.activeElement).not.toBe(actions[0]);
    expect(root.textContent).toContain(
      "clears when you close or leave this tab",
    );
    expect(root.querySelector(".profiles")).not.toBeNull();
    expect(root.querySelector(".annunciator")).toBeNull();
    expect(root.querySelector(".popup")?.classList).toContain("first-run-mode");
    expect(root.querySelector(".foot")).toBeNull();
    const theme = root.querySelector(
      '.popup-head [aria-label="Switch to dark theme"]',
    );
    const options = root.querySelector('.popup-head [aria-label="Options"]');
    expect(theme).not.toBeNull();
    expect(options).not.toBeNull();
    expect(theme?.querySelector(".sliders-glyph")).toBeNull();
    expect(options?.querySelector(".sliders-glyph")).not.toBeNull();
    expect(root.querySelector('.foot [aria-label="Options"]')).toBeNull();

    const popup = root.querySelector(".popup") as HTMLElement;
    press(popup, "v");
    press(popup, "p");
    await settle();
    expect(root.querySelector(".verify-sheet")).toBeNull();
    expect((await read()).settings.paused).toBe(false);
  });

  it("routes the first-run import action to the options import section", async () => {
    const create = vi
      .spyOn(fakeBrowser.tabs, "create")
      .mockResolvedValue({} as never);
    const { root } = await mount(createV1Seed());
    const importButton = [
      ...root.querySelectorAll(".first-run-actions button"),
    ].find(
      (button) => button.textContent === "Import from a file",
    ) as HTMLButtonElement;

    fire(() => importButton.click());

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]?.url).toMatch(
      /options\.html#import-export$/,
    );
  });

  it("renders nothing but the shell while the store is still empty", async () => {
    const { root } = await mount();
    expect(root.querySelector(".popup")?.children).toHaveLength(0);
  });

  it("refuses a newer store with the update copy", async () => {
    await fakeBrowser.storage.local.set({ state: { v: 3 } });
    const { root } = await mount();
    expect(root.textContent).toContain(
      "Your rules were saved by a newer HeaderShim (format 3; this version reads up to 1).",
    );
  });

  it("updates needs-access surfaces when a grant lands while mounted", async () => {
    const { root, annunciator } = await mount(seededDoc([rule()]));

    expect(annunciator().textContent).toContain(
      "Needs access · 1 rule needs api.example.com",
    );
    expect(annunciator().getAttribute("data-state")).toBe("needs-access");
    expect(annunciator().querySelector("button")).toBeNull();
    expect(root.querySelector(".rule-row.blocked .sw")).not.toBeNull();
    expect(root.querySelector(".rule-row .rule-grant")?.textContent).toBe(
      "Grant",
    );
    expect(root.querySelector(".rule-row.running")).toBeNull();

    await fakeBrowser.permissions.request({
      origins: ["*://*.api.example.com/*"],
    });
    await settle();

    expect(annunciator().getAttribute("data-state")).toBe("live");
    expect(annunciator().textContent).toBe("On · 1 of 1 rule enabled");
  });

  it("shows the status Grant action when the only blocked row scrolls off-screen", async () => {
    const { root, annunciator, body } = await mount(seededDoc([rule()]));
    const row = root.querySelector(".rule-row.blocked") as HTMLElement;
    const viewportRect = rect(0, 100);
    const rowRect = vi
      .spyOn(row, "getBoundingClientRect")
      .mockReturnValue(rect(120, 170));
    vi.spyOn(body(), "getBoundingClientRect").mockReturnValue(viewportRect);

    fire(() => body().dispatchEvent(new Event("scroll")));
    await settle();
    expect(annunciator().querySelector("button")?.textContent).toBe(
      "Grant access",
    );

    rowRect.mockReturnValue(rect(20, 70));
    fire(() => body().dispatchEvent(new Event("scroll")));
    await settle();
    expect(annunciator().querySelector("button")).toBeNull();
  });

  it("shows an ungranted pattern rule as blocked on both status surfaces", async () => {
    const patternRule = rule({
      scope: { type: "pattern", pattern: "||api.example.com^", hosts: [] },
    });
    const { root, annunciator } = await mount(seededDoc([patternRule]));

    expect(annunciator().getAttribute("data-state")).toBe("needs-access");
    expect(annunciator().textContent).toContain(
      "Needs access · 1 rule needs all sites",
    );
    expect(root.querySelector(".rule-row.blocked .sw")).not.toBeNull();
    expect(root.querySelector(".rule-row.running")).toBeNull();
    expect(root.querySelector(".rule-status")?.textContent).toContain(
      "Needs access · all sites",
    );
  });

  it("hands off a single Reload-tab action after granting from the annunciator", async () => {
    const { root, annunciator } = await mount(
      seededDoc([
        rule({
          scope: {
            type: "domains",
            domains: ["api.example.com", "app.example.com"],
          },
        }),
      ]),
    );
    const grant = [...annunciator().querySelectorAll("button")].find(
      (button) => button.textContent === "Grant access",
    ) as HTMLButtonElement;

    await act(async () => {
      grant.click();
    });
    await settle();

    // The change is live, but the open page still holds its pre-grant response;
    // the toast hands over the reload rather than doing it unbidden.
    const toast = root.querySelector(".toast") as HTMLElement;
    expect(toast.textContent).toContain("Access granted");
    expect(toast.querySelector(".toast-action")?.textContent).toBe(
      "Reload tab",
    );
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
    expect(pauseSwitch.classList.contains("sw-paused")).toBe(true);
    await act(async () => {
      pauseSwitch.click();
    });
    await settle();

    expect((await read()).settings.paused).toBe(true);
    expect(annunciator().textContent).toContain(
      "Paused · no headers are being modified",
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

  it("changes theme in place and persists the synchronous mirror", async () => {
    const { root } = await mount(createV1Seed());
    const themeButton = root.querySelector<HTMLButtonElement>(
      '[aria-label="Switch to dark theme"]',
    );
    if (themeButton === null) throw new Error("no theme control");
    fire(() => themeButton.click());
    await settle();

    expect({
      stored: (await read()).settings.theme,
      stamped: document.documentElement.getAttribute("data-theme") ?? undefined,
      mirrored: localStorage.getItem(THEME_CACHE_KEY),
    }).toEqual({ stored: "dark", stamped: "dark", mirrored: "dark" });
  });

  it("opens options from the header sliders control", async () => {
    const open = vi
      .spyOn(fakeBrowser.runtime, "openOptionsPage")
      .mockResolvedValue(undefined);
    const { root } = await mount(createV1Seed());
    fire(() =>
      (
        root.querySelector('[aria-label="Options"]') as HTMLButtonElement
      ).click(),
    );
    expect(open).toHaveBeenCalledOnce();
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

    expect(root.textContent).toContain("Staging has no rules yet.");
    expect(root.textContent).toContain("Your other profiles are unchanged.");
    expect(document.activeElement?.textContent).not.toBe("Create a rule");
    expect(annunciator().textContent).toBe("No rules yet");
    expect(root.querySelector(".foot")).toBeNull();
  });

  it("focuses a profile from its chip without changing enablement", async () => {
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
      chip.dispatchEvent(
        new MouseEvent("click", { shiftKey: true, bubbles: true }),
      );
    });
    await settle();

    const stored = await read();
    expect(stored.profiles.map((profile) => profile.enabled)).toEqual([
      true,
      false,
    ]);
    expect(stored.focusedProfileId).toBe("p2");
  });

  it("creates a profile in place with duplicated rules and an exclusive switch", async () => {
    const base = seededDoc([rule()]);
    const source = base.profiles[0];
    if (source === undefined) throw new Error("seed has no profile");
    const { root } = await mount({
      ...base,
      profiles: [
        source,
        {
          id: "p-existing",
          name: "New profile",
          badgeText: "NE",
          color: "blue",
          enabled: false,
          rules: [],
        },
      ],
    });

    fire(() =>
      (root.querySelector(".new-profile-chip") as HTMLButtonElement).click(),
    );
    const popover = root.querySelector(".profile-create-pop") as HTMLElement;
    const name = popover.querySelector(
      ".profile-name-field",
    ) as HTMLInputElement;
    expect(name.value).toBe("New profile 2");
    typeInto(name, "Preview");
    const duplicate = popover.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    const form = popover.querySelector("form");
    if (duplicate === null || form === null) throw new Error("incomplete form");
    fire(() => duplicate.click());
    fire(() =>
      form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      ),
    );
    await settle();

    const stored = await read();
    expect(stored.profiles.map((profile) => profile.enabled)).toEqual([
      false,
      false,
      true,
    ]);
    expect(stored.profiles[2]?.name).toBe("Preview");
    expect(stored.profiles[2]?.rules[0]?.header).toBe("authorization");
    expect(stored.profiles[2]?.rules[0]?.id).not.toBe(source.rules[0]?.id);
    expect(root.textContent).toContain("Preview");
  });

  it("renames and additively enables from a chip menu without switching focus", async () => {
    const base = seededDoc([rule()]);
    const first = base.profiles[0];
    if (first === undefined) throw new Error("seed has no profile");
    const { root, annunciator } = await mount({
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
    const secondMenu = [
      ...root.querySelectorAll<HTMLButtonElement>(".profile-menu-trigger"),
    ][1] as HTMLButtonElement;
    fire(() => secondMenu.click());
    fire(() =>
      [...root.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Rename")
        ?.click(),
    );
    const field = root.querySelector(
      ".profile-actions-pop .profile-name-field",
    ) as HTMLInputElement;
    typeInto(field, "QA");
    fire(() =>
      (
        root.querySelector(
          '.profile-actions-pop button[type="submit"]',
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();
    expect((await read()).profiles[1]?.name).toBe("QA");

    const renamedMenu = [
      ...root.querySelectorAll<HTMLButtonElement>(".profile-menu-trigger"),
    ][1] as HTMLButtonElement;
    fire(() => renamedMenu.click());
    const enable = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Turn on",
    ) as HTMLButtonElement;
    fire(() => enable.click());
    await settle();

    const stored = await read();
    expect(stored.profiles.map((profile) => profile.enabled)).toEqual([
      true,
      true,
    ]);
    expect(stored.focusedProfileId).toBe(first.id);
    expect(annunciator().textContent).toContain("2 profiles on");
  });

  it("deep-links profile management from the chip menu", async () => {
    const create = vi
      .spyOn(fakeBrowser.tabs, "create")
      .mockResolvedValue({} as never);
    const { root } = await mount(seededDoc([rule()]));
    fire(() =>
      (
        root.querySelector(".profile-menu-trigger") as HTMLButtonElement
      ).click(),
    );
    fire(() => findButton(root, "Manage profiles").click());
    expect(create.mock.calls[0]?.[0]?.url).toMatch(/options\.html#profiles$/);
  });
});

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 460,
    width: 460,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

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

describe("popup rule list integration", () => {
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

  it("shows Test on this tab as a quiet link with an inline result", async () => {
    const { root } = await grantAndMount(twoRules());
    const trigger = root.querySelector(
      ".foot-verify button",
    ) as HTMLButtonElement;
    fire(() => trigger.click());
    await settle();

    expect(trigger.textContent).toBe("Test on this tab");
    expect(trigger.classList.contains("link-btn")).toBe(true);
    expect(root.querySelector(".verify-sheet")).toBeNull();
    expect(root.querySelector(".verify-inline-result")?.textContent).toBe(
      "No matches in the last 5 minutes on this tab.",
    );
    expect(root.querySelector(".profiles")).not.toBeNull();
    expect(root.querySelector(".popup-head .theme-toggle")).not.toBeNull();
    expect(
      root.querySelector('.popup-head [aria-label="Options"]'),
    ).not.toBeNull();
    expect(root.querySelector(".annunciator")).not.toBeNull();
    expect(root.querySelector(".foot")).not.toBeNull();
    expect(root.querySelectorAll(".verify-inline-result")).toHaveLength(1);
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

    // A still-visible delete toast loses its Undo button with the undo.
    expect(root.querySelector(".toast")).not.toBeNull();
    expect(root.querySelector(".toast .toast-action")).toBeNull();

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
      true,
      false,
    ]);
    expect(stored.focusedProfileId).toBe("p2");

    await act(async () => {
      main.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "@",
          code: "Digit2",
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

describe("popup editor mode integration", () => {
  it("n replaces the list with a new-rule sheet and focuses the header", async () => {
    const { root } = await grantAndMount(twoRules());
    press(root.querySelector(".popup") as HTMLElement, "n");
    await settle();
    expect(root.querySelector(".rule-editor")).not.toBeNull();
    expect(root.querySelector(".rules")).toBeNull();
    expect(root.querySelector(".foot")).toBeNull();
    expect(root.querySelector(".editor-sheet")).not.toBeNull();
    expect(document.activeElement).toBe(
      root.querySelector('[role="combobox"]'),
    );
  });

  async function openFirstRowEditor(root: HTMLElement) {
    const row = root.querySelector(".rule-row") as HTMLElement;
    fire(() => row.focus());
    press(row, "Enter");
    await settle();
  }

  it("Enter on a row opens its editor pre-filled; Esc reverts and returns focus", async () => {
    const { root } = await grantAndMount(twoRules());
    await openFirstRowEditor(root);
    const name = root.querySelector('[role="combobox"]') as HTMLInputElement;
    expect(name.value).toBe("authorization");

    press(name, "Escape");
    await settle();
    expect(root.querySelector(".rule-editor")).toBeNull();
    expect(
      (document.activeElement as HTMLElement).classList.contains("rule-row"),
    ).toBe(true);
    // Nothing was saved by the revert.
    expect((await read()).profiles[0]?.rules).toHaveLength(2);
  });

  it("commits a new rule end to end: typed, chipped, stored, listed", async () => {
    const { root } = await grantAndMount(twoRules());
    press(root.querySelector(".popup") as HTMLElement, "n");
    await settle();

    typeInto(
      root.querySelector('[role="combobox"]') as HTMLInputElement,
      "x-api-key",
    );
    typeInto(
      root.querySelector(".value-row textarea") as HTMLTextAreaElement,
      "secret",
    );
    const chipInput = root.querySelector(
      ".domain-chip-input",
    ) as HTMLInputElement;
    typeInto(chipInput, "api.example.com");
    press(chipInput, "Enter");
    await settle();

    expect(root.querySelector(".rule-editor")).not.toBeNull();
    expect(root.querySelector(".domain-chip")?.textContent).toContain(
      "api.example.com",
    );
    expect((await read()).profiles[0]?.rules).toHaveLength(2);

    fire(() =>
      (
        root.querySelector(".editor-actions .primary") as HTMLButtonElement
      ).click(),
    );
    await settle();

    expect(root.querySelector(".rule-editor")).toBeNull();
    const stored = await read();
    expect(stored.profiles[0]?.rules.map((entry) => entry.header)).toEqual([
      "authorization",
      "x-debug",
      "x-api-key",
    ]);
    expect(root.textContent).toContain("x-api-key");
    expect(root.querySelector(".toast")?.textContent).toContain("Rule created");
  });

  it("edits an existing rule in place keeping its identity", async () => {
    const { root } = await grantAndMount(twoRules());
    await openFirstRowEditor(root);

    const value = root.querySelector(
      ".value-row textarea",
    ) as HTMLTextAreaElement;
    typeInto(value, "Bearer rotated");
    const save = [...root.querySelectorAll(".editor-actions button")].find(
      (button) => button.textContent === "Save changes",
    ) as HTMLButtonElement;
    fire(() => save.click());
    await settle();

    const stored = await read();
    expect(stored.profiles[0]?.rules[0]).toMatchObject({
      id: "rule-1",
      num: 1,
      header: "authorization",
      value: "Bearer rotated",
    });
    expect(root.querySelector(".toast")?.textContent).toContain(
      "Changes saved",
    );
  });
});

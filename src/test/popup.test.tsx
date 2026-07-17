// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/popup/App";
import type { Profile, Rule, StateDoc } from "../core/model";
import { createV1Seed } from "../core/schema";
import { read, write } from "../platform/store";
import { copy } from "../ui/copy";
import { fire, press, render, settle, typeInto } from "../ui/test/render";
import { THEME_CACHE_KEY } from "../ui/theme";

// The popup's tab is pinned so the readout has a host and This-tab writes bind.
vi.mock("../platform/tabs", () => ({
  activeTabId: () => Promise.resolve(5),
  activeTabDomain: () => Promise.resolve("api.example.com"),
}));

const ORIGIN = "*://*.api.example.com/*";

beforeEach(() => {
  fakeBrowser.reset();
});

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    num: 1,
    direction: "request",
    operation: "set",
    header: "x-env",
    value: "staging",
    scope: { type: "domains", domains: ["api.example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...overrides,
  };
}

function seededDoc(rules: Rule[], extra: Profile[] = []): StateDoc {
  const seed = createV1Seed();
  const profile = seed.profiles[0];
  if (profile === undefined) throw new Error("seed has no profile");
  return {
    ...seed,
    profiles: [{ ...profile, rules }, ...extra],
    nextRuleNum: 100,
  };
}

async function mount(doc?: StateDoc, granted = false) {
  if (granted) {
    await fakeBrowser.permissions.request({ origins: [ORIGIN] });
  }
  if (doc !== undefined) await write(doc);
  const root = render(<App />);
  await settle();
  return {
    root,
    status: () => root.querySelector(".status") as HTMLElement,
    lines: () => [...root.querySelectorAll(".change-line")],
    body: () => root.querySelector(".popup-body") as HTMLElement,
  };
}

const twoRules = () =>
  seededDoc([
    rule(),
    rule({ id: "rule-2", num: 2, header: "x-debug", value: "1" }),
  ]);

describe("popup readout", () => {
  it("leads with the site and the one-fact status line", async () => {
    const { root, status } = await mount(twoRules(), true);
    expect(root.querySelector(".host")?.textContent).toBe("api.example.com");
    expect(status().textContent).toBe("2 changes on this tab");
    expect(root.querySelector(".lamp.live")).not.toBeNull();
    expect(root.querySelector(".substatus")).toBeNull();
  });

  it("renders a live change as a silent teal-spine line with a toggle", async () => {
    const { lines } = await mount(seededDoc([rule()]), true);
    expect(lines()).toHaveLength(1);
    const line = lines()[0] as HTMLElement;
    expect(line.classList.contains("live")).toBe(true);
    expect(line.querySelector(".k")?.textContent).toBe("x-env");
    expect(line.querySelector(".v")?.textContent).toBe("staging");
    expect(line.querySelector('[aria-label="Turn off: x-env"]')).not.toBeNull();
    // A live line adds no reason.
    expect(line.querySelector(".why")).toBeNull();
  });

  it("lifts an authorization rule into the masked token hero", async () => {
    const { root } = await mount(
      seededDoc([
        rule({ header: "authorization", value: "Bearer abcd1234wxyz" }),
      ]),
      true,
    );
    const token = root.querySelector(".token") as HTMLElement;
    expect(token).not.toBeNull();
    expect(token.querySelector(".pre")?.textContent).toBe("Bearer");
    expect(token.querySelector(".last")?.textContent).toBe("wxyz");
    // The opaque token draws no countdown it would have to invent.
    expect(token.querySelector(".fresh-track")).toBeNull();
    expect(token.textContent).toContain(copy.token.opaque);
    // Never repeated as a plain request line.
    expect(root.querySelectorAll(".change-line")).toHaveLength(0);
  });

  it("draws a real countdown for a decodable JWT", async () => {
    const payload = btoa(JSON.stringify({ iat: 0, exp: 4102444800 }))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const jwt = `Bearer h.${payload}.s`;
    const { root } = await mount(
      seededDoc([rule({ header: "authorization", value: jwt })]),
      true,
    );
    expect(root.querySelector(".fresh-track")).not.toBeNull();
    expect(root.querySelector(".fresh-lab .tag")?.textContent).toBe("JWT");
  });

  it("swaps a token through a masked, screen-share-safe field", async () => {
    const { root } = await mount(
      seededDoc([
        rule({ header: "authorization", value: "Bearer opaque1234" }),
      ]),
      true,
    );
    const swap = root.querySelector(".token .swap") as HTMLButtonElement;
    fire(() => swap.click());

    const field = root.querySelector(".swapfield input") as HTMLInputElement;
    expect(field.type).toBe("password");
    expect(root.querySelector(".swapfield .safety")?.textContent).toContain(
      "screen-share safe",
    );
    // The resting masked value yields to a bare "on <host>" while swapping.
    expect(root.querySelector(".tk-val")).toBeNull();

    typeInto(field, "Bearer rotated-9Zt1");
    press(field, "Enter");
    await settle();

    // The swap writes a this-tab override; the persistent rule is untouched.
    const session = await import("../platform/session-store").then((m) =>
      m.read(),
    );
    expect(session.tabs[5]?.[0]).toMatchObject({
      header: "authorization",
      value: "Bearer rotated-9Zt1",
    });
    expect((await read()).profiles[0]?.rules[0]?.value).toBe(
      "Bearer opaque1234",
    );
  });

  it("toggles a rule from its switch, instantly and persistently", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    const toggle = root.querySelector(
      '[aria-label="Turn off: x-env"]',
    ) as HTMLButtonElement;
    await act(async () => toggle.click());
    await settle();
    expect((await read()).profiles[0]?.rules[0]?.enabled).toBe(false);
  });

  it("shows an ungranted rule amber with a Grant that clears every surface", async () => {
    const { root, status } = await mount(seededDoc([rule()]));
    const line = root.querySelector(".change-line") as HTMLElement;
    expect(line.classList.contains("needs-access")).toBe(true);
    expect(root.querySelector(".substatus .amber")?.textContent).toBe(
      "1 needs access",
    );
    expect(root.querySelector(".lamp.warn")).not.toBeNull();
    const grant = root.querySelector(
      ".change-line .grant",
    ) as HTMLButtonElement;
    expect(grant.textContent).toBe("Grant");

    await act(async () => {
      await fakeBrowser.permissions.request({ origins: [ORIGIN] });
    });
    await settle();
    expect(
      (root.querySelector(".change-line") as HTMLElement).classList.contains(
        "live",
      ),
    ).toBe(true);
    expect(status().textContent).toBe("1 change on this tab");
    expect(root.querySelector(".substatus")).toBeNull();
  });

  it("states the honest refused reason for a Host rule and stays enabled", async () => {
    const { root } = await mount(
      seededDoc([rule({ header: "host", value: "internal.example.com" })]),
      true,
    );
    const line = root.querySelector(".change-line") as HTMLElement;
    expect(line.classList.contains("refused")).toBe(true);
    expect(line.querySelector(".why.stop")?.textContent).toContain(
      "Chrome won't let extensions change the Host header",
    );
    expect(root.querySelector(".substatus .stop")?.textContent).toBe(
      "1 refused by Chrome",
    );
  });

  it("names the winning same-profile rule on an overridden line", async () => {
    const first = createV1Seed().profiles[0];
    if (first === undefined) throw new Error("no seed profile");
    const { root } = await mount(
      {
        ...createV1Seed(),
        profiles: [
          {
            ...first,
            id: "p-a",
            name: "Staging auth",
            rules: [
              rule({ header: "x-env", comment: "staging environment" }),
              rule({ id: "rule-2", num: 2, header: "x-env", value: "prod" }),
            ],
          },
        ],
        activeProfileId: "p-a",
        nextRuleNum: 100,
      },
      true,
    );
    const overridden = [...root.querySelectorAll(".change-line")].find((line) =>
      line.classList.contains("overridden"),
    );
    expect(overridden?.querySelector(".why.rest")?.textContent).toContain(
      "overridden by staging environment",
    );
    expect(root.querySelector(".change-line .badge-glyph")).toBeNull();
  });

  it("edits a plain value inline and commits it", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    const trigger = root.querySelector(".v-edit") as HTMLButtonElement;
    fire(() => trigger.click());
    const input = root.querySelector(".v-input") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.value).toBe("staging");
    typeInto(input, "production");
    press(input, "Enter");
    await settle();
    expect((await read()).profiles[0]?.rules[0]?.value).toBe("production");
  });

  it("opens a secret value edit empty and masked", async () => {
    const { root } = await mount(
      seededDoc([rule({ header: "x-api-key", value: "sk_live_secret" })]),
      true,
    );
    fire(() => (root.querySelector(".v-edit") as HTMLButtonElement).click());
    const input = root.querySelector(".v-input") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.value).toBe("");
  });

  it("shows the empty state when nothing reaches this site", async () => {
    const { root } = await mount(createV1Seed(), true);
    expect(root.querySelector(".empty")?.textContent).toContain(
      "isn't changing anything on",
    );
    expect(root.querySelector(".empty .mono")?.textContent).toBe(
      "api.example.com",
    );
    expect(root.querySelector(".change-line")).toBeNull();
  });

  it("pauses to a banner and grayscaled body, then resumes", async () => {
    const { root, body } = await mount(seededDoc([rule()]), true);
    const pause = root.querySelector(
      '[aria-label="Global pause"]',
    ) as HTMLButtonElement;
    await act(async () => pause.click());
    await settle();
    expect((await read()).settings.paused).toBe(true);
    expect(root.querySelector(".pausebar")?.textContent).toContain(
      "Everything paused",
    );
    expect(body().classList.contains("paused")).toBe(true);
    expect(root.querySelector(".foot")?.classList.contains("paused")).toBe(
      false,
    );
    await act(async () => pause.click());
    await settle();
    expect((await read()).settings.paused).toBe(false);
  });

  it("switches theme in place and persists the mirror", async () => {
    const { root } = await mount(createV1Seed(), true);
    const theme = root.querySelector(
      '[aria-label="Switch to dark theme"]',
    ) as HTMLButtonElement;
    fire(() => theme.click());
    await settle();
    expect({
      stored: (await read()).settings.theme,
      stamped: document.documentElement.getAttribute("data-theme"),
      mirrored: localStorage.getItem(THEME_CACHE_KEY),
    }).toEqual({ stored: "dark", stamped: "dark", mirrored: "dark" });
  });

  it("opens options from the footer gear", async () => {
    const open = vi
      .spyOn(fakeBrowser.runtime, "openOptionsPage")
      .mockResolvedValue(undefined);
    const { root } = await mount(createV1Seed(), true);
    fire(() =>
      (
        root.querySelector('.foot [aria-label="Options"]') as HTMLButtonElement
      ).click(),
    );
    expect(open).toHaveBeenCalledOnce();
  });
});

describe("popup profile switch", () => {
  const withSecond = () =>
    seededDoc(
      [rule()],
      [
        {
          id: "p2",
          name: "Prod read-only",
          badgeText: "PR",
          color: "green",
          rules: [
            rule({ id: "r2", num: 2, header: "x-read-only", value: "1" }),
          ],
        },
      ],
    );

  // Opens the picker and returns the "Prod read-only" switch target.
  const openPickerTarget = (root: HTMLElement): HTMLButtonElement => {
    fire(() => (root.querySelector(".prof") as HTMLButtonElement).click());
    return root.querySelector(
      '[aria-label="Switch to Prod read-only"]',
    ) as HTMLButtonElement;
  };

  it("switches profiles with one active id from the picker", async () => {
    const { root } = await mount(withSecond(), true);
    const target = openPickerTarget(root);
    await act(async () => target.click());
    await settle();
    const stored = await read();
    expect(stored.activeProfileId).toBe("p2");
    expect(
      stored.profiles.every((candidate) => !("enabled" in candidate)),
    ).toBe(true);
  });

  it("previews the local diff before a switch commits", async () => {
    const { root } = await mount(withSecond(), true);
    const target = openPickerTarget(root);
    fire(() =>
      target.dispatchEvent(new FocusEvent("focus", { bubbles: true })),
    );
    const preview = root.querySelector(".preview") as HTMLElement;
    expect(preview.textContent).toContain("If you switch to Prod read-only");
    expect(preview.querySelector(".drops")?.textContent).toContain("x-env");
    expect(preview.querySelector(".adds")?.textContent).toContain(
      "x-read-only",
    );
    // No commit happened from the preview alone.
    const stored = await read();
    expect(stored.activeProfileId).toBe(stored.profiles[0]?.id);
  });

  it("creates and activates a new profile from the picker", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    fire(() => (root.querySelector(".prof") as HTMLButtonElement).click());
    await act(async () => {
      (root.querySelector(".popt.new") as HTMLButtonElement).click();
    });
    await settle();
    const stored = await read();
    expect(stored.profiles).toHaveLength(2);
    expect(stored.activeProfileId).toBe(stored.profiles[1]?.id);
    expect(
      stored.profiles.every((candidate) => !("enabled" in candidate)),
    ).toBe(true);
  });
});

describe("popup authoring entry points", () => {
  it("n opens the rule editor for a new change", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    press(root.querySelector(".popup") as HTMLElement, "n");
    await settle();
    expect(root.querySelector(".rule-editor")).not.toBeNull();
    expect(root.querySelector(".change-line")).toBeNull();
  });

  it("Add a change from the footer opens the editor", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    fire(() => (root.querySelector(".foot .add") as HTMLButtonElement).click());
    await settle();
    expect(root.querySelector(".rule-editor")).not.toBeNull();
  });

  it("t opens the this-tab composer", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    press(root.querySelector(".popup") as HTMLElement, "t");
    await settle();
    expect(root.querySelector(".compose")).not.toBeNull();
  });

  it("Escape closes the popup when no layer is open", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const { root } = await mount(seededDoc([rule()]), true);
    press(root.querySelector(".popup") as HTMLElement, "Escape");
    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
  });
});

describe("popup lifecycle", () => {
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

  it("stamps the stored theme on the document root", async () => {
    const seed = createV1Seed();
    await mount(
      { ...seed, settings: { ...seed.settings, theme: "dark" } },
      true,
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

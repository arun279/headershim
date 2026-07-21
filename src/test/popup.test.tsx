// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/popup/App";
import type { Profile, Rule, StateDoc } from "../core/model";
import { createV1Seed } from "../core/schema";
import { setReconcileError } from "../platform/session-store";
import { read, write } from "../platform/store";
import { copy } from "../ui/copy";
import { fire, press, render, settle, typeInto } from "../ui/test/render";

// The popup's tab is pinned so the readout has a host and This-tab writes bind.
// activeTabDomain is a spy: a tab with no web origin is its own popup state.
vi.mock("../platform/tabs", () => ({
  activeTabId: () => Promise.resolve(5),
  activeTabDomain: vi.fn(() => Promise.resolve("api.example.com")),
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

const SWAP_FROM = "Bearer opaque1234";
const SWAP_TO = "Bearer rotated-9Zt1";

function tokenDoc(): StateDoc {
  return seededDoc([rule({ header: "authorization", value: SWAP_FROM })]);
}

/** A popup whose hero is a live token, with the swap already committed. */
async function mountSwapped() {
  const { root } = await mount(tokenDoc(), true);
  fire(() => (root.querySelector(".token .swap") as HTMLButtonElement).click());
  const field = root.querySelector(".swapfield input") as HTMLInputElement;
  typeInto(field, SWAP_TO);
  press(field, "Enter");
  await settle();
  return root;
}

async function openNewProfileName(
  root: HTMLElement,
): Promise<HTMLInputElement> {
  fire(() => (root.querySelector(".prof") as HTMLButtonElement).click());
  await act(async () => {
    (root.querySelector(".popt.new") as HTMLButtonElement).click();
  });
  await settle();
  return root.querySelector(".profile-name-input") as HTMLInputElement;
}

/** Operate the Undo the toast is offering, and report what the rule holds. */
async function undoThroughToast(root: Element) {
  const undo = root.querySelector(".toast-action") as HTMLButtonElement;
  expect(undo.textContent).toBe("Undo");
  await act(async () => undo.click());
  await settle();
  return (await read()).profiles[0]?.rules[0]?.value;
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

async function turnOffOnlyRule(): Promise<HTMLElement> {
  const { root } = await mount(seededDoc([rule()]), true);
  const toggle = root.querySelector<HTMLButtonElement>(
    '[aria-label="Turn off: x-env"]',
  );
  if (toggle === null) throw new Error("missing rule toggle");
  await act(async () => toggle.click());
  await settle();
  return root;
}

function closeComposerWithEscape(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>(".cin.name");
  if (input === null) throw new Error("missing this-tab composer input");
  press(input, "Escape");
  expect(root.querySelector(".compose")).toBeNull();
}

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

  it("shows a hollow doubt lamp when any counted line is unconfirmed", async () => {
    const { root } = await mount(
      seededDoc([
        rule(),
        rule({
          id: "rule-2",
          num: 2,
          header: "x-debug",
          scope: {
            type: "pattern",
            pattern: "||api.example.com^",
            hosts: ["api.example.com"],
          },
        }),
      ]),
      true,
    );
    expect(root.querySelector(".change-line.unconfirmed")).not.toBeNull();
    expect(root.querySelector(".status")?.textContent).toBe(
      "2 changes on this tab",
    );
    expect(root.querySelector(".lamp.doubt")).not.toBeNull();
    expect(root.querySelector(".lamp.live")).toBeNull();
  });

  it("renders a network-managed line as managed, never live or counted", async () => {
    const { root } = await mount(
      seededDoc([rule({ header: "connection", value: "keep-alive" })]),
      true,
    );
    const line = root.querySelector(".change-line") as HTMLElement;
    expect(line.classList.contains("managed")).toBe(true);
    expect(line.classList.contains("live")).toBe(false);
    expect(line.querySelector(".why.amber")?.textContent).toContain(
      copy.readout.managedReason,
    );
    expect(root.querySelector(".status")?.textContent).toBe(
      "0 changes on this tab",
    );
    expect(root.querySelector(".substatus .amber")?.textContent).toBe(
      "1 managed by Chrome",
    );
    expect(root.querySelector(".lamp.warn")).not.toBeNull();
    expect(line.querySelector('[role="switch"]')?.className).toBe(
      "sw sw-inert",
    );
  });

  it("keeps the live tone off an out-of-sync rule toggle", async () => {
    await setReconcileError(true);
    const { root } = await mount(seededDoc([rule()]), true);
    const toggle = root.querySelector(
      '.change-line.out-of-sync [role="switch"]',
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(toggle?.className).toBe("sw sw-inert");
    expect(toggle?.className).not.toBe("sw");
  });

  it("renders generated metadata in place of an absent literal value", async () => {
    const { root } = await mount(
      seededDoc([
        rule({
          header: "x-trace-id",
          value: "",
          generated: { kind: "uuid", at: "2026-07-12T14:03:00.000Z" },
        }),
      ]),
      true,
    );

    expect(root.querySelector(".change-line .v")?.textContent).toBe(
      copy.rules.generated(copy.editor.generatedKind.uuid),
    );
  });

  it("lets a header name use the row before truncating", async () => {
    const header = "x-this-header-name-can-use-the-whole-available-row";
    const { value: _value, ...removal } = rule({
      header,
      operation: "remove",
    });
    const { root } = await mount(seededDoc([removal]), true);

    expect(root.querySelector(".change-line .k")?.textContent).toBe(header);
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
    // The bar carries the fraction and the countdown carries it in words. A
    // third reading of the same fact is not a third fact.
    expect(root.querySelector(".fresh-lab")?.textContent).not.toMatch(/%/);
  });

  it("does not tell an expired token to be swapped before it lapses", async () => {
    const payload = btoa(JSON.stringify({ iat: -120, exp: -60 }))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const { root } = await mount(
      seededDoc([
        rule({ header: "authorization", value: `Bearer h.${payload}.s` }),
      ]),
      true,
    );

    expect(root.querySelector(".fresh-lab")?.textContent).toContain("expired");
    expect(root.querySelector(".fresh-lab")?.textContent).not.toContain(
      copy.token.warnNote,
    );
  });

  it("swaps a token through a masked field, onto the rule carrying it", async () => {
    const { root } = await mount(tokenDoc(), true);
    const swap = root.querySelector(".token .swap") as HTMLButtonElement;
    fire(() => swap.click());

    const field = root.querySelector(".swapfield input") as HTMLInputElement;
    expect(field.type).toBe("password");
    expect(
      root.querySelector(".swapfield .btn.primary")?.textContent,
    ).toContain(copy.token.replace);
    // The resting masked value yields to a bare "on <host>" while swapping.
    expect(root.querySelector(".tk-val")).toBeNull();

    typeInto(field, SWAP_TO);
    press(field, "Enter");
    await settle();

    // A dead token is a fact about the rule, not about this tab: the swap
    // rewrites the saved rule, so the next tab sends the token you just set.
    expect((await read()).profiles[0]?.rules[0]?.value).toBe(SWAP_TO);
    const session = await import("../platform/session-store").then((m) =>
      m.read(),
    );
    expect(session.tabs[5]).toBeUndefined();
  });

  it("reports a token swap that cannot reach the current store", async () => {
    const { root } = await mount(tokenDoc(), true);
    fire(() =>
      (root.querySelector(".token .swap") as HTMLButtonElement).click(),
    );
    const field = root.querySelector(".swapfield input") as HTMLInputElement;
    typeInto(field, SWAP_TO);
    const get = vi
      .spyOn(fakeBrowser.storage.local, "get")
      .mockResolvedValueOnce({ state: { v: 9 } });

    try {
      press(field, "Enter");
      await settle();
    } finally {
      get.mockRestore();
    }

    expect(root.querySelector(".swapfield input")).not.toBeNull();
    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.errors.saveFailed,
    );
    expect((await read()).profiles[0]?.rules[0]?.value).toBe(SWAP_FROM);
  });

  it("hands back the old token from the swap toast", async () => {
    expect(await undoThroughToast(await mountSwapped())).toBe(SWAP_FROM);
  });

  it("undoes the value it wrote without reverting an edit made meanwhile", async () => {
    const root = await mountSwapped();

    // The options page turns the same rule off while the Undo is still offered.
    const doc = await read();
    await act(async () => {
      await write({
        ...doc,
        profiles: doc.profiles.map((profile) => ({
          ...profile,
          rules: profile.rules.map((candidate) => ({
            ...candidate,
            enabled: false,
          })),
        })),
      });
    });
    await settle();

    await act(async () =>
      (root.querySelector(".toast-action") as HTMLButtonElement).click(),
    );
    await settle();

    // Undo hands back the token and nothing else: it is not a time machine for
    // fields it never touched.
    const after = (await read()).profiles[0]?.rules[0];
    expect(after?.value).toBe(SWAP_FROM);
    expect(after?.enabled).toBe(false);
  });

  it("keeps a raised Undo operable once the editor opens over it", async () => {
    const root = await mountSwapped();
    fire(() => (root.querySelector(".foot .add") as HTMLButtonElement).click());
    expect(await undoThroughToast(root)).toBe(SWAP_FROM);
  });

  it("toggles a rule from its switch, instantly and persistently", async () => {
    await turnOffOnlyRule();
    expect((await read()).profiles[0]?.rules[0]?.enabled).toBe(false);
  });

  it("keeps the last disabled rule visible and focused for re-enabling", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    const disable = root.querySelector<HTMLButtonElement>(
      '[aria-label="Turn off: x-env"]',
    );
    if (disable === null) throw new Error("missing rule toggle");
    disable.focus();
    await act(async () => disable.click());
    await settle();

    const enable = root.querySelector<HTMLButtonElement>(
      '[aria-label="Turn on: x-env"]',
    );
    expect(root.querySelector(".status")?.textContent).toBe(
      "0 changes on this tab",
    );
    expect(root.querySelector(".empty")).toBeNull();
    expect(root.querySelector(".change-line.off")).not.toBeNull();
    expect(enable).not.toBeNull();
    expect(document.activeElement).toBe(enable);

    await act(async () => enable?.click());
    await settle();
    expect((await read()).profiles[0]?.rules[0]?.enabled).toBe(true);
    expect(root.querySelector(".empty")).toBeNull();
  });

  it("shows an ungranted rule amber with a Grant that clears every surface", async () => {
    const { root, status } = await mount(seededDoc([rule()]));
    const line = root.querySelector(".change-line") as HTMLElement;
    expect(line.classList.contains("needs-access")).toBe(true);
    expect(root.querySelector(".substatus .amber")?.textContent).toBe(
      "1 needs access",
    );
    expect(root.querySelector(".lamp.warn")).not.toBeNull();
    expect(status().textContent).toBe("0 changes on this tab");
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

  it("labels the Grant all sites when a hostless pattern rule needs broad access", async () => {
    const { root } = await mount(
      seededDoc([
        rule({
          scope: { type: "pattern", pattern: "||example.com^", hosts: [] },
        }),
      ]),
    );
    const line = root.querySelector(".change-line") as HTMLElement;
    expect(line.classList.contains("needs-access")).toBe(true);
    const grant = root.querySelector(
      ".change-line .grant",
    ) as HTMLButtonElement;
    expect(grant.textContent).toBe(copy.readout.grantAllSites);
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
    expect(root.querySelector(".status")?.textContent).toBe(
      "0 changes on this tab",
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
    // The empty state owns the one action; the footer does not repeat it.
    expect(root.querySelectorAll(".add")).toHaveLength(1);
    expect(root.querySelector(".foot .add")).toBeNull();
    expect(root.querySelector(".empty .add")).not.toBeNull();
  });

  it("offers no change to add when there is no site to change", async () => {
    const { activeTabDomain } = await import("../platform/tabs");
    vi.mocked(activeTabDomain).mockResolvedValueOnce(undefined);
    const { root } = await mount(createV1Seed(), true);
    expect(root.querySelector(".empty")?.textContent).toContain(
      "Open the popup on a website",
    );
    expect(root.querySelectorAll(".add")).toHaveLength(0);
    expect(root.querySelector(".tab-btn")).toBeNull();
  });

  it("reads the master switch on while running, the way every switch here does", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    const master = root.querySelector(
      '.foot [aria-label="All header changes"]',
    ) as HTMLButtonElement;
    const ruleSwitch = root.querySelector(
      '[aria-label="Turn off: x-env"]',
    ) as HTMLButtonElement;
    // Running reads checked on both, so the two switches 10px apart cannot
    // show the same fact with opposite knobs.
    expect(root.querySelector(".foot .pause")?.textContent).toContain("On");
    expect(master.getAttribute("aria-checked")).toBe("true");
    expect(ruleSwitch.getAttribute("aria-checked")).toBe("true");

    await act(async () => master.click());
    await settle();
    expect((await read()).settings.paused).toBe(true);
    expect(
      (
        root.querySelector(
          '.foot [aria-label="All header changes"]',
        ) as HTMLElement
      ).getAttribute("aria-checked"),
    ).toBe("false");
    expect(root.querySelector(".foot .pause")?.textContent).toContain("Paused");
  });

  it("pauses to a banner and paused lines, then resumes", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    const pause = root.querySelector(
      '[aria-label="All header changes"]',
    ) as HTMLButtonElement;
    await act(async () => pause.click());
    await settle();
    expect((await read()).settings.paused).toBe(true);
    expect(root.querySelector(".pausebar")?.textContent).toContain(
      "Everything paused",
    );
    // Pause is drawn once, on the lines it is true of. Nothing dims the region
    // on top of that: every control in it still writes.
    expect(root.querySelector(".change-line.paused")).not.toBeNull();
    expect(root.querySelector(".popup-body")?.className).toBe("popup-body");
    await act(async () => pause.click());
    await settle();
    expect((await read()).settings.paused).toBe(false);
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
    const target = [
      ...root.querySelectorAll<HTMLButtonElement>(".pop-list button"),
    ].find(
      (button) => button.querySelector(".nm")?.textContent === "Prod read-only",
    );
    if (target === undefined) throw new Error("missing profile switch target");
    return target;
  };

  it("uses disclosure roles, visible names, and focuses the active profile", async () => {
    const { root } = await mount(withSecond(), true);
    const trigger = root.querySelector(".prof") as HTMLButtonElement;
    const target = openPickerTarget(root);
    const group = root.querySelector('[role="group"]') as HTMLElement;
    const current = group.querySelector('[aria-current="true"]');
    const options = [...group.querySelectorAll(".pop-list > .popt")];

    expect(trigger.getAttribute("aria-haspopup")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe("profile-switch-pop");
    expect(group.getAttribute("aria-labelledby")).toBe("profile-switch-pop-h");
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(group.querySelector('[role="menuitemradio"]')).toBeNull();
    expect(options).toHaveLength(2);
    expect(options.every((option) => option instanceof HTMLButtonElement)).toBe(
      true,
    );
    expect(
      options.every((option) => !option.hasAttribute("aria-checked")),
    ).toBe(true);
    expect(current?.querySelector(".nm")?.textContent).toBe("Default");
    expect(document.activeElement).toBe(current);
    expect(target.getAttribute("aria-label")).toBeNull();
  });

  it("switches profiles with one active id and restores trigger focus", async () => {
    const { root } = await mount(withSecond(), true);
    const target = openPickerTarget(root);
    await act(async () => target.click());
    await settle();
    const stored = await read();
    expect(stored.activeProfileId).toBe("p2");
    expect(root.querySelector(".pop")).toBeNull();
    expect(document.activeElement).toBe(root.querySelector(".prof"));
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

  it("creates, focuses, and names a new profile from the picker", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    const input = await openNewProfileName(root);
    expect(input.value).toBe(copy.options.profiles.newName);
    expect(input.getAttribute("aria-label")).toBe(
      copy.options.profiles.nameLabel,
    );
    expect(document.activeElement).toBe(input);

    typeInto(input, "QA headers");
    press(input, "Enter");
    await settle();

    const stored = await read();
    expect(stored.profiles).toHaveLength(2);
    expect(stored.activeProfileId).toBe(stored.profiles[1]?.id);
    expect(stored.profiles[1]?.name).toBe("QA headers");
    expect(root.querySelector(".pop")).not.toBeNull();
    expect(document.activeElement).toBe(
      root.querySelector('[aria-current="true"]'),
    );
    expect(
      stored.profiles.every((candidate) => !("enabled" in candidate)),
    ).toBe(true);
  });

  it("cancels a new profile rename before Escape dismisses the picker", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const { root } = await mount(seededDoc([rule()]), true);
    const input = await openNewProfileName(root);
    typeInto(input, "Discarded name");

    press(input, "Escape");
    await settle();

    expect(root.querySelector(".pop")).not.toBeNull();
    expect(root.querySelector(".profile-name-input")).toBeNull();
    expect(document.activeElement).toBe(
      root.querySelector('[aria-current="true"]'),
    );
    expect((await read()).profiles[1]?.name).toBe(
      copy.options.profiles.newName,
    );
    expect(close).not.toHaveBeenCalled();
    close.mockRestore();
  });

  it("reports a profile rename whose target disappeared", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    const input = await openNewProfileName(root);
    const stored = await read();
    const first = stored.profiles[0];
    if (first === undefined) throw new Error("missing original profile");
    const get = vi
      .spyOn(fakeBrowser.storage.local, "get")
      .mockResolvedValueOnce({
        state: { ...stored, profiles: [first], activeProfileId: first.id },
      });

    try {
      typeInto(input, "Vanished profile");
      press(input, "Enter");
      await settle();
    } finally {
      get.mockRestore();
    }

    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.errors.saveFailed,
    );
  });

  it("does not reopen a delayed new profile in rename mode after dismissal", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    const stored = await read();
    const { promise, resolve } = Promise.withResolvers<void>();
    const get = vi
      .spyOn(fakeBrowser.storage.local, "get")
      .mockImplementationOnce(async () => {
        await promise;
        return { state: stored };
      });

    fire(() => (root.querySelector(".prof") as HTMLButtonElement).click());
    const create = root.querySelector(".popt.new") as HTMLButtonElement;
    fire(() => create.click());
    press(create, "Escape");
    expect(root.querySelector(".pop")).toBeNull();

    resolve();
    await settle();
    get.mockRestore();

    fire(() => (root.querySelector(".prof") as HTMLButtonElement).click());
    await settle();

    const current = root.querySelector('[aria-current="true"]');
    expect((await read()).profiles).toHaveLength(2);
    expect(root.querySelector(".profile-name-input")).toBeNull();
    expect(current?.querySelector(".nm")?.textContent).toBe(
      copy.options.profiles.newName,
    );
    expect(document.activeElement).toBe(current);
  });

  it("uses Escape to close the picker without closing the popup", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const { root } = await mount(withSecond(), true);
    const target = openPickerTarget(root);

    press(target, "Escape");

    expect(root.querySelector(".pop")).toBeNull();
    expect(document.activeElement).toBe(root.querySelector(".prof"));
    expect(close).not.toHaveBeenCalled();
    close.mockRestore();
  });

  it("uses Escape to close overlapping layers from newest to oldest", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const { root } = await mount(withSecond(), true);
    press(root.querySelector(".popup") as HTMLElement, "t");
    await settle();
    const target = openPickerTarget(root);

    press(target, "Escape");

    expect(root.querySelector(".pop")).toBeNull();
    expect(root.querySelector(".compose")).not.toBeNull();
    expect(close).not.toHaveBeenCalled();

    closeComposerWithEscape(root);
    expect(close).not.toHaveBeenCalled();
    close.mockRestore();
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

  it("uses Escape to close the this-tab composer without closing the popup", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const { root } = await mount(seededDoc([rule()]), true);
    const opener = root.querySelector<HTMLButtonElement>(".tab-btn");
    if (opener === null) throw new Error("missing this-tab opener");
    opener.focus();
    fire(() => opener.click());
    await settle();

    expect(document.activeElement).toBe(root.querySelector(".cin.name"));
    closeComposerWithEscape(root);
    expect(document.activeElement).toBe(opener);
    expect(close).not.toHaveBeenCalled();
    close.mockRestore();
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

// @vitest-environment happy-dom

import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { App } from "../../entrypoints/popup/App";
import type { Profile, Rule, StateDoc } from "../core/model";
import { createV1Seed } from "../core/schema";
import { setAppliedRevision } from "../platform/session-store";
import { read, write } from "../platform/store";
import { copy } from "../ui/copy";
import {
  atPaint,
  fire,
  paint,
  press,
  render,
  settle,
  typeInto,
} from "../ui/test/render";
import { followCurrentBatch, stopFollowingCurrentBatch } from "./applied";

// The popup's tab is pinned so the readout has a host and This-tab writes bind.
// activeTabOrigin is a spy: a tab with no web origin is its own popup state.
// Only the active-tab reads are stubbed, so openAboutPage still runs for real
// against the fake browser.
vi.mock("../platform/tabs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform/tabs")>()),
  activeTabId: () => Promise.resolve(5),
  activeTabOrigin: vi.fn(() => Promise.resolve("https://api.example.com")),
}));

const ORIGIN = "*://*.api.example.com/*";

beforeEach(() => {
  stopFollowingCurrentBatch();
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

function openTokenSwap(root: ParentNode): HTMLInputElement {
  fire(() => (root.querySelector(".token .swap") as HTMLButtonElement).click());
  return root.querySelector(".swapfield input") as HTMLInputElement;
}

/** A popup whose hero is a live token, with the swap already committed. */
async function mountSwapped() {
  const { root } = await mount(tokenDoc(), true);
  const field = openTokenSwap(root);
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
  await followCurrentBatch();
  const root = render(<App />);
  await settle();
  return {
    root,
    status: () => root.querySelector(".status") as HTMLElement,
    lines: () => [...root.querySelectorAll(".change-line")],
  };
}

function expectWarningCaveat(root: ParentNode, reason: string): HTMLElement {
  const line = root.querySelector<HTMLElement>(".change-line");
  if (line === null) throw new Error("change line was not rendered");
  expect(line.classList.contains("amber")).toBe(true);
  expect(line.querySelector(".why.amber")?.textContent).toContain(reason);
  return line;
}

const twoRules = () =>
  seededDoc([
    rule(),
    rule({ id: "rule-2", num: 2, header: "x-debug", value: "1" }),
  ]);

async function turnOffOnlyRule(): Promise<HTMLElement> {
  const { root } = await mount(seededDoc([rule()]), true);
  const toggle = root.querySelector<HTMLButtonElement>(
    '[aria-label="Rule on: x-env"]',
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

  it("renders a live change without a universal initiator warning", async () => {
    const { lines } = await mount(seededDoc([rule()]), true);
    expect(lines()).toHaveLength(1);
    const line = lines()[0] as HTMLElement;
    expect(line.classList.contains("live")).toBe(true);
    expect(line.querySelector(".k")?.textContent).toBe("x-env");
    expect(line.querySelector(".v")?.textContent).toBe("staging");
    expect(line.querySelector('[aria-label="Rule on: x-env"]')).not.toBeNull();
    expect(line.textContent).not.toContain("Requests started by other pages");
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
    expect(root.querySelector(".change-line.doubt")).not.toBeNull();
    expect(root.querySelector(".status")?.textContent).toBe(
      "2 changes on this tab",
    );
    expect(root.querySelector(".lamp.doubt")).not.toBeNull();
    expect(root.querySelector(".lamp.live")).toBeNull();
  });

  it("does not count an h1-only rule as running and states its caveat", async () => {
    const { root } = await mount(
      seededDoc([rule({ header: "connection", value: "keep-alive" })]),
      true,
    );
    const line = expectWarningCaveat(root, copy.advisories.h1Only);
    expect(root.querySelector(".status")?.textContent).toBe(
      "0 of 1 change running on this tab",
    );
    expect(root.querySelector(".substatus .amber")?.textContent).toBe(
      copy.readout.transport(1),
    );
    expect(root.querySelector(".lamp.warn")).not.toBeNull();
    expect(line.querySelector('[role="switch"]')?.className).toBe("sw");
  });

  it("states the value condition on an h2-breaking rule", async () => {
    const { root } = await mount(
      seededDoc([rule({ header: "te", value: "trailers" })]),
      true,
    );
    expectWarningCaveat(root, copy.advisories.te);
    expect(root.querySelector(".substatus .amber")?.textContent).toBe(
      copy.readout.transport(1),
    );
  });

  // A rule Chrome settles per request AND whose header carries a transport
  // caveat states both facts: the line still carries the header's HTTP/2
  // behavior, and the headline counts it as decided per request rather than
  // asserting an effect ("takes effect on HTTP/1.1") for a rule that may
  // never match at all.
  it("states both facts for a match-undecided rule with a transport caveat", async () => {
    const { root } = await mount(
      seededDoc([
        rule({
          header: "connection",
          value: "keep-alive",
          scope: {
            type: "pattern",
            pattern: "||api.example.com/",
            hosts: ["api.example.com"],
          },
        }),
      ]),
      true,
    );
    expectWarningCaveat(root, copy.advisories.h1Only);
    expect(root.querySelector(".status")?.textContent).toBe(
      "1 change on this tab",
    );
    expect(root.querySelector(".substatus .rest")?.textContent).toBe(
      copy.readout.unconfirmed(1),
    );
    expect(root.querySelector(".substatus .amber")).toBeNull();
  });

  it("does not project an out-of-sync ruleset", async () => {
    const doc = seededDoc([rule()]);
    await write(doc);
    await setAppliedRevision({ dynamic: "different", session: "different" });
    const root = render(<App />);
    await settle();
    expect(root.querySelector(".popup")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(root.querySelector(".change-line")).not.toBeNull();
    expect(root.textContent).toContain(copy.readout.outOfSync);
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
    // The visible masked value is hidden from assistive tech, which instead
    // hears one honest name saying the middle is withheld, so the two cleartext
    // fragments ("Bearer" + "wxyz") are never read back as a whole credential.
    expect(
      (token.querySelector(".tk-val") as HTMLElement).getAttribute(
        "aria-hidden",
      ),
    ).toBe("true");
    expect(token.querySelector(".sr-only")?.textContent).toBe(
      "Bearer credential, hidden, ending in wxyz",
    );
    // The opaque token draws no countdown it would have to invent.
    expect(token.querySelector(".fresh-track")).toBeNull();
    expect(token.textContent).toContain(copy.token.opaque);
    // Never repeated as a plain request line.
    expect(root.querySelectorAll(".change-line")).toHaveLength(0);
  });

  it("keeps a credential rule's wider reach in the hero", async () => {
    const { root } = await mount(
      seededDoc([
        rule({
          header: "authorization",
          value: SWAP_FROM,
          scope: { type: "all" },
        }),
      ]),
      true,
    );

    expect(root.querySelector(".token")?.textContent).toContain(
      copy.readout.widerReach.broad,
    );
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
    // No share of a life is left, so no bar is drawn to report one: an empty
    // track still reads as a track.
    expect(root.querySelector(".fresh-track")).toBeNull();
  });

  // Pause reaches every line in words. The hero is the one change carrying a
  // live credential, and a dimmed card beside a working Replace button says
  // nothing on its own about whether the header is going out.
  it("says the hero credential is held while header changes are paused", async () => {
    const { root } = await mount(
      { ...tokenDoc(), settings: { ...tokenDoc().settings, paused: true } },
      true,
    );
    expect(root.querySelector(".token .tk-held")?.textContent).toBe(
      copy.token.held,
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
    expect(root.querySelector(".tk-swaptarget")).toBeNull();
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

  it("does not replace a token with an empty value", async () => {
    const { root } = await mount(tokenDoc(), true);
    const field = openTokenSwap(root);
    const replace = root.querySelector(
      ".swapfield .btn.primary",
    ) as HTMLButtonElement;

    expect(replace.disabled).toBe(true);
    press(field, "Enter");
    await settle();
    expect((await read()).profiles[0]?.rules[0]?.value).toBe(SWAP_FROM);
    expect(root.querySelector(".swapfield input")).not.toBeNull();
  });

  it("reports a token swap that cannot reach the current store", async () => {
    const { root } = await mount(tokenDoc(), true);
    const field = openTokenSwap(root);
    typeInto(field, SWAP_TO);
    const get = vi
      .spyOn(fakeBrowser.storage.local, "get")
      .mockImplementationOnce(
        async (): Promise<{ state: { v: number } }> => ({ state: { v: 9 } }),
      );

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

  it("reports a rejected rule toggle", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    vi.spyOn(fakeBrowser.storage.local, "set").mockRejectedValueOnce(
      new Error("rejected"),
    );

    await act(async () => {
      (
        root.querySelector('[aria-label="Rule on: x-env"]') as HTMLButtonElement
      ).click();
    });
    await settle();

    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.errors.saveFailed,
    );
  });

  it("keeps the last disabled rule visible and focused for re-enabling", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    const disable = root.querySelector<HTMLButtonElement>(
      '[aria-label="Rule on: x-env"]',
    );
    if (disable === null) throw new Error("missing rule toggle");
    disable.focus();
    await act(async () => disable.click());
    await settle();

    const enable = root.querySelector<HTMLButtonElement>(
      '[aria-label="Rule off: x-env"]',
    );
    expect(root.querySelector(".status")?.textContent).toBe(
      "0 of 1 change running on this tab",
    );
    expect(root.querySelector(".empty")).toBeNull();
    expect(root.querySelector(".change-line.rest")).not.toBeNull();
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
    expect(line.classList.contains("amber")).toBe(true);
    expect(root.querySelector(".substatus .amber")?.textContent).toBe(
      "1 more needs access",
    );
    expect(root.querySelector(".global-access")?.textContent).toBe(
      copy.readout.globalNeedsAccess,
    );
    expect(root.querySelector(".lamp.warn")).not.toBeNull();
    expect(status().textContent).toBe("0 of 1 change running on this tab");
    expect(line.querySelector(".why.amber")?.textContent).toBe(
      copy.readout.needsAccessReason(false),
    );
    expect(line.textContent).not.toContain("until you close the tab");
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

  it("labels the all-sites action when a hostless rule needs broad access", async () => {
    const { root } = await mount(
      seededDoc([
        rule({
          scope: { type: "pattern", pattern: "||example.com^", hosts: [] },
        }),
      ]),
    );
    const line = root.querySelector(".change-line") as HTMLElement;
    expect(line.classList.contains("amber")).toBe(true);
    const grant = root.querySelector(
      ".change-line .grant",
    ) as HTMLButtonElement;
    expect(grant.textContent).toBe(copy.readout.grantAllSites);
  });

  it("states the Host transport caveat without counting it as running", async () => {
    const { root } = await mount(
      seededDoc([rule({ header: "host", value: "internal.example.com" })]),
      true,
    );
    const line = root.querySelector(".change-line.amber");
    expect(line?.querySelector(".why.amber")?.textContent).toContain(
      copy.advisories.host,
    );
    expect(root.querySelector(".substatus .stop")).toBeNull();
    expect(root.querySelector(".substatus .amber")?.textContent).toBe(
      copy.readout.transport(1),
    );
    expect(root.querySelector(".status")?.textContent).toBe(
      "0 of 1 change running on this tab",
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
      line.classList.contains("rest"),
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
    expect(root.textContent).toContain("x-env");
    expect(root.textContent).toContain(copy.rules.editValueHint);
    typeInto(input, "production");
    press(input, "Enter");
    await settle();
    expect((await read()).profiles[0]?.rules[0]?.value).toBe("production");
  });

  it("reports a rejected inline value edit", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    fire(() => (root.querySelector(".v-edit") as HTMLButtonElement).click());
    const input = root.querySelector(".v-input") as HTMLInputElement;
    vi.spyOn(fakeBrowser.storage.local, "set").mockRejectedValueOnce(
      new Error("rejected"),
    );

    typeInto(input, "production");
    press(input, "Enter");
    await settle();

    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.errors.saveFailed,
    );
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
    press(input, "Enter");
    await settle();
    expect((await read()).profiles[0]?.rules[0]?.value).toBe("sk_live_secret");
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

  // While paused the banner above states the cause once, so the empty state
  // drops the site-shaped sentence rather than restate a global condition as a
  // fact about this site. The one action stays.
  it("drops the site line while paused and lets the banner carry the cause", async () => {
    const seed = createV1Seed();
    const { root } = await mount(
      { ...seed, settings: { ...seed.settings, paused: true } },
      true,
    );
    expect(root.querySelector(".pausebar")).not.toBeNull();
    expect(root.querySelector(".empty .l1")).toBeNull();
    expect(root.textContent).not.toContain("isn't changing anything on");
    expect(root.querySelector(".empty .add")?.textContent).toContain(
      copy.readout.addChange,
    );
  });

  // A tab with no site to read says why the screen is empty, and offers the one
  // thing still worth opening from here rather than asking for what the reader
  // has already done.
  it("says why there is nothing to change and offers the rule list", async () => {
    const { activeTabOrigin } = await import("../platform/tabs");
    vi.mocked(activeTabOrigin).mockResolvedValueOnce(undefined);
    const { root } = await mount(createV1Seed(), true);
    expect(root.querySelector(".empty")?.textContent).toContain(
      "this tab is not on one",
    );
    expect(root.querySelector(".empty .add")?.textContent).toContain(
      "See all rules",
    );
    expect(root.querySelector(".tab-btn")).toBeNull();
  });

  // The head's site slot names the site this tab is on, in the face reserved for
  // literal wire bytes. A tab with no site says so in a muted marker rather than
  // sitting empty; the marker is plain furniture, never the wire-byte host face,
  // so it never reads as a site of its own.
  it("marks the site slot as siteless rather than naming a site", async () => {
    const { activeTabOrigin } = await import("../platform/tabs");
    vi.mocked(activeTabOrigin).mockResolvedValueOnce(undefined);
    const { root } = await mount(createV1Seed(), true);
    expect(root.querySelector(".site .no-site")?.textContent).toBe(
      copy.readout.noSite,
    );
    expect(root.querySelector(".site .host")).toBeNull();
  });

  it("names the master switch by what it controls and reads its state like every switch here", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    const master = root.querySelector(
      '.foot [aria-label="All header changes"]',
    ) as HTMLButtonElement;
    const ruleSwitch = root.querySelector(
      '[aria-label="Rule on: x-env"]',
    ) as HTMLButtonElement;
    // A bare knob shows no visible word, so its hover name has to carry what it
    // controls, not the state its position and aria-checked already give.
    expect(master.getAttribute("title")).toBe("All header changes");
    // Running reads checked on both, so the two switches cannot show the same
    // fact with opposite knobs.
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
    // Colour is not the state. The count stays and says what it is counting, and
    // a held line says what it would do rather than claiming to be doing it.
    expect(root.querySelector(".status")?.textContent).toBe(
      "1 change held on this tab",
    );
    expect(root.querySelector(".change-line.paused .verb")?.textContent).toBe(
      "Would set",
    );
    await act(async () => pause.click());
    await settle();
    expect((await read()).settings.paused).toBe(false);
  });

  it("keeps an ungranted reason actionable while paused", async () => {
    const seed = seededDoc([rule()]);
    const { root } = await mount(
      { ...seed, settings: { ...seed.settings, paused: true } },
      false,
    );

    const line = root.querySelector(".change-line.amber") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.classList.contains("paused")).toBe(false);
    expect(line.querySelector(".verb")?.textContent).toBe("Would set");
    expect(line.querySelector(".grant")).not.toBeNull();
    expect(line.querySelector('[role="switch"]')).toBeNull();
    expect(root.querySelector(".status")?.textContent).toBe(
      "0 of 1 change held on this tab",
    );
    expect(root.querySelector(".lamp.held")).not.toBeNull();
  });

  it("opens options from the footer gear", async () => {
    const open = vi.spyOn(fakeBrowser.tabs, "create");
    const { root } = await mount(createV1Seed(), true);
    fire(() =>
      (
        root.querySelector('.foot [aria-label="Options"]') as HTMLButtonElement
      ).click(),
    );
    await settle();
    expect(open).toHaveBeenCalledExactlyOnceWith({
      url: fakeBrowser.runtime.getURL("/options.html#about"),
    });
  });
});

describe("popup profile switch", () => {
  const withSecond = (): StateDoc => ({
    ...seededDoc(
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
    ),
    // Prod read-only is the profile last switched away from, so it is the one
    // the shortcut would flip back to.
    previousProfileId: "p2",
  });

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

  it("names the shortcut's switch consequence on the closed chip", async () => {
    const { root } = await mount(withSecond(), true);
    // The menu is shut: the answer is on the chip, not behind opening it.
    expect(root.querySelector(".pop")).toBeNull();
    const hint = (root.querySelector(".prof") as HTMLButtonElement).title;
    expect(hint).toContain("If you switch to Prod read-only");
    expect(hint).toContain("x-read-only");
    expect(hint).toContain("x-env");
  });

  it("prints the profile shortcut key on the row it would flip to", async () => {
    const { root } = await mount(withSecond(), true);
    const target = openPickerTarget(root);
    expect(target.querySelector(".kbd")?.textContent).toBe("⌥⇧K");
    // The active profile is not the flip target, so it wears the check, not the
    // accelerator.
    const current = root.querySelector(".popt.sel");
    expect(current?.querySelector(".kbd")).toBeNull();
    expect(current?.querySelector(".chk")).not.toBeNull();
  });

  it("commits a new profile name when a click outside dismisses the menu", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    const input = await openNewProfileName(root);
    typeInto(input, "QA headers");
    // A pointerdown outside light-dismisses the menu; the typed name commits on
    // the way out, the way it does when the Options rename loses focus.
    fire(() =>
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    await settle();

    expect(root.querySelector(".pop")).toBeNull();
    expect((await read()).profiles[1]?.name).toBe("QA headers");
  });

  it("names the commit keys beside the rename field", async () => {
    const { root } = await mount(seededDoc([rule()]), true);
    const input = await openNewProfileName(root);
    const hintId = input.getAttribute("aria-describedby");
    if (hintId === null) throw new Error("rename field names no commit keys");
    expect(root.querySelector(`#${hintId}`)?.textContent).toBe(
      copy.options.profiles.renameHint,
    );
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
      .mockImplementationOnce(
        async (): Promise<{ state: StateDoc }> => ({
          state: {
            ...stored,
            profiles: [first],
            activeProfileId: first.id,
          },
        }),
      );

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
    const updated = await read();
    expect(updated.profiles).toHaveLength(2);
    expect(root.querySelector(".profile-name-input")).toBeNull();
    expect(updated.activeProfileId).toBe(updated.profiles[1]?.id);
    expect(current?.querySelector(".nm")?.textContent).toBe(
      updated.profiles[1]?.name,
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

  // Opening the form must not drop the pause context: a rule authored here is
  // inert until the extension resumes, so the banner rides into the editor too.
  it("keeps the pause banner while the rule editor is open", async () => {
    const seed = seededDoc([rule()]);
    const { root } = await mount(
      { ...seed, settings: { ...seed.settings, paused: true } },
      true,
    );
    press(root.querySelector(".popup") as HTMLElement, "n");
    await settle();
    expect(root.querySelector(".rule-editor")).not.toBeNull();
    expect(root.querySelector(".pausebar")).not.toBeNull();
  });

  it("confirms a rule was created without certifying its live outcome", async () => {
    const { root } = await mount(tokenDoc(), true);
    press(root.querySelector(".popup") as HTMLElement, "n");
    await settle();
    typeInto(
      root.querySelector('[role="combobox"]') as HTMLInputElement,
      "authorization",
    );
    typeInto(
      root.querySelector(".value-row textarea") as HTMLTextAreaElement,
      "Bearer duplicate",
    );
    fire(() =>
      (
        root.querySelector(".editor-actions .primary") as HTMLButtonElement
      ).click(),
    );
    await settle();
    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.toast.ruleCreated,
    );
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

  // The popup opens under a keystroke and users keep typing into it, so a key
  // struck the instant the readout lands has to be heard rather than dropped
  // with nothing to say why. The switcher chip is the head control the readout
  // always draws, and the run that paints it is the run that binds the commands.
  it("hears a command key struck the instant the readout head lands", async () => {
    await write(seededDoc([rule()]));
    await followCurrentBatch();
    const heard = atPaint(
      () => document.querySelector(".prof") !== null,
      () => {
        const event = new KeyboardEvent("keydown", {
          key: "n",
          bubbles: true,
          cancelable: true,
        });
        document.body.dispatchEvent(event);
        return event.defaultPrevented;
      },
    );

    paint(<App />);
    expect(await heard).toBe(true);
  });
});

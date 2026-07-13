// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../entrypoints/options/App";
import type { Profile, Rule } from "../core/model";
import { read, write } from "../platform/store";
import { copy } from "../ui/copy";
import {
  profile,
  resetFixtures,
  rule,
  rules,
  stateDoc,
} from "../ui/test/fixtures";
import { fire, press, render, settle, typeInto } from "../ui/test/render";

async function seed(
  profiles: Profile[],
  focusedProfileId = profiles[0]?.id ?? "",
): Promise<void> {
  await write(stateDoc(profiles, { focusedProfileId }));
}

async function mount() {
  const root = render(<App />);
  await settle();
  return root;
}

function cards(root: HTMLElement): HTMLLIElement[] {
  return [...root.querySelectorAll<HTMLLIElement>(".profile-card")];
}

function cardNames(root: HTMLElement): (string | null)[] {
  return cards(root).map(
    (card) =>
      card.querySelector(".profile-name")?.textContent ??
      card.querySelector<HTMLInputElement>(".profile-name-input")?.value ??
      null,
  );
}

function findButton(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === text,
  );
  if (button === undefined) {
    throw new Error(`no button labeled "${text}"`);
  }
  return button;
}

function openCard(root: HTMLElement, index: number): void {
  fire(() =>
    cards(root)
      [index]?.querySelector<HTMLButtonElement>(".profile-open")
      ?.click(),
  );
}

function within(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (el === null) {
    throw new Error(`missing ${selector}`);
  }
  return el;
}

/** Opens the card, clicks one of its [Rename][Clone][Delete] actions. */
function cardAction(root: HTMLElement, index: number, label: string): void {
  openCard(root, index);
  fire(() => findButton(within(root, ".profile-actions"), label).click());
}

/** Selects every rule, then runs one bulk toolbar action. */
function bulkAction(root: HTMLElement, label: string): void {
  fire(() =>
    (within(root, ".bulk-select-all input") as HTMLInputElement).click(),
  );
  fire(() => findButton(within(root, ".bulk-actions"), label).click());
}

beforeEach(() => {
  resetFixtures();
  window.location.hash = "";
});

describe("options frame", () => {
  it("renders the wordmark, version, and a four-item section nav", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    expect(root.querySelector(".wordmark")?.textContent).toBe("headershim");
    expect(root.querySelector(".version")?.textContent).toMatch(/^v/);
    const links = [
      ...root.querySelectorAll<HTMLAnchorElement>(".options-nav-link"),
    ];
    expect(links.map((link) => link.textContent)).toEqual([
      copy.options.nav.profiles,
      copy.options.nav.importExport,
      copy.options.nav.siteAccess,
      copy.options.nav.about,
    ]);
    expect(links[0]?.getAttribute("aria-current")).toBe("page");
  });

  it("roves the nav tab stop with vertical arrow keys", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();
    const links = [
      ...root.querySelectorAll<HTMLAnchorElement>(".options-nav-link"),
    ];

    expect(links.map((link) => link.tabIndex)).toEqual([0, -1, -1, -1]);
    press(links[0] as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(links[1]);
    press(links[1] as HTMLElement, "End");
    expect(document.activeElement).toBe(links[3]);
    press(links[3] as HTMLElement, "Home");
    expect(document.activeElement).toBe(links[0]);
  });

  it("stamps the stored theme on the document root", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const doc = await read();
    await write({ ...doc, settings: { ...doc.settings, theme: "dark" } });
    await mount();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("profile lifecycle", () => {
  it("creates a profile and opens it for editing", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    fire(() => findButton(root, copy.options.profiles.new).click());
    await settle();

    expect(cardNames(root)).toEqual(["Default", copy.options.profiles.newName]);
    // The new card is open (its badge editor and actions are showing).
    expect(root.querySelector(".profile-detail")).not.toBeNull();
    expect((await read()).profiles).toHaveLength(2);
  });

  it("renames a profile inline", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    cardAction(root, 0, copy.options.profiles.rename);
    const input = within(root, ".profile-name-input") as HTMLInputElement;
    typeInto(input, "Staging auth");
    press(input, "Enter");
    await settle();

    expect(cardNames(root)).toEqual(["Staging auth"]);
  });

  it("rejects a duplicate name with the taken-name copy", async () => {
    await seed([
      profile("p1", { name: "Default" }),
      profile("p2", { name: "Staging" }),
    ]);
    const root = await mount();

    cardAction(root, 0, copy.options.profiles.rename);
    const input = within(root, ".profile-name-input") as HTMLInputElement;
    typeInto(input, "Staging");
    press(input, "Enter");
    await settle();

    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.options.profiles.nameTaken("Staging"),
    );
    expect((await read()).profiles[0]?.name).toBe("Default");
  });

  it("clones a profile with a ' copy' suffix and fresh rule nums", async () => {
    await seed([
      profile("p1", {
        name: "Auth",
        rules: [rule({ header: "authorization" })],
      }),
    ]);
    const root = await mount();

    cardAction(root, 0, copy.options.profiles.clone);
    await settle();

    expect(cardNames(root)).toContain("Auth copy");
    const stored = await read();
    const [original, clone] = stored.profiles;
    expect(clone?.rules[0]?.header).toBe("authorization");
    expect(clone?.rules[0]?.id).not.toBe(original?.rules[0]?.id);
    expect(clone?.rules[0]?.num).not.toBe(original?.rules[0]?.num);
  });

  it("deletes through a confirm modal, then restores via undo", async () => {
    await seed([
      profile("p1", { name: "Alpha", rules: [rule()] }),
      profile("p2", { name: "Beta" }),
    ]);
    const root = await mount();

    cardAction(root, 0, copy.options.profiles.delete);
    const modal = within(root, ".modal-card");
    expect(modal.querySelector(".modal-title")?.textContent).toBe(
      copy.options.profiles.deleteConfirm.title("Alpha"),
    );
    fire(() =>
      findButton(modal, copy.options.profiles.deleteConfirm.confirm).click(),
    );
    await settle();

    expect(cardNames(root)).toEqual(["Beta"]);
    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.toast.profileDeleted("Alpha"),
    );
    // The deleted card unmounted async; focus lands on the page heading, never
    // <body> (WCAG 2.4.3).
    expect(document.activeElement).toBe(within(root, "#profiles-title"));

    fire(() => findButton(root, copy.actions.undo).click());
    await settle();
    expect(cardNames(root)).toEqual(["Alpha", "Beta"]);
  });

  it("recreates Default when the last profile is deleted", async () => {
    await seed([profile("p1", { name: "Only" })]);
    const root = await mount();

    cardAction(root, 0, copy.options.profiles.delete);
    fire(() =>
      findButton(
        within(root, ".modal-card"),
        copy.options.profiles.deleteConfirm.confirm,
      ).click(),
    );
    await settle();

    expect(cardNames(root)).toEqual(["Default"]);
    expect((await read()).profiles).toHaveLength(1);
  });
});

async function mountThree(): Promise<{
  root: HTMLElement;
  handle: HTMLElement;
}> {
  await seed([
    profile("p1", { name: "Alpha" }),
    profile("p2", { name: "Beta" }),
    profile("p3", { name: "Gamma" }),
  ]);
  const root = await mount();
  return {
    root,
    handle: within(cards(root)[0] as HTMLElement, ".drag-handle"),
  };
}

describe("reorder", () => {
  it("moves a profile with the keyboard and announces the new position", async () => {
    const { root, handle } = await mountThree();
    fire(() => handle.focus());
    press(handle, "ArrowDown");
    await settle();

    expect(cardNames(root)).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(root.querySelector('.sr-only[role="status"]')?.textContent).toBe(
      copy.options.profiles.reordered("Alpha", 2),
    );
  });

  it("reorders on drag-enter over another card", async () => {
    const { root, handle } = await mountThree();
    // happy-dom lacks the ondrag* IDL props, so preact binds these listeners
    // under the case-preserved prop name; the browser uses the lowercase events.
    fire(() => handle.dispatchEvent(new Event("DragStart", { bubbles: true })));
    fire(() =>
      cards(root)[2]?.dispatchEvent(new Event("DragEnter", { bubbles: true })),
    );
    await settle();

    expect(cardNames(root)).toEqual(["Beta", "Gamma", "Alpha"]);

    // Ending the drag clears the pointer so a later hover does not reorder.
    fire(() => handle.dispatchEvent(new Event("DragEnd", { bubbles: true })));
    fire(() =>
      cards(root)[0]?.dispatchEvent(new Event("DragEnter", { bubbles: true })),
    );
    await settle();
    expect(cardNames(root)).toEqual(["Beta", "Gamma", "Alpha"]);
  });
});

describe("badge editor", () => {
  it("commits a colour choice from the swatch radiogroup", async () => {
    await seed([profile("p1", { name: "Default", color: "indigo" })]);
    const root = await mount();
    openCard(root, 0);

    const teal = within(
      root,
      ".badge-swatches",
    ).querySelector<HTMLInputElement>(
      `input[aria-label="${copy.options.badge.colorNames.teal}"]`,
    );
    fire(() => teal?.click());
    await settle();

    expect((await read()).profiles[0]?.color).toBe("teal");
  });

  it("commits badge text on Enter", async () => {
    await seed([profile("p1", { name: "Default", badgeText: "DE" })]);
    const root = await mount();
    openCard(root, 0);

    const input = within(root, ".badge-text-input") as HTMLInputElement;
    typeInto(input, "QA");
    press(input, "Enter");
    await settle();

    expect((await read()).profiles[0]?.badgeText).toBe("QA");
  });
});

describe("bulk rule actions", () => {
  async function mountWithRules(rulesForOpen: Rule[], others: Profile[] = []) {
    await seed(
      [profile("open", { name: "Open", rules: rulesForOpen }), ...others],
      "open",
    );
    return mount();
  }

  it("enables every selected rule in one action", async () => {
    const root = await mountWithRules([
      rule({ enabled: false }),
      rule({ enabled: false }),
    ]);

    bulkAction(root, copy.options.rules.enable);
    await settle();

    expect((await read()).profiles[0]?.rules.every((r) => r.enabled)).toBe(
      true,
    );
  });

  it("deletes a selection and restores it via undo", async () => {
    const root = await mountWithRules([rule(), rule()]);

    bulkAction(root, copy.options.rules.delete);
    await settle();

    expect((await read()).profiles[0]?.rules).toHaveLength(0);
    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.toast.rulesDeleted(2),
    );
    fire(() => findButton(root, copy.actions.undo).click());
    await settle();
    expect((await read()).profiles[0]?.rules).toHaveLength(2);
  });

  it("moves a selection to another profile", async () => {
    const moved = rule({ header: "x-move" });
    const root = await mountWithRules(
      [moved],
      [profile("dest", { name: "Dest" })],
    );

    bulkAction(root, copy.options.rules.move);
    fire(() => findButton(within(root, ".bulk-move-targets"), "Dest").click());
    await settle();

    const stored = await read();
    expect(stored.profiles[0]?.rules).toHaveLength(0);
    expect(stored.profiles[1]?.rules[0]?.header).toBe("x-move");
    // Picking a move target unmounted its button; focus lands on the panel
    // heading, never <body> (WCAG 2.4.3).
    expect(document.activeElement).toBe(within(root, ".rules-panel-label"));
  });

  it("blocks a bulk-enable that crosses the 4,500 cap with the section-8 copy", async () => {
    const disabled = rule({ enabled: false });
    const root = await mountWithRules(
      [disabled],
      [profile("big", { name: "Big", rules: rules(4_500) })],
    );

    bulkAction(root, copy.options.rules.enable);
    await settle();

    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.errors.ruleCap,
    );
    expect((await read()).profiles[0]?.rules[0]?.enabled).toBe(false);
  });

  it("allows the enable that lands exactly on the 4,500 boundary", async () => {
    const disabled = rule({ enabled: false });
    const root = await mountWithRules(
      [disabled],
      [profile("big", { name: "Big", rules: rules(4_499) })],
    );

    bulkAction(root, copy.options.rules.enable);
    await settle();

    expect(root.querySelector(".toast-msg")).toBeNull();
    expect((await read()).profiles[0]?.rules[0]?.enabled).toBe(true);
  });
});

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/options/App";
import type { Profile } from "../core/model";
import { read, write } from "../platform/store";
import { copy } from "../ui/copy";
import { profile, resetFixtures, rule, stateDoc } from "../ui/test/fixtures";
import { fire, press, render, settle, typeInto } from "../ui/test/render";

async function seed(
  profiles: Profile[],
  activeProfileId = profiles[0]?.id ?? "",
): Promise<void> {
  await write(stateDoc(profiles, { activeProfileId }));
}

async function mount(hash = "#profiles") {
  window.location.hash = hash;
  const root = render(<App />);
  await settle();
  return root;
}

async function navigate(hash: string): Promise<void> {
  window.location.hash = hash;
  fire(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  await settle();
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

async function openBadgeText(badgeText: string): Promise<{
  root: HTMLElement;
  input: HTMLInputElement;
}> {
  await seed([profile("p1", { name: "Default", badgeText })]);
  const root = await mount();
  openCard(root, 0);
  return { root, input: within(root, ".badge-text-input") as HTMLInputElement };
}

function within(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (el === null) {
    throw new Error(`missing ${selector}`);
  }
  return el;
}

async function mountTwoProfiles(): Promise<HTMLElement> {
  await seed([
    profile("p1", { name: "Alpha" }),
    profile("p2", { name: "Beta" }),
  ]);
  return mount();
}

async function activateSecondProfile(root: HTMLElement): Promise<void> {
  const beta = cards(root)[1];
  if (beta === undefined) throw new Error("missing second profile");
  fire(() => within(beta, ".profile-activate input").click());
  await settle();
}

function confirmDeleteModal(root: HTMLElement): void {
  fire(() =>
    findButton(
      within(root, ".modal-card"),
      copy.options.profiles.deleteConfirm.confirm,
    ).click(),
  );
}

/** Opens the card, clicks one of its [Rename][Clone][Delete] actions. */
function cardAction(root: HTMLElement, index: number, label: string): void {
  openCard(root, index);
  fire(() => findButton(within(root, ".profile-actions"), label).click());
}

/** Opens the first card's inline rename and returns its field. */
function openRename(root: HTMLElement): HTMLInputElement {
  cardAction(root, 0, copy.options.profiles.rename);
  return within(root, ".profile-name-input") as HTMLInputElement;
}

beforeEach(() => {
  resetFixtures();
  window.location.hash = "";
});

describe("workbench frame", () => {
  it("renders the wordmark, version, and full navigation", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount("");

    expect(root.querySelector(".wordmark")?.textContent).toBe("HeaderShim");
    expect(root.querySelector(".wb-version")?.textContent).toMatch(/^v/);
    const links = [...root.querySelectorAll<HTMLAnchorElement>(".wb-nav-link")];
    expect(links.map((link) => link.textContent)).toEqual([
      copy.options.nav.allRules,
      copy.options.nav.profiles,
      copy.options.nav.siteAccess,
      copy.options.nav.traffic,
      copy.options.nav.importExport,
      copy.options.nav.settings,
      copy.options.nav.about,
    ]);
    // The default route is the fleet; its nav link carries the marker.
    expect(links[0]?.getAttribute("aria-current")).toBe("page");
  });

  it("roves the nav tab stop with vertical arrow keys", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount("");
    const links = [...root.querySelectorAll<HTMLAnchorElement>(".wb-nav-link")];

    expect(links.map((link) => link.tabIndex)).toEqual([
      0, -1, -1, -1, -1, -1, -1,
    ]);
    press(links[0] as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(links[1]);
    press(links[1] as HTMLElement, "End");
    expect(document.activeElement).toBe(links[links.length - 1]);
    press(links[links.length - 1] as HTMLElement, "Home");
    expect(document.activeElement).toBe(links[0]);
  });

  it("moves focus to the section heading after hash navigation", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount("");

    await navigate("#settings");
    await vi.waitFor(() => {
      if (root.querySelector("#settings-title") === null) {
        throw new Error("settings page is still loading");
      }
    });

    expect(document.activeElement).toBe(within(root, "#settings-title"));
  });

  it("leaves existing focus alone on initial load", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await seed([profile("p1", { name: "Default" })]);

    await mount("");

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("stamps the stored theme on the document root", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const doc = await read();
    await write({ ...doc, settings: { ...doc.settings, theme: "dark" } });
    await mount("");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("profile lifecycle", () => {
  it("creates a profile and opens it for editing", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    const create = findButton(root, copy.options.profiles.newProfile);
    expect(create.className).toBe("btn primary");
    fire(() => create.click());
    await settle();

    expect(cardNames(root)).toEqual(["Default", copy.options.profiles.newName]);
    // The new card is open (its badge editor and actions are showing).
    expect(root.querySelector(".profile-detail")).not.toBeNull();
    expect((await read()).profiles).toHaveLength(2);
  });

  it("names the commit keys beside the rename field", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    const input = openRename(root);
    const hintId = input.getAttribute("aria-describedby");
    if (hintId === null) throw new Error("rename field names no commit keys");
    expect(within(root, `#${hintId}`).textContent).toBe(
      copy.options.profiles.renameHint,
    );
  });

  it("renames a profile inline", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    const input = openRename(root);
    // The name field carries no silent length cap (maxLength absent reads -1).
    expect(input.maxLength).toBe(-1);
    typeInto(input, "Staging auth");
    press(input, "Enter");
    await settle();

    expect(cardNames(root)).toEqual(["Staging auth"]);
  });

  it("commits a rename when the field loses focus without Enter", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    const input = openRename(root);
    typeInto(input, "Staging auth");
    fire(() => input.dispatchEvent(new FocusEvent("blur")));
    await settle();

    expect(root.querySelector(".profile-name-input")).toBeNull();
    expect((await read()).profiles[0]?.name).toBe("Staging auth");
  });

  // A rename re-derives the badge of a profile still wearing its name's initials.
  // The editor's field follows the profile while it is not being edited, so the
  // row head and the badge below it show the re-derived badge, not the one the
  // field was seeded with before the rename landed.
  it("follows a rename in the badge preview and the field", async () => {
    await seed([profile("p1", { name: "Default", badgeText: "DE" })]);
    const root = await mount();

    const nameInput = openRename(root);
    typeInto(nameInput, "Staging auth");
    press(nameInput, "Enter");
    await settle();

    expect((await read()).profiles[0]?.badgeText).toBe("ST");
    const badgeInput = within(root, ".badge-text-input") as HTMLInputElement;
    expect(badgeInput.value).toBe("ST");
    expect(within(root, ".badge-preview").textContent).toBe("ST");
  });

  it("rejects a duplicate name with the taken-name copy", async () => {
    await seed([
      profile("p1", { name: "Default" }),
      profile("p2", { name: "Staging" }),
    ]);
    const root = await mount();

    const input = openRename(root);
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
    // The confirm reads as destructive, never byte-identical to the Cancel
    // beside it (the shared quiet skin was the defect).
    const confirm = findButton(
      modal,
      copy.options.profiles.deleteConfirm.confirm,
    );
    expect(confirm.className).toBe("btn destructive");
    expect(confirm.className).not.toBe(
      findButton(modal, copy.actions.cancel).className,
    );
    confirmDeleteModal(root);
    await settle();

    expect(cardNames(root)).toEqual(["Beta"]);
    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.toast.profileDeleted("Alpha"),
    );
    // The deleted card unmounted async; focus lands on the page heading, never
    // <body> (WCAG 2.4.3).
    expect(document.activeElement).toBe(within(root, "#profiles-title"));

    expect(root.querySelector('.sr-only[role="status"]')?.textContent).toBe(
      copy.toast.profileDeleted("Alpha"),
    );

    fire(() => findButton(root, copy.actions.undo).click());
    await settle();
    expect(cardNames(root)).toEqual(["Alpha", "Beta"]);
    // Undo restores Alpha, so the announcement that it was deleted stops being
    // true and is retracted rather than left asserted to a screen reader.
    expect(root.querySelector(".toast-msg")).toBeNull();
    expect(root.querySelector('.sr-only[role="status"]')?.textContent).toBe("");
  });

  it("does not offer to delete rules a profile does not have", async () => {
    await seed([profile("p1", { name: "Empty" }), profile("p2")]);
    const root = await mount();

    cardAction(root, 0, copy.options.profiles.delete);
    const body = within(root, ".modal-text").textContent;
    expect(body).not.toContain("will be deleted");
    expect(body).toContain("Site grants are not changed");
  });

  it("retires the whole delete confirmation when a later mutation supersedes it", async () => {
    const root = await mountTwoProfiles();

    cardAction(root, 0, copy.options.profiles.delete);
    confirmDeleteModal(root);
    await settle();
    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.toast.profileDeleted("Alpha"),
    );

    // Creating another profile is a fresh mutation: the whole confirmation goes,
    // not just its Undo, so a sentence about a deleted profile cannot linger
    // above a list a new profile now sits in.
    fire(() => findButton(root, copy.options.profiles.newProfile).click());
    await settle();
    expect(root.querySelector(".toast-msg")).toBeNull();
  });

  it("recreates Default when the last profile is deleted", async () => {
    await seed([profile("p1", { name: "Only" })]);
    const root = await mount();

    cardAction(root, 0, copy.options.profiles.delete);
    confirmDeleteModal(root);
    await settle();

    expect(cardNames(root)).toEqual(["Default"]);
    expect((await read()).profiles).toHaveLength(1);
    // The remaining Default is the replacement, not a delete that failed: the
    // toast has to say so, or it reads as a no-op with a stray same-named row.
    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.toast.lastProfileDeleted("Only"),
    );
  });
});

describe("profile activation", () => {
  it("switches with one active id and no per-profile liveness bits", async () => {
    const root = await mountTwoProfiles();
    await activateSecondProfile(root);

    const stored = await read();
    expect(stored.activeProfileId).toBe("p2");
    for (const candidate of stored.profiles) {
      expect(candidate).not.toHaveProperty("enabled");
    }
  });

  // Activating another profile (in the wild, a switch from the popup) must not
  // move the expansion off the card the user is reading.
  it("leaves the open detail panel on the card the user opened", async () => {
    const root = await mountTwoProfiles();
    openCard(root, 0);
    await activateSecondProfile(root);

    const [alphaAfter, betaAfter] = cards(root);
    expect(alphaAfter?.classList.contains("open")).toBe(true);
    expect(alphaAfter?.querySelector(".profile-detail")).not.toBeNull();
    expect(betaAfter?.classList.contains("open")).toBe(false);
    expect(betaAfter?.querySelector(".profile-detail")).toBeNull();
  });

  // A section round trip remounts the page; the expansion stays the user's open,
  // not re-seeded from the active profile.
  it("does not re-expand the active profile after a section round trip", async () => {
    const root = await mountTwoProfiles();
    openCard(root, 1);
    expect(cards(root)[1]?.classList.contains("open")).toBe(true);

    await navigate("#rules");
    await navigate("#profiles");

    expect(cards(root)[0]?.classList.contains("open")).toBe(false);
  });

  it("selecting the active profile again is a no-op that keeps it active", async () => {
    const root = await mountTwoProfiles();
    openCard(root, 0);
    const alpha = cards(root)[0];
    if (alpha === undefined) throw new Error("missing first profile");

    fire(() => within(alpha, ".profile-activate input").click());
    await settle();

    expect((await read()).activeProfileId).toBe("p1");
    expect(alpha.classList.contains("open")).toBe(true);
    expect(alpha.querySelector(".profile-detail")).not.toBeNull();
  });
});

async function seedPaused(profiles: Profile[]): Promise<void> {
  await write(
    stateDoc(profiles, { settings: { paused: true, theme: "system" } }),
  );
}

describe("paused", () => {
  it("states the pause once in the shell so the Profiles section inherits it", async () => {
    await seedPaused([profile("p1", { name: "Default" })]);
    const root = await mount("#profiles");
    expect(root.querySelector(".pausebar")?.textContent).toContain(
      "Everything paused",
    );
  });

  it("wears the held hue on the active profile's dot, not the live one", async () => {
    await seedPaused([profile("p1", { name: "Default" })]);
    const root = await mount("#profiles");
    expect(root.querySelector(".profile-list.paused")).not.toBeNull();
  });

  it("keeps the dot live while running", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount("#profiles");
    expect(root.querySelector(".profile-list")).not.toBeNull();
    expect(root.querySelector(".profile-list.paused")).toBeNull();
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
    expect(teal?.checked).toBe(true);
    expect(teal?.closest(".badge-swatch")).not.toBeNull();
  });

  // Typing commits with no blur and no Enter, and the preview reads the same
  // value, so a card torn down mid-edit keeps the text and the field never
  // shows a badge the profile will not carry. The two-character cap is the
  // browser's own (maxLength), exercised in the browser by e2e/specs/badge.
  it("commits badge text as you type, and the preview follows it", async () => {
    const { root, input } = await openBadgeText("DE");
    typeInto(input, "QA");
    await settle();

    expect((await read()).profiles[0]?.badgeText).toBe("QA");
    expect(within(root, ".badge-preview").textContent).toBe("QA");
  });
});

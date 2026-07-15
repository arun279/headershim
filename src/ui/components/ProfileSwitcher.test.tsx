// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../../core/model";
import { fire, press, render, settle, typeInto } from "../test/render";
import { type ProfileCommitOutcome, ProfileSwitcher } from "./ProfileSwitcher";

function profile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    name: id,
    badgeText: id.slice(0, 2).toUpperCase(),
    color: "teal",
    enabled: true,
    rules: [],
    ...overrides,
  };
}

const three = [
  profile("staging", { name: "Staging auth", badgeText: "SA" }),
  profile("cors", { name: "CORS dev", badgeText: "CD" }),
  profile("qa", { name: "QA roles", badgeText: "QA", enabled: false }),
];

const ok = async (): Promise<ProfileCommitOutcome> => ({ ok: true });

function mount(overrides: Partial<Parameters<typeof ProfileSwitcher>[0]> = {}) {
  const onActivate = overrides.onActivate ?? vi.fn();
  const onCreate = overrides.onCreate ?? vi.fn(ok);
  const onRename = overrides.onRename ?? vi.fn(ok);
  const onEnable = overrides.onEnable ?? vi.fn(ok);
  const onManageProfiles = overrides.onManageProfiles ?? vi.fn();
  const root = render(
    <ProfileSwitcher
      profiles={overrides.profiles ?? three}
      focusedProfileId={overrides.focusedProfileId ?? "staging"}
      newProfileName={overrides.newProfileName ?? "New profile"}
      onActivate={onActivate}
      onCreate={onCreate}
      onRename={onRename}
      onEnable={onEnable}
      onManageProfiles={onManageProfiles}
      {...(overrides.autoFocus === undefined
        ? {}
        : { autoFocus: overrides.autoFocus })}
    />,
  );
  const chips = [...root.querySelectorAll<HTMLButtonElement>(".chip")];
  const menus = [
    ...root.querySelectorAll<HTMLButtonElement>(".profile-menu-trigger"),
  ];
  return {
    root,
    chips,
    menus,
    onActivate,
    onCreate,
    onRename,
    onEnable,
    onManageProfiles,
  };
}

describe("ProfileSwitcher", () => {
  it("labels the chip row, state, badge, and disabled tag without relying on color", () => {
    const { root, chips } = mount();
    expect(root.querySelector("nav")?.getAttribute("aria-label")).toBe(
      "Profiles",
    );
    expect(chips).toHaveLength(3);
    expect(
      chips[0]?.querySelector(".chip-badge")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(chips[0]?.querySelector(".chip-badge")?.textContent).toBe("SA");
    expect(chips[0]?.getAttribute("aria-current")).toBe("true");
    expect(chips[0]?.querySelector(".sr-only")?.textContent).toBe(
      ", focused, on",
    );
    expect(chips[1]?.querySelector(".sr-only")?.textContent).toBe(", on");
    expect(chips[2]?.querySelector(".sr-only")?.textContent).toBe(", off");
    expect(chips[2]?.querySelector(".silk")?.textContent).toBe("off");
  });

  it("always switches exclusively on click, including Shift+click", () => {
    const { chips, onActivate } = mount();
    fire(() =>
      chips[2]?.dispatchEvent(
        new MouseEvent("click", { shiftKey: true, bubbles: true }),
      ),
    );
    expect(onActivate).toHaveBeenCalledWith("qa");
  });

  it("roves the profile-chip tab stop with arrow keys", () => {
    const { chips } = mount();
    expect(chips.map((chip) => chip.tabIndex)).toEqual([0, -1, -1]);

    press(chips[0] as HTMLButtonElement, "ArrowRight");
    expect(chips.map((chip) => chip.tabIndex)).toEqual([-1, 0, -1]);
    expect(document.activeElement).toBe(chips[1]);

    press(chips[1] as HTMLButtonElement, "End");
    expect(document.activeElement).toBe(chips[2]);
    press(chips[2] as HTMLButtonElement, "ArrowRight");
    expect(document.activeElement).toBe(chips[2]);
    press(chips[2] as HTMLButtonElement, "Home");
    expect(document.activeElement).toBe(chips[0]);
  });

  it("focuses the focused profile only when mount autofocus is requested", () => {
    const focused = mount({ autoFocus: true });
    expect(document.activeElement).toBe(focused.chips[0]);
  });

  it("creates from the trailing chip with the suggested name and duplicate choice", async () => {
    const { root, onCreate } = mount({ newProfileName: "New profile 3" });
    const trigger = root.querySelector(
      '[aria-label="New profile"]',
    ) as HTMLButtonElement;
    expect(trigger.title).toBe("New profile");
    fire(() => trigger.click());

    const popover = root.querySelector(".profile-create-pop") as HTMLElement;
    expect(popover.getAttribute("popover")).toBe("manual");
    const name = popover.querySelector(
      ".profile-name-field",
    ) as HTMLInputElement;
    expect(name.value).toBe("New profile 3");
    expect(document.activeElement).toBe(name);

    typeInto(name, "Preview");
    fire(() =>
      (
        popover.querySelector('input[type="checkbox"]') as HTMLInputElement
      ).click(),
    );
    fire(() =>
      (
        popover.querySelector('button[type="submit"]') as HTMLButtonElement
      ).click(),
    );
    await settle();

    expect(onCreate).toHaveBeenCalledWith("Preview", true);
    expect(root.querySelector(".profile-create-pop")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("traps focus in create, closes on Escape, and returns focus to its trigger", async () => {
    const { root } = mount();
    const trigger = root.querySelector(
      ".new-profile-chip",
    ) as HTMLButtonElement;
    fire(() => trigger.click());
    const popover = root.querySelector(".profile-create-pop") as HTMLElement;
    const manage = [
      ...popover.querySelectorAll<HTMLButtonElement>("button"),
    ].at(-1) as HTMLButtonElement;
    fire(() => manage.focus());
    press(manage, "Tab");
    expect(document.activeElement).toBe(
      popover.querySelector(".profile-name-field"),
    );

    press(popover, "Escape");
    await Promise.resolve();
    expect(root.querySelector(".profile-create-pop")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("renames inline and enables a disabled profile without switching", async () => {
    const { root, menus, onRename, onEnable, onActivate } = mount();
    fire(() => menus[0]?.click());
    const firstMenu = root.querySelector(".profile-actions-pop") as HTMLElement;
    expect(firstMenu.getAttribute("popover")).toBe("manual");
    const rename = [...firstMenu.querySelectorAll("button")].find(
      (button) => button.textContent === "Rename",
    ) as HTMLButtonElement;
    fire(() => rename.click());
    const field = firstMenu.querySelector(
      ".profile-name-field",
    ) as HTMLInputElement;
    typeInto(field, "Production");
    fire(() =>
      (
        firstMenu.querySelector('button[type="submit"]') as HTMLButtonElement
      ).click(),
    );
    await settle();
    expect(onRename).toHaveBeenCalledWith("staging", "Production");

    fire(() => menus[2]?.click());
    const disabledMenu = root.querySelector(
      ".profile-actions-pop",
    ) as HTMLElement;
    const enable = [...disabledMenu.querySelectorAll("button")].find(
      (button) => button.textContent === "Enable without switching",
    ) as HTMLButtonElement;
    fire(() => enable.click());
    await settle();
    expect(onEnable).toHaveBeenCalledWith("qa");
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("opens profile management from both popovers", () => {
    const { root, menus, onManageProfiles } = mount();
    fire(() => menus[0]?.click());
    fire(() =>
      [...root.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Manage profiles")
        ?.click(),
    );
    expect(onManageProfiles).toHaveBeenCalledTimes(1);

    fire(() =>
      (root.querySelector(".new-profile-chip") as HTMLButtonElement).click(),
    );
    fire(() =>
      [...root.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Manage profiles")
        ?.click(),
    );
    expect(onManageProfiles).toHaveBeenCalledTimes(2);
  });
});

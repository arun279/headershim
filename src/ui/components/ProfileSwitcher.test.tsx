// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../../core/model";
import { fire, press, render } from "../test/render";
import { ProfileSwitcher } from "./ProfileSwitcher";

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

function mount(overrides: Partial<Parameters<typeof ProfileSwitcher>[0]> = {}) {
  const onActivate = vi.fn();
  const onToggle = vi.fn();
  const root = render(
    <ProfileSwitcher
      profiles={three}
      focusedProfileId="staging"
      onActivate={onActivate}
      onToggle={onToggle}
      {...overrides}
    />,
  );
  const chips = [...root.querySelectorAll<HTMLButtonElement>(".chip")];
  return { root, chips, onActivate, onToggle };
}

describe("ProfileSwitcher", () => {
  it("is a labeled nav of chips with badges hidden from assistive tech", () => {
    const { root, chips } = mount();
    expect(root.querySelector("nav")?.getAttribute("aria-label")).toBe(
      "Profiles",
    );
    expect(chips).toHaveLength(3);
    expect(
      chips[0]?.querySelector(".chip-badge")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(chips[0]?.querySelector(".chip-badge")?.textContent).toBe("SA");
  });

  it("marks the focused chip with aria-current and a state suffix for AT", () => {
    const { chips } = mount();
    expect(chips[0]?.getAttribute("aria-current")).toBe("true");
    expect(chips[1]?.getAttribute("aria-current")).toBeNull();
    expect(chips[0]?.querySelector(".sr-only")?.textContent).toBe(
      ", focused, on",
    );
    expect(chips[1]?.querySelector(".sr-only")?.textContent).toBe(", on");
    expect(chips[2]?.querySelector(".sr-only")?.textContent).toBe(", off");
  });

  it("shows the silkscreen off tag only on disabled profiles", () => {
    const { chips } = mount();
    expect(chips[0]?.querySelector(".silk")).toBeNull();
    expect(chips[2]?.querySelector(".silk")?.textContent).toBe("off");
    expect(chips[2]?.classList.contains("off")).toBe(true);
  });

  it("click is the exclusive switch", () => {
    const { chips, onActivate, onToggle } = mount();
    fire(() => chips[1]?.click());
    expect(onActivate).toHaveBeenCalledWith("cors");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shift+click toggles only that profile", () => {
    const { chips, onActivate, onToggle } = mount();
    fire(() =>
      chips[2]?.dispatchEvent(
        new MouseEvent("click", { shiftKey: true, bubbles: true }),
      ),
    );
    expect(onToggle).toHaveBeenCalledWith("qa");
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("roves the tab stop with arrow keys", () => {
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

  it("focuses the focused profile's chip on mount when asked", () => {
    const { chips } = mount({ autoFocus: true });
    expect(document.activeElement).toBe(chips[0]);
  });

  it("does not steal focus without autoFocus", () => {
    const { chips } = mount();
    expect(document.activeElement).not.toBe(chips[0]);
  });
});

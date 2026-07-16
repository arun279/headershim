// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/options/App";
import { shortcutManagerUrl } from "../../entrypoints/options/pages/Settings";
import { read, write } from "../platform/store";
import { copy, sentenceText } from "../ui/copy";
import { profile, resetFixtures, stateDoc } from "../ui/test/fixtures";
import { fire, render, settle } from "../ui/test/render";
import { THEME_CACHE_KEY } from "../ui/theme";

const text = copy.options.about;
const settings = copy.options.settings;

async function mount(hash = "#about"): Promise<HTMLElement> {
  await write(stateDoc([profile("p1")]));
  window.location.hash = hash;
  const root = render(<App />);
  await settle();
  if (hash === "#settings") {
    await vi.waitFor(() => {
      if (root.querySelector("#settings-title") === null) {
        throw new Error("settings page is still loading");
      }
    });
  }
  return root;
}

function radio(root: HTMLElement, name: string, value: string) {
  const input = root.querySelector<HTMLInputElement>(
    `input[name="${name}"][value="${value}"]`,
  );
  if (input === null) {
    throw new Error(`no ${name} radio for ${value}`);
  }
  return input;
}

function check(input: HTMLInputElement): void {
  fire(() => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("options settings", () => {
  beforeEach(() => {
    resetFixtures();
    document.documentElement.removeAttribute("data-theme");
  });

  it("persists the theme choice and stamps data-theme on the root", async () => {
    const root = await mount("#settings");
    expect(root.querySelectorAll(".settings-row")).toHaveLength(2);
    expect(root.querySelector(".settings-segments")).not.toBeNull();
    expect(document.documentElement.getAttribute("data-theme")).toBe(null);
    expect(radio(root, "theme", "system").checked).toBe(true);
    expect(
      [...root.querySelectorAll('input[name="theme"]')].map(
        (input) => input.parentElement?.textContent,
      ),
    ).toEqual(["System", "Light", "Dark"]);

    check(radio(root, "theme", "dark"));
    await settle();

    expect((await read()).settings.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe("dark");

    expect(radio(root, "theme", "dark").checked).toBe(true);

    check(radio(root, "theme", "system"));
    await settle();
    expect(document.documentElement.getAttribute("data-theme")).toBe(null);
  });

  it("opens the browser shortcut manager from the shortcuts control", async () => {
    const create = vi.spyOn(fakeBrowser.tabs, "create");
    const root = await mount("#settings");
    const link = [...root.querySelectorAll("a")].find((candidate) =>
      candidate.textContent?.includes(settings.shortcuts),
    );
    if (link === undefined) {
      throw new Error("no shortcuts control");
    }

    fire(() => link.click());

    expect(create).toHaveBeenCalledWith({
      url: "about:addons",
    });
  });

  it("chooses the shortcut manager supported by the browser runtime", () => {
    expect(shortcutManagerUrl({})).toBe("chrome://extensions/shortcuts");
    expect(shortcutManagerUrl({ getBrowserInfo: () => undefined })).toBe(
      "about:addons",
    );
  });
});

describe("options about", () => {
  beforeEach(() => {
    resetFixtures();
  });

  it("keeps appearance controls out of the identity card", async () => {
    const root = await mount();
    expect(root.querySelector(".settings-card")).toBeNull();
    expect(root.querySelector('input[name="badge-mode"]')).toBeNull();
    expect(root.textContent).not.toContain(settings.shortcuts);
  });

  it("shows the injected build identity and one factual description", async () => {
    const root = await mount();
    expect(root.querySelector(".wb-title")?.textContent).toBe(text.title);
    expect(root.textContent).toContain(
      sentenceText(text.build("1.0.0", "test")),
    );
    expect(root.querySelector(".about-description")?.textContent).toBe(
      text.description,
    );
    expect(root.querySelectorAll(".about-description")).toHaveLength(1);
    expect(root.textContent).toContain(text.license);
    expect(root.textContent).not.toContain(copy.app.tagline);
    expect(
      root.querySelectorAll(".about-card h2, .about-card h3"),
    ).toHaveLength(0);
  });

  it("contains none of the removed manifesto sections", () => {
    expect(text).not.toHaveProperty("trustHeading");
    expect(text).not.toHaveProperty("summary");
    expect(text).not.toHaveProperty("permissions");
    expect(text).not.toHaveProperty("storage");
    expect(text).not.toHaveProperty("neverList");
    expect(text).not.toHaveProperty("security");
    expect(text).not.toHaveProperty("verifyBuild");
  });

  it("links the repository, license, issues, and releases", async () => {
    const root = await mount();
    const links = [
      ...root.querySelectorAll<HTMLAnchorElement>(".about-links a.about-link"),
    ];

    expect(links.map((link) => link.href)).toEqual([
      text.links.repositoryUrl,
      text.links.licenseUrl,
      text.links.issuesUrl,
      text.links.releasesUrl,
    ]);
    expect(links.map((link) => link.textContent?.replace(" ↗", ""))).toEqual([
      text.links.repository,
      text.links.license,
      text.links.issues,
      text.links.releases,
    ]);
  });
});

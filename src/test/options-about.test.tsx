// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/options/App";
import { read, write } from "../platform/store";
import { copy, sentenceText } from "../ui/copy";
import { profile, resetFixtures, stateDoc } from "../ui/test/fixtures";
import { fire, render, settle } from "../ui/test/render";
import { THEME_CACHE_KEY } from "../ui/theme";

const text = copy.options.about;

async function mount(): Promise<HTMLElement> {
  await write(stateDoc([profile("p1")]));
  window.location.hash = "#about";
  const root = render(<App />);
  await settle();
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

describe("options about", () => {
  beforeEach(() => {
    resetFixtures();
    document.documentElement.removeAttribute("data-theme");
  });

  it("persists the theme choice and stamps data-theme on the root", async () => {
    const root = await mount();
    expect(radio(root, "theme", "system").checked).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe(null);

    check(radio(root, "theme", "dark"));
    await settle();

    expect((await read()).settings.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe("dark");

    check(radio(root, "theme", "system"));
    await settle();
    expect(document.documentElement.getAttribute("data-theme")).toBe(null);
  });

  it("persists the badge mode choice", async () => {
    const root = await mount();
    expect(radio(root, "badge-mode", "count").checked).toBe(true);

    check(radio(root, "badge-mode", "initials"));
    await settle();

    expect((await read()).settings.badgeMode).toBe("initials");
    expect(radio(root, "badge-mode", "initials").checked).toBe(true);
  });

  it("opens the browser shortcut manager from the shortcuts control", async () => {
    const create = vi.spyOn(fakeBrowser.tabs, "create");
    const root = await mount();
    const button = [...root.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes(text.shortcuts),
    );
    if (button === undefined) {
      throw new Error("no shortcuts control");
    }

    fire(() => button.click());

    expect(create).toHaveBeenCalledWith({
      url: "chrome://extensions/shortcuts",
    });
  });

  it("shows the version, commit, and first-run tagline verbatim", async () => {
    const root = await mount();
    expect(root.textContent).toContain(
      sentenceText(text.build("1.0.0", "test")),
    );
    expect(root.textContent).toContain(copy.app.tagline);
  });

  it("justifies every manifest permission plus optional site access", async () => {
    const root = await mount();
    const rows = [
      ...root.querySelectorAll<HTMLElement>(".about-table tbody th"),
    ].map((cell) => cell.textContent);

    expect(rows).toEqual([
      "declarativeNetRequestWithHostAccess",
      "storage",
      "activeTab",
      "Site access (optional)",
    ]);
    expect(root.textContent).toContain(text.permissions.intro);
  });

  it("renders the full never-list and the build-verification procedure", async () => {
    const root = await mount();
    const items = [...root.querySelectorAll<HTMLElement>(".about-never li")];

    expect(
      items.map((item) => item.querySelector("strong")?.textContent),
    ).toEqual(text.neverList.items.map((item) => item.lead));
    expect(root.textContent).toContain(text.verifyBuild.caveat);
    expect(root.textContent).toContain("sha256sum -c SHA256SUMS");
  });

  it("links the repository, issues, and changelog", async () => {
    const root = await mount();
    const links = [...root.querySelectorAll<HTMLAnchorElement>("a.about-link")];

    expect(links.map((link) => link.href)).toEqual([
      text.links.repositoryUrl,
      text.links.issuesUrl,
      text.links.changelogUrl,
    ]);
  });
});

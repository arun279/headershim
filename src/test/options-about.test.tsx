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

  it("persists the badge mode choice", async () => {
    const root = await mount("#settings");
    expect(radio(root, "badge-mode", "count").checked).toBe(true);

    check(radio(root, "badge-mode", "initials"));
    await settle();

    expect((await read()).settings.badgeMode).toBe("initials");
    expect(radio(root, "badge-mode", "initials").checked).toBe(true);
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

  it("keeps appearance controls out of the trust page", async () => {
    const root = await mount();
    expect(root.querySelector(".settings-card")).toBeNull();
    expect(root.querySelector('input[name="badge-mode"]')).toBeNull();
    expect(root.textContent).not.toContain(settings.shortcuts);
  });

  it("shows the version, commit, and first-run tagline verbatim", async () => {
    const root = await mount();
    expect(root.textContent).toContain(
      sentenceText(text.build("1.0.0", "test")),
    );
    expect(root.textContent).toContain(copy.app.tagline);
  });

  it("leads with the three checkable facts", async () => {
    const root = await mount();
    const facts = [
      ...root.querySelectorAll<HTMLElement>(".about-facts li"),
    ].map((item) => item.textContent);
    expect(facts).toEqual(text.summary.facts);
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

  it("renders the grouped never-list and the build-verification procedure", async () => {
    const root = await mount();

    const groupHeadings = [
      ...root.querySelectorAll<HTMLElement>(".about-never-heading"),
    ].map((heading) => heading.textContent);
    expect(groupHeadings).toEqual(
      text.neverList.groups.map((group) => group.heading),
    );

    const leads = [
      ...root.querySelectorAll<HTMLElement>(".about-never li strong"),
    ].map((strong) => strong.textContent);
    expect(leads).toEqual(
      text.neverList.groups.flatMap((group) =>
        group.items.map((item) => `${item.lead}.`),
      ),
    );

    expect(root.textContent).toContain(text.verifyBuild.caveat);
    expect(root.textContent).toContain("sha256sum -c SHA256SUMS");
  });

  it("carries a single link to the committed security policy", async () => {
    const root = await mount();
    const security = [
      ...root.querySelectorAll<HTMLAnchorElement>("a.about-link"),
    ].filter((link) => link.href === text.security.linkUrl);

    expect(security).toHaveLength(1);
    expect(text.security.body).toBe(
      "How to report a security issue is in the security policy.",
    );
    expect(root.textContent).toContain(text.security.body);
    expect(text.neverList.groups[1]?.items[2]?.detail).toBe(
      "A change of maintainer is the most common way a trusted extension goes bad. HeaderShim commits against a quiet handover.",
    );
  });

  it("links the repository, issues, and changelog", async () => {
    const root = await mount();
    const links = [
      ...root.querySelectorAll<HTMLAnchorElement>(".about-links a.about-link"),
    ];

    expect(links.map((link) => link.href)).toEqual([
      text.links.repositoryUrl,
      text.links.issuesUrl,
      text.links.changelogUrl,
    ]);
  });
});

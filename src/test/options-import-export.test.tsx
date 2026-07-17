// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/options/App";
import { MAX_IMPORT_BYTES } from "../../entrypoints/options/pages/ImportExport";
import modheaderFixture from "../core/codec/__fixtures__/modheader-profile.json";
import { exportHeadershim } from "../core/codec/headershim";
import type { Profile } from "../core/model";
import { read, write } from "../platform/store";
import { copy, sentenceText } from "../ui/copy";
import { profile, resetFixtures, rule, stateDoc } from "../ui/test/fixtures";
import { findButton, fire, render, settle } from "../ui/test/render";

const MODHEADER = JSON.stringify(modheaderFixture);

const text = copy.options.importExport;

function stubRegex(): void {
  Object.assign(fakeBrowser.declarativeNetRequest, {
    isRegexSupported: async ({ regex }: { regex: string }) => ({
      isSupported: !/\(\?[=!<]/.test(regex),
      reason: "syntaxError",
    }),
  });
}

async function seed(profiles: Profile[]): Promise<void> {
  await write(stateDoc(profiles));
}

async function mount(): Promise<HTMLElement> {
  window.location.hash = "#import-export";
  const root = render(<App />);
  await settle();
  return root;
}

async function pick(root: HTMLElement, contents: string): Promise<void> {
  await pickFile(
    root,
    new File([contents], "import.json", { type: "application/json" }),
  );
}

async function pickFile(root: HTMLElement, file: File): Promise<void> {
  const input = root.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error("no file input");
  }
  Object.defineProperty(input, "files", {
    configurable: true,
    value: { 0: file, length: 1, item: () => file },
  });
  fire(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  // Decoding is async (the ModHeader codec loads on demand), so wait for the
  // plan summary or a failure message to land rather than a fixed tick count.
  for (let round = 0; round < 12; round += 1) {
    await settle();
    if (summary(root) !== null || root.querySelector(".ie-error") !== null) {
      return;
    }
  }
}

function summary(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(".import-summary");
}

const HEADERSHIM = JSON.stringify({
  app: "headershim",
  schemaVersion: 1,
  exportedAt: "2026-07-12T14:03:00Z",
  profiles: [
    {
      name: "Staging auth",
      badge: "SA",
      color: "blue",
      rules: [
        {
          direction: "request",
          operation: "set",
          header: "authorization",
          value: "Bearer token",
          enabled: true,
          scope: {
            type: "domains",
            domains: ["api.staging.example.com"],
            resourceTypes: "all",
          },
          initiators: [],
        },
      ],
    },
  ],
});

beforeEach(() => {
  resetFixtures();
  window.location.hash = "";
  stubRegex();
});

describe("import failure modes", () => {
  it("places the ModHeader import fact on Import and export", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    expect(root.querySelector(".ie-hint")?.textContent).toBe(text.instruction);
    expect(text.instruction).toContain("ModHeader export");
  });

  it("renders the parse-failure copy and applies nothing", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    await pick(root, "{ not json");

    expect(root.querySelector(".ie-error")?.textContent).toBe(
      copy.errors.importParse,
    );
    expect(summary(root)).toBeNull();
    expect((await read()).profiles).toHaveLength(1);
  });

  it("refuses a file too large to read without reading it", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();
    const file = new File(["{}"], "import.json", { type: "application/json" });
    const readText = vi.fn();
    Object.defineProperties(file, {
      size: { value: MAX_IMPORT_BYTES + 1 },
      text: { value: readText },
    });

    await pickFile(root, file);

    expect(root.querySelector(".ie-error")?.textContent).toBe(
      copy.errors.importTooLarge,
    );
    expect(readText).not.toHaveBeenCalled();
    expect((await read()).profiles).toHaveLength(1);
  });

  it("renders the unreadable copy when the picked file cannot be read", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();
    const file = new File(["{}"], "import.json", { type: "application/json" });
    Object.defineProperty(file, "text", {
      value: () => Promise.reject(new DOMException("gone", "NotReadableError")),
    });

    await pickFile(root, file);

    expect(root.querySelector(".ie-error")?.textContent).toBe(
      copy.errors.importUnreadable,
    );
    expect(summary(root)).toBeNull();
    expect((await read()).profiles).toHaveLength(1);
  });

  it("renders the unrecognized-format copy for foreign JSON", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    await pick(root, JSON.stringify({ some: "object" }));

    expect(root.querySelector(".ie-error")?.textContent).toBe(
      copy.errors.importUnrecognized,
    );
    expect((await read()).profiles).toHaveLength(1);
  });

  it("renders the newer-version copy for a future schema", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    await pick(
      root,
      JSON.stringify({
        app: "headershim",
        schemaVersion: 2,
        exportedAt: "2026-07-12T14:03:00Z",
        profiles: [],
      }),
    );

    expect(root.querySelector(".ie-error")?.textContent).toBe(
      copy.errors.importNewer(2, 1),
    );
    expect((await read()).profiles).toHaveLength(1);
  });

  it("renders the storage-budget copy on apply and applies nothing", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    await pick(
      root,
      JSON.stringify({
        app: "headershim",
        schemaVersion: 1,
        exportedAt: "2026-07-12T14:03:00Z",
        profiles: [
          {
            name: "Huge",
            badge: "HU",
            color: "blue",
            rules: [
              {
                direction: "request",
                operation: "set",
                header: "x-huge",
                value: "x".repeat(4 * 1024 * 1024),
                enabled: false,
                scope: {
                  type: "domains",
                  domains: ["example.com"],
                  resourceTypes: "all",
                },
                initiators: [],
              },
            ],
          },
        ],
      }),
    );

    fire(() => findButton(summary(root) as HTMLElement, text.import).click());
    await settle();

    expect(root.querySelector(".import-error")?.textContent).toBe(
      copy.errors.storageBudget,
    );
    expect((await read()).profiles).toHaveLength(1);
  });
});

describe("import summary and apply", () => {
  it("shows counts and imports a headershim file with profiles off", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    await pick(root, HEADERSHIM);

    expect(root.querySelector(".import-counts")?.textContent).toBe(
      sentenceText(text.counts(1, 1)),
    );

    fire(() => findButton(summary(root) as HTMLElement, text.import).click());
    await settle();

    expect(summary(root)).toBeNull();
    const stored = await read();
    expect(stored.profiles).toHaveLength(2);
    expect(stored.profiles[1]).toMatchObject({ name: "Staging auth" });
    expect(stored.profiles[1]).not.toHaveProperty("enabled");
  });

  it("cancels a pending import, leaving the store untouched", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    await pick(root, HEADERSHIM);
    fire(() =>
      findButton(summary(root) as HTMLElement, copy.actions.cancel).click(),
    );
    await settle();

    expect(summary(root)).toBeNull();
    expect((await read()).profiles).toHaveLength(1);
  });

  it("itemizes ModHeader mapping warnings, naming each rule", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    await pick(root, MODHEADER);

    const names = [
      ...root.querySelectorAll<HTMLElement>(".import-warning-name"),
    ].map((node) => node.textContent);
    expect(names).toContain("literal token header");
    expect(names).toContain("api policy");
  });

  it("converts a frozen value before apply, clearing the offered tokens", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    await pick(root, MODHEADER);

    fire(() => findButton(summary(root) as HTMLElement, text.convert).click());
    await settle();

    // The unresolvable {{url_hostname}} token keeps the warning, minus its offer.
    expect(root.querySelector(".import-warning-name")).not.toBeNull();
    expect(
      [...root.querySelectorAll("button")].some(
        (button) => button.textContent === text.convert,
      ),
    ).toBe(false);

    fire(() => findButton(summary(root) as HTMLElement, text.import).click());
    await settle();

    const imported = (await read()).profiles.find(
      (p) => p.name === "Development",
    );
    const authRule = imported?.rules.find((r) => r.header === "authorization");
    expect(authRule?.value).not.toContain("{{uuid}}");
    expect(authRule?.value).not.toContain("{{timestamp}}");
    expect(authRule?.value).toContain("{{url_hostname}}");
  });
});

describe("export", () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.revokeObjectURL = vi.fn();
  });

  async function captureExport(
    root: HTMLElement,
    label: string,
  ): Promise<unknown> {
    let captured: Blob | undefined;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      captured = blob;
      return "blob:x";
    });
    fire(() => findButton(root, label).click());
    if (captured === undefined) {
      throw new Error("no blob was created");
    }
    return JSON.parse(await captured.text());
  }

  it("exports everything as the headershim envelope", async () => {
    await seed([
      profile("p1", { name: "Default", rules: [rule({ header: "x-a" })] }),
      profile("p2", { name: "Staging" }),
    ]);
    const root = await mount();

    const envelope = (await captureExport(root, text.exportEverything)) as {
      app: string;
      schemaVersion: number;
      profiles: unknown[];
    };
    expect(envelope.app).toBe("headershim");
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.profiles).toHaveLength(2);
  });

  it("exports a single selected profile", async () => {
    await seed([
      profile("p1", { name: "Default" }),
      profile("p2", { name: "Staging" }),
    ]);
    const root = await mount();

    const select = root.querySelector<HTMLSelectElement>(".ie-select");
    if (select === null) {
      throw new Error("no profile select");
    }
    fire(() => {
      select.value = "p2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const envelope = (await captureExport(root, text.exportOne)) as {
      profiles: { name: string }[];
    };
    expect(envelope.profiles).toHaveLength(1);
    expect(envelope.profiles[0]?.name).toBe("Staging");
  });

  it("names the secrets reminder verbatim beside export", async () => {
    await seed([profile("p1", { name: "Default" })]);
    const root = await mount();

    expect(
      [...root.querySelectorAll(".ie-hint")].some(
        (node) => node.textContent === text.secretsReminder,
      ),
    ).toBe(true);
    // Sanity-check the golden serializer is what export ships.
    expect(
      exportHeadershim(stateDoc([profile("p1", { name: "Default" })])),
    ).toContain('"app": "headershim"');
  });
});

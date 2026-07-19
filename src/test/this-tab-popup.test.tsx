// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/popup/App";
import type { StateDoc, TabOverride } from "../core/model";
import { createV1Seed } from "../core/schema";
import {
  read as readSession,
  write as writeSession,
} from "../platform/session-store";
import { write } from "../platform/store";
import { copy } from "../ui/copy";
import {
  fire,
  pasteInto,
  press,
  render,
  settle,
  typeInto,
} from "../ui/test/render";

// The popup's tab is pinned so This-tab writes bind to a known origin.
vi.mock("../platform/tabs", () => ({
  activeTabId: () => Promise.resolve(5),
  activeTabDomain: () => Promise.resolve("app.example.com"),
}));

beforeEach(() => {
  fakeBrowser.reset();
});

function override(overrides: Partial<TabOverride> = {}): TabOverride {
  return {
    num: 1,
    tabId: 5,
    originHost: "app.example.com",
    direction: "request",
    operation: "set",
    header: "x-debug-trace",
    value: "1",
    enabled: true,
    ...overrides,
  };
}

async function mount(
  doc: StateDoc,
  session?: Parameters<typeof writeSession>[0],
) {
  await write(doc);
  if (session !== undefined) await writeSession(session);
  const root = render(<App />);
  await settle();
  return root;
}

// Opens the composer on a fresh popup and commits x-a: 42 through it.
async function composeChange(): Promise<HTMLElement> {
  const root = await mount(createV1Seed());
  press(root.querySelector(".popup") as HTMLElement, "t");
  await settle();
  expect(root.querySelector(".compose")).not.toBeNull();
  typeInto(root.querySelector(".cin.name") as HTMLInputElement, "x-a");
  typeInto(root.querySelector(".cin.val") as HTMLInputElement, "42");
  await act(async () => {
    const submit = root.querySelector(
      ".compose .btn.primary",
    ) as HTMLButtonElement;
    expect(submit.textContent).toContain(copy.readout.addThisTab);
    submit.click();
  });
  await settle();
  return root;
}

describe("popup This-tab overrides", () => {
  it("opens the composer with t and commits a this-tab change", async () => {
    const root = await composeChange();
    expect(root.querySelector(".compose")).toBeNull();
    expect((await readSession()).tabs[5]).toMatchObject([
      { header: "x-a", value: "42", originHost: "app.example.com" },
    ]);
    const strip = root.querySelector(".thistab") as HTMLElement;
    expect(strip.textContent).toContain("This tab only");
    expect(strip.querySelector(".change-line .k")?.textContent).toBe("x-a");
  });

  it("splits a pasted header line across the composer fields", async () => {
    const root = await mount(createV1Seed());
    press(root.querySelector(".popup") as HTMLElement, "t");
    await settle();

    pasteInto(
      root.querySelector(".cin.name") as HTMLInputElement,
      "Authorization: Bearer eyJhbGciOi.J9",
    );

    expect((root.querySelector(".cin.name") as HTMLInputElement).value).toBe(
      "Authorization",
    );
    expect((root.querySelector(".cin.val") as HTMLInputElement).value).toBe(
      "Bearer eyJhbGciOi.J9",
    );
    expect(root.querySelector(".c-note")?.textContent).toBe(
      copy.editor.pastedLineSplit,
    );
  });

  it("keeps both composer choices as labelled pressed-button groups", async () => {
    const root = await mount(createV1Seed());
    press(root.querySelector(".popup") as HTMLElement, "t");
    await settle();

    const groups = [
      ...root.querySelectorAll<HTMLElement>(".compose fieldset.segmented"),
    ];
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      copy.editor.labels.direction,
      copy.editor.labels.operation,
    ]);
    expect(
      groups.map((group) =>
        [...group.querySelectorAll("button")].map((button) => [
          button.textContent,
          button.getAttribute("aria-pressed"),
        ]),
      ),
    ).toEqual([
      [
        [copy.readout.direction.request, "true"],
        [copy.readout.direction.response, "false"],
      ],
      [
        [copy.editor.operation.set, "true"],
        [copy.editor.operation.append, "false"],
        [copy.editor.operation.remove, "false"],
      ],
    ]);

    fire(() => groups[1]?.querySelectorAll("button")[2]?.click());
    expect(
      [...(groups[1]?.querySelectorAll("button") ?? [])].map((button) =>
        button.getAttribute("aria-pressed"),
      ),
    ).toEqual(["false", "false", "true"]);
    expect(root.querySelector(".cin.val")).toBeNull();
  });

  it("writes nothing when the host grant is declined", async () => {
    vi.spyOn(fakeBrowser.permissions, "request").mockResolvedValue(false);
    const root = await composeChange();
    // Nothing stored, so no row can read live while applying to nothing; the
    // draft stays put and says why.
    expect((await readSession()).tabs[5]).toBeUndefined();
    expect(root.querySelector(".thistab")).toBeNull();
    expect(root.querySelector(".c-error")?.textContent).toContain(
      "needs access to app.example.com",
    );
    expect(root.querySelector(".compose")).not.toBeNull();
  });

  it("reports a header the composer cannot use inline", async () => {
    const root = await mount(createV1Seed());
    press(root.querySelector(".popup") as HTMLElement, "t");
    await settle();
    typeInto(root.querySelector(".cin.name") as HTMLInputElement, ":method");
    typeInto(root.querySelector(".cin.val") as HTMLInputElement, "x");
    await act(async () => {
      (
        root.querySelector(".compose .btn.primary") as HTMLButtonElement
      ).click();
    });
    await settle();
    expect(root.querySelector(".compose")).not.toBeNull();
    expect(root.querySelector(".c-error")?.textContent).toContain(
      "HTTP/2 internals",
    );
    expect((await readSession()).tabs[5]).toBeUndefined();
  });

  it("renders an override in the dashed strip and toggles it", async () => {
    const root = await mount(createV1Seed(), {
      nextNum: 2,
      tabs: { 5: [override()] },
    });
    const line = root.querySelector(".thistab .change-line") as HTMLElement;
    expect(line.classList.contains("live")).toBe(true);
    const toggle = line.querySelector(
      '[aria-label="Turn off this-tab change: x-debug-trace"]',
    ) as HTMLButtonElement;
    await act(async () => toggle.click());
    await settle();
    expect((await readSession()).tabs[5]?.[0]?.enabled).toBe(false);
    expect(root.querySelector(".thistab .change-line.off")).not.toBeNull();
    expect(
      root.querySelector(
        '[aria-label="Remove this-tab change: x-debug-trace"]',
      ),
    ).not.toBeNull();

    const enable = root.querySelector(
      '[aria-label="Turn on this-tab change: x-debug-trace"]',
    ) as HTMLButtonElement;
    await act(async () => enable.click());
    await settle();
    expect((await readSession()).tabs[5]?.[0]?.enabled).toBe(true);
  });

  it("removes an override from its row", async () => {
    const root = await mount(createV1Seed(), {
      nextNum: 2,
      tabs: { 5: [override()] },
    });
    const remove = root.querySelector(
      '[aria-label="Remove this-tab change: x-debug-trace"]',
    ) as HTMLButtonElement;
    await act(async () => remove.click());
    await settle();
    expect((await readSession()).tabs).toEqual({});
  });

  it("does not report a removed override token as saved", async () => {
    const original = override({
      header: "authorization",
      value: "Bearer original-1234",
    });
    const root = await mount(createV1Seed(), {
      nextNum: 2,
      tabs: { 5: [original] },
    });
    fire(() =>
      (root.querySelector(".token .swap") as HTMLButtonElement).click(),
    );
    const field = root.querySelector(".swapfield input") as HTMLInputElement;
    typeInto(field, "Bearer replacement-5678");
    const get = vi
      .spyOn(fakeBrowser.storage.session, "get")
      .mockResolvedValueOnce({ sessionState: { nextNum: 2, tabs: {} } });

    press(field, "Enter");
    await settle();
    get.mockRestore();

    expect(root.querySelector(".swapfield input")).not.toBeNull();
    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.errors.saveFailed,
    );
    expect((await readSession()).tabs[5]).toEqual([original]);
  });

  it("prunes a stale-origin override on popup open", async () => {
    await mount(createV1Seed(), {
      nextNum: 2,
      tabs: { 5: [override({ originHost: "old.example.com" })] },
    });
    await settle();
    expect((await readSession()).tabs).toEqual({});
  });
});

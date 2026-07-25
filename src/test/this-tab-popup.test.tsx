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

// The compiler drops a This-tab row whose host is not granted, and the popup
// asks for that grant in the click gesture before it writes one, so the seeded
// rows below start from the grant a real change would already hold.
const TAB_ORIGIN = "*://*.app.example.com/*";

beforeEach(async () => {
  fakeBrowser.reset();
  await fakeBrowser.permissions.request({ origins: [TAB_ORIGIN] });
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

  // A confirmation is a verdict on the last attempt, not a standing offer, so
  // opening a new form retires it: the pill goes, and its polite-region mirror
  // goes with it, rather than being asserted to a screen reader indefinitely.
  it("retires a spent confirmation and its announcement when a new form opens", async () => {
    const root = await composeChange();
    const region = () =>
      root.querySelector('.sr-only[role="status"]')?.textContent;
    expect(root.querySelector(".toast-msg")?.textContent).toBe(
      copy.toast.changesSaved,
    );
    expect(region()).toBe(copy.toast.changesSaved);

    press(root.querySelector(".popup") as HTMLElement, "n");
    await settle();

    expect(root.querySelector(".rule-editor")).not.toBeNull();
    expect(root.querySelector(".toast-msg")).toBeNull();
    expect(region()).toBe("");
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

  it("shows sensitivity advice while composing a credential header", async () => {
    const root = await mount(createV1Seed());
    press(root.querySelector(".popup") as HTMLElement, "t");
    await settle();

    const header = root.querySelector(".cin.name") as HTMLInputElement;
    typeInto(header, "authorization");
    expect(root.querySelector(".advisory-slot")?.textContent).toContain(
      copy.advisories.credential,
    );

    typeInto(header, "x-custom");
    expect(root.querySelector(".advisory-slot")).toBeNull();
  });

  it("threads the composer direction into the advisory", async () => {
    const root = await mount(createV1Seed());
    press(root.querySelector(".popup") as HTMLElement, "t");
    await settle();

    const [directionGroup] = root.querySelectorAll<HTMLElement>(
      ".compose .segmented",
    );
    fire(() => {
      const response =
        directionGroup?.querySelectorAll<HTMLInputElement>("input")[1];
      if (response !== undefined) {
        response.checked = true;
        response.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    typeInto(
      root.querySelector(".cin.name") as HTMLInputElement,
      "content-security-policy",
    );
    expect(root.querySelector(".advisory-slot")?.textContent).toContain(
      copy.advisories.securityResponse,
    );
  });

  // The compact author takes the same two picks as the rule editor, through the
  // same control, under the same two words printed on screen. A second grammar
  // for the same choice is a second thing to learn.
  it("takes its two choices in the rule editor's own labelled control", async () => {
    const root = await mount(createV1Seed());
    press(root.querySelector(".popup") as HTMLElement, "t");
    await settle();

    expect(
      [
        ...root.querySelectorAll<HTMLElement>(
          ".compose .editor-primary-field legend",
        ),
      ].map((legend) => legend.textContent),
    ).toEqual([copy.editor.labels.direction, copy.editor.labels.operation]);
    // On screen too, not only for assistive technology.
    expect(
      [
        ...root.querySelectorAll<HTMLElement>(".compose .cfields-labels span"),
      ].map((label) => label.textContent),
    ).toEqual([copy.editor.labels.headerName, copy.editor.labels.value]);

    const groups = [
      ...root.querySelectorAll<HTMLElement>(".compose .segmented"),
    ];
    expect(
      groups.map((group) =>
        [...group.querySelectorAll<HTMLInputElement>("input")].map((input) => [
          input.parentElement?.textContent,
          input.checked,
        ]),
      ),
    ).toEqual([
      [
        [copy.editor.direction.request, true],
        [copy.editor.direction.response, false],
      ],
      [
        [copy.editor.operation.set, true],
        [copy.editor.operation.append, false],
        [copy.editor.operation.remove, false],
      ],
    ]);

    fire(() => {
      const remove = groups[1]?.querySelectorAll<HTMLInputElement>("input")[2];
      if (remove !== undefined) {
        remove.checked = true;
        remove.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    // Remove takes no value, so the value field and its label both go.
    expect(root.querySelector(".cin.val")).toBeNull();
    expect(root.querySelector(".compose .cfl-val")).toBeNull();
  });

  it("writes nothing when the host grant is declined", async () => {
    await fakeBrowser.permissions.remove({ origins: [TAB_ORIGIN] });
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
      '[aria-label="This-tab change on: x-debug-trace"]',
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
      '[aria-label="This-tab change off: x-debug-trace"]',
    ) as HTMLButtonElement;
    await act(async () => enable.click());
    await settle();
    expect((await readSession()).tabs[5]?.[0]?.enabled).toBe(true);
  });

  it("offers Grant and Remove when an authorization override needs access", async () => {
    await fakeBrowser.permissions.remove({ origins: [TAB_ORIGIN] });
    const request = vi.spyOn(fakeBrowser.permissions, "request");
    const root = await mount(createV1Seed(), {
      nextNum: 2,
      tabs: {
        5: [
          override({
            header: "authorization",
            value: "Bearer secret-1234",
          }),
        ],
      },
    });

    expect(root.querySelector(".token")).toBeNull();
    const line = root.querySelector(
      ".thistab .change-line.needs-access",
    ) as HTMLElement;
    expect(line.querySelector("button.grant")).not.toBeNull();
    expect(
      line.querySelector(
        '[aria-label="Remove this-tab change: authorization"]',
      ),
    ).not.toBeNull();
    expect(line.querySelector(".why.amber")?.textContent).toBe(
      copy.readout.needsAccessReason(true),
    );

    await act(async () =>
      line.querySelector<HTMLButtonElement>("button.grant")?.click(),
    );
    expect(request).toHaveBeenCalledExactlyOnceWith({
      origins: [TAB_ORIGIN],
    });
  });

  it("describes an ungranted remove without claiming it stores a value", async () => {
    await fakeBrowser.permissions.remove({ origins: [TAB_ORIGIN] });
    const { value: _value, ...remove } = override({
      operation: "remove",
      header: "x-trace",
    });
    const root = await mount(createV1Seed(), {
      nextNum: 2,
      tabs: { 5: [remove] },
    });

    const line = root.querySelector(
      ".thistab .change-line.needs-access",
    ) as HTMLElement;
    expect(line.textContent).toContain(copy.readout.needsAccessReason(true));
    expect(line.textContent).not.toContain("value you typed");
  });

  it("shows missing access rather than holding a paused override", async () => {
    await fakeBrowser.permissions.remove({ origins: [TAB_ORIGIN] });
    const seed = createV1Seed();
    const root = await mount(
      {
        ...seed,
        settings: { ...seed.settings, paused: true },
      },
      {
        nextNum: 2,
        tabs: { 5: [override()] },
      },
    );

    expect(root.querySelector(".change-line.needs-access")).not.toBeNull();
    expect(root.querySelector(".change-line.paused")).toBeNull();
    expect(root.querySelector(".change-line .verb")?.textContent).toBe(
      copy.readout.heldVerb.set,
    );
    expect(root.querySelector(".status")?.textContent).toContain(
      "0 changes held on this tab",
    );
    expect(root.querySelector(".substatus")?.textContent).toContain(
      "1 needs access",
    );
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

  it("does not report a removed authorization override as saved", async () => {
    const original = override({
      header: "authorization",
      value: "Bearer original-1234",
    });
    const root = await mount(createV1Seed(), {
      nextNum: 2,
      tabs: { 5: [original] },
    });
    expect(root.querySelector(".token")).toBeNull();
    const line = root.querySelector(".thistab .change-line") as HTMLElement;
    expect(
      line.querySelector(
        '[aria-label="Remove this-tab change: authorization"]',
      ),
    ).not.toBeNull();
    expect(
      line.querySelector('[aria-label="This-tab change on: authorization"]'),
    ).not.toBeNull();
    fire(() =>
      line
        .querySelector<HTMLButtonElement>(
          '[aria-label="Edit authorization value"]',
        )
        ?.click(),
    );
    const field = line.querySelector(".v-input") as HTMLInputElement;
    typeInto(field, "Bearer replacement-5678");
    const get = vi
      .spyOn(fakeBrowser.storage.session, "get")
      .mockResolvedValueOnce({ sessionState: { nextNum: 2, tabs: {} } });

    press(field, "Enter");
    await settle();
    get.mockRestore();

    expect(root.querySelector(".v-input")).not.toBeNull();
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

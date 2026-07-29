// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { App } from "../../entrypoints/options/App";
import { DEFAULT_PROFILE_NAME, type Profile } from "../core/model";
import { originPatternForDomain } from "../core/scope";
import {
  read as readSession,
  write as writeSession,
} from "../platform/session-store";
import { read, write } from "../platform/store";
import { copy } from "../ui/copy";
import { profile, resetFixtures, rule, stateDoc } from "../ui/test/fixtures";
import { findButton, fire, render, settle } from "../ui/test/render";

const text = copy.options.settings;

async function mount(profiles: Profile[]): Promise<HTMLElement> {
  await write(stateDoc(profiles));
  window.location.hash = "#settings";
  const root = render(<App />);
  await settle();
  return root;
}

function confirmButton(root: HTMLElement, label: string): HTMLButtonElement {
  const actions = root.querySelector<HTMLElement>(".modal-actions");
  if (actions === null) {
    throw new Error("no confirm dialog");
  }
  return findButton(actions, label);
}

async function eraseWith(profiles: Profile[]): Promise<HTMLElement> {
  const root = await mount(profiles);
  fire(() => findButton(root, text.eraseAll.action).click());
  await settle();
  fire(() => confirmButton(root, text.eraseAll.action).click());
  await settle();
  return root;
}

function populated(): Profile[] {
  return [
    profile("p1", {
      name: "Staging",
      rules: [rule({ header: "x-a" }), rule({ header: "x-b" })],
    }),
    profile("p2", { name: "Prod", rules: [rule({ header: "x-c" })] }),
  ];
}

beforeEach(() => {
  resetFixtures();
  window.location.hash = "";
});

describe("erase everything", () => {
  it("resets the document to the seed and revokes every grant", async () => {
    await fakeBrowser.permissions.request({
      origins: [originPatternForDomain("api.example.com")],
    });
    await eraseWith(populated());

    const stored = await read();
    expect(stored.profiles.map((one) => one.name)).toEqual([
      DEFAULT_PROFILE_NAME,
    ]);
    expect(stored.profiles[0]?.rules).toHaveLength(0);
    expect((await fakeBrowser.permissions.getAll()).origins).toEqual([]);
  });

  it("clears every tab's live overrides", async () => {
    await writeSession({
      nextNum: 2,
      tabs: {
        5: [
          {
            num: 1,
            tabId: 5,
            originHost: "app.example.com",
            direction: "request",
            operation: "set",
            header: "x-debug-trace",
            value: "1",
            enabled: true,
          },
        ],
      },
    });
    await eraseWith(populated());

    expect(await readSession()).toEqual({ nextNum: 1, tabs: {} });
  });

  it("restores the erased profiles and rules on undo", async () => {
    const root = await eraseWith(populated());

    fire(() => findButton(root, copy.actions.undo).click());
    await settle();

    const stored = await read();
    expect(stored.profiles.map((one) => one.name)).toEqual(["Staging", "Prod"]);
    expect(stored.profiles.flatMap((one) => one.rules)).toHaveLength(3);
  });

  it("leaves the document untouched when the confirm is cancelled", async () => {
    const root = await mount(populated());

    fire(() => findButton(root, text.eraseAll.action).click());
    await settle();
    fire(() => confirmButton(root, copy.actions.cancel).click());
    await settle();

    expect((await read()).profiles.map((one) => one.name)).toEqual([
      "Staging",
      "Prod",
    ]);
  });
});

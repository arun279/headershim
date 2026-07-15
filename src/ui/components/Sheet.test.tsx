// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { press, render } from "../test/render";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  it("keeps its header, body, and pinned controls in one labeled mode", () => {
    const root = render(
      <Sheet
        label="Edit rule"
        header={<h1>New rule</h1>}
        pinned={<button type="button">Create rule</button>}
      >
        <label>
          Header name
          <input />
        </label>
      </Sheet>,
    );

    const sheet = root.querySelector(".sheet");
    expect(sheet?.getAttribute("role")).toBe("dialog");
    expect(sheet?.getAttribute("aria-modal")).toBe("true");
    expect(sheet?.getAttribute("aria-label")).toBe("Edit rule");
    expect(sheet?.querySelector(".sheet-head")?.textContent).toBe("New rule");
    expect(sheet?.querySelector(".sheet-body input")).not.toBeNull();
    expect(sheet?.querySelector(".sheet-pinned button")?.textContent).toBe(
      "Create rule",
    );
  });

  it("keeps Tab within the open sheet", () => {
    const root = render(
      <Sheet
        label="Edit rule"
        header={<button type="button">Close</button>}
        pinned={<button type="button">Save</button>}
      >
        <input aria-label="Header name" />
      </Sheet>,
    );
    const sheet = root.querySelector(".sheet") as HTMLElement;
    const close = root.querySelector(".sheet-head button") as HTMLButtonElement;
    const save = root.querySelector(
      ".sheet-pinned button",
    ) as HTMLButtonElement;

    save.focus();
    press(sheet, "Tab");
    expect(document.activeElement).toBe(close);

    close.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(save);
  });

  it("omits the pinned stratum when a mode has no trailing controls", () => {
    const root = render(
      <Sheet label="Verify" header={<h1>Verify</h1>}>
        Results
      </Sheet>,
    );
    expect(root.querySelector(".sheet-pinned")).toBeNull();
  });
});

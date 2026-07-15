// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render } from "../test/render";
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
    expect(sheet?.getAttribute("aria-label")).toBe("Edit rule");
    expect(sheet?.querySelector(".sheet-head")?.textContent).toBe("New rule");
    expect(sheet?.querySelector(".sheet-body input")).not.toBeNull();
    expect(sheet?.querySelector(".sheet-pinned button")?.textContent).toBe(
      "Create rule",
    );
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

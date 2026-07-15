// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { render } from "../test/render";
import { AdvisorySlot } from "./AdvisorySlot";

describe("AdvisorySlot", () => {
  it("renders nothing for an ordinary header", () => {
    const root = render(<AdvisorySlot header="x-debug" />);
    expect(root.children).toHaveLength(0);
  });

  it("pairs the caution word and icon with the managed-header advisory", () => {
    const root = render(<AdvisorySlot header="te" />);
    const advisory = root.querySelector(".advisory-slot");
    expect(advisory?.getAttribute("aria-label")).toBe(copy.editor.caution);
    expect(advisory?.querySelector(".advisory-icon")?.textContent).toBe("▲");
    expect(advisory?.textContent).toContain(copy.advisories.managedHeader);
  });
});

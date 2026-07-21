// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { render } from "../test/render";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("shows the message and omits the action row when none is given", () => {
    const root = render(
      <EmptyState message={copy.emptyState.profile("Staging")} />,
    );
    expect(root.querySelector(".empty-message")?.textContent).toBe(
      "Staging has no rules yet.",
    );
    expect(root.querySelector(".empty-actions")).toBeNull();
  });

  it("renders provided actions", () => {
    const root = render(
      <EmptyState
        message="No rules yet"
        actions={<button type="button">+ New rule</button>}
      />,
    );
    expect(root.querySelector(".empty-actions button")?.textContent).toBe(
      "+ New rule",
    );
  });

  it("renders reassurance without forcing resting focus", () => {
    const root = render(
      <EmptyState
        message={copy.emptyState.profile("Staging")}
        detail={copy.emptyState.otherProfilesUnchanged}
        actions={<button type="button">Create a rule</button>}
      />,
    );
    expect(root.querySelector(".empty-detail")?.textContent).toBe(
      "Your other profiles are unchanged.",
    );
    expect(document.activeElement).not.toBe(root.querySelector("button"));
  });
});

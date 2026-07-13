// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Rule } from "../../core/model";
import type { VerifyReadout } from "../../core/verify";
import { LiveRegionProvider } from "../a11y/LiveRegion";
import { copy } from "../copy";
import { fire, press, render } from "../test/render";
import { VerifyPanel } from "./VerifyPanel";

function rule(id: string, header: string): Rule {
  return {
    id,
    num: Number(id.replace(/\D/g, "")) || 1,
    direction: "request",
    operation: "set",
    header,
    value: "x",
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
  };
}

function mount(readout: VerifyReadout) {
  const onClose = vi.fn();
  const root = render(
    <LiveRegionProvider>
      <VerifyPanel readout={readout} onClose={onClose} />
    </LiveRegionProvider>,
  );
  const panel = root.querySelector(".verify") as HTMLElement;
  return { root, panel, onClose };
}

const twoOfThree: VerifyReadout = {
  matched: [
    { profileId: "p", rule: rule("r1", "authorization"), count: 12 },
    {
      profileId: "p",
      rule: rule("r2", "access-control-allow-origin"),
      count: 4,
    },
  ],
  unmatched: [
    {
      profileId: "p",
      rule: rule("r3", "x-feature-override"),
      hint: "needs-access",
    },
  ],
  total: 3,
};

describe("VerifyPanel readout", () => {
  it("shows the honest fraction, per-rule tallies, and the static hint", () => {
    const { panel } = mount(twoOfThree);
    expect(panel.querySelector(".verify-summary")?.textContent).toBe(
      "2 of 3 rules matched on this tab · last 5 min",
    );

    const fired = [...panel.querySelectorAll(".verify-row:not(.unmatched)")];
    expect(
      fired.map((row) => row.querySelector(".verify-name")?.textContent),
    ).toEqual(["authorization", "access-control-allow-origin"]);
    expect(fired[0]?.querySelector(".verify-tally")?.textContent).toBe("×12");

    const missed = panel.querySelector(".verify-row.unmatched") as HTMLElement;
    expect(missed.textContent).toContain("x-feature-override");
    expect(missed.querySelector(".verify-hint")?.textContent).toBe(
      " — needs access",
    );
    expect(missed.querySelector(".verify-tally")?.textContent).toBe("×0");
  });

  it("labels tallies for assistive tech and hides the lamp glyphs", () => {
    const { panel } = mount(twoOfThree);
    expect(
      panel
        .querySelector(".verify-row .verify-tally")
        ?.getAttribute("aria-label"),
    ).toBe("12 matches");
    expect(
      panel
        .querySelector(".verify-row.unmatched .verify-tally")
        ?.getAttribute("aria-label"),
    ).toBe("no matches");
    for (const lamp of panel.querySelectorAll(".verify-lamp")) {
      expect(lamp.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("carries the honest-limits footer verbatim from the spec", () => {
    const { panel } = mount(twoOfThree);
    expect(panel.querySelector(".verify-limits")?.textContent).toBe(
      copy.verify.limits,
    );
  });

  it("replaces the rows with the zero-match guidance verbatim when nothing fired", () => {
    const { panel } = mount({
      matched: [],
      unmatched: [{ profileId: "p", rule: rule("r1", "authorization") }],
      total: 1,
    });
    expect(panel.querySelector(".verify-guidance")?.textContent).toBe(
      copy.errors.verifyNoMatch,
    );
    expect(panel.querySelector(".verify-rows")).toBeNull();
    expect(panel.querySelector(".verify-summary")?.textContent).toBe(
      "0 of 1 rules matched on this tab · last 5 min",
    );
  });

  it("lists a no-match rule without a hint when no static cause is known", () => {
    const { panel } = mount({
      matched: [
        { profileId: "p", rule: rule("r1", "authorization"), count: 2 },
      ],
      unmatched: [{ profileId: "p", rule: rule("r2", "x-trace-id") }],
      total: 2,
    });
    const missed = panel.querySelector(".verify-row.unmatched") as HTMLElement;
    expect(missed.textContent).toContain("x-trace-id");
    expect(missed.querySelector(".verify-hint")).toBeNull();
  });

  it("moves focus to the summary and announces it politely on open", () => {
    const { root, panel } = mount(twoOfThree);
    expect(document.activeElement).toBe(panel.querySelector(".verify-summary"));
    expect(root.querySelector(".sr-only")?.textContent).toBe(
      "2 of 3 rules matched on this tab · last 5 min",
    );
  });

  it("closes on the close control and on Escape", () => {
    const { panel, onClose } = mount(twoOfThree);
    fire(() => (panel.querySelector(".icon-btn") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(1);

    press(panel, "Escape");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

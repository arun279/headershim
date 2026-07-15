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

interface Blocked {
  ruleCount: number;
  host: string;
  moreSites: number;
}

function mount(readout: VerifyReadout, blocked?: Blocked) {
  const onClose = vi.fn();
  const onGrant = vi.fn();
  const onReload = vi.fn();
  const root = render(
    <LiveRegionProvider>
      <VerifyPanel
        readout={readout}
        blocked={blocked}
        onGrant={onGrant}
        onReload={onReload}
        onClose={onClose}
      />
    </LiveRegionProvider>,
  );
  const panel = root.querySelector(".verify-sheet") as HTMLElement;
  return { root, panel, onClose, onGrant, onReload };
}

const twoMatched: VerifyReadout = {
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

const nothingFired: VerifyReadout = {
  matched: [],
  unmatched: [{ profileId: "p", rule: rule("r1", "authorization") }],
  total: 1,
};

describe("VerifyPanel readout", () => {
  it("leads with the match count, per-rule tallies, and the static hint", () => {
    const { panel } = mount(twoMatched);
    expect(panel.querySelector(".verify-summary")?.textContent).toBe(
      "Last request: 2 matched",
    );

    const fired = [...panel.querySelectorAll(".verify-row:not(.unmatched)")];
    expect(
      fired.map((row) => row.querySelector(".verify-name")?.textContent),
    ).toEqual(["authorization", "access-control-allow-origin"]);
    expect(fired[0]?.querySelector(".verify-tally")?.textContent).toBe("×12");

    const missed = panel.querySelector(".verify-row.unmatched") as HTMLElement;
    expect(missed.textContent).toContain("x-feature-override");
    expect(missed.querySelector(".verify-hint")?.textContent).toBe(
      " · needs access",
    );
    expect(missed.querySelector(".verify-tally")?.textContent).toBe("×0");
  });

  it("labels tallies for assistive tech and hides the lamp glyphs", () => {
    const { panel } = mount(twoMatched);
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

  it("carries the honest-limits footer verbatim", () => {
    const { panel } = mount(twoMatched);
    expect(panel.querySelector(".verify-limits")?.textContent).toBe(
      copy.verify.limits,
    );
  });

  it("leads with reload-to-test when nothing fired and nothing is blocked", () => {
    const { panel, onReload } = mount(nothingFired);
    expect(panel.querySelector(".verify-summary")?.textContent).toBe(
      copy.verify.noRequestHeadline,
    );
    expect(panel.querySelector(".verify-rows")).toBeNull();
    expect(panel.querySelector(".verify-recover-hint")?.textContent).toBe(
      copy.verify.reloadHint,
    );
    expect(panel.querySelector(".verify-guidance")?.textContent).toBe(
      copy.verify.stillNothing,
    );

    const reload = [...panel.querySelectorAll("button")].find(
      (button) => button.textContent === copy.actions.reloadTab,
    ) as HTMLButtonElement;
    fire(() => reload.click());
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("leads with the grant gap and surfaces Grant when a rule is blocked", () => {
    const { panel, onGrant } = mount(nothingFired, {
      ruleCount: 1,
      host: "api.example.com",
      moreSites: 0,
    });
    expect(panel.querySelector(".verify-summary")?.textContent).toBe(
      "1 rule can't run. Needs access to api.example.com.",
    );
    // The caching essay never leads over the more basic precondition.
    expect(panel.querySelector(".verify-rows")).toBeNull();
    expect(panel.querySelector(".verify-guidance")).toBeNull();

    const grant = [...panel.querySelectorAll("button")].find(
      (button) => button.textContent === copy.actions.grantAccess,
    ) as HTMLButtonElement;
    fire(() => grant.click());
    expect(onGrant).toHaveBeenCalledTimes(1);
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

  it("moves focus to the headline and announces it politely on open", () => {
    const { root, panel } = mount(twoMatched);
    expect(document.activeElement).toBe(panel.querySelector(".verify-summary"));
    expect(root.querySelector(".sr-only")?.textContent).toBe(
      "Last request: 2 matched",
    );
  });

  it("closes on the close control and on Escape", () => {
    const { panel, onClose } = mount(twoMatched);
    fire(() => (panel.querySelector(".icon-btn") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(1);

    press(panel, "Escape");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

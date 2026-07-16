// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { Rule } from "../../core/model";
import type { VerifyReadout } from "../../core/verify";
import { render } from "../test/render";
import { VerifyResult } from "./VerifyPanel";

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
  const root = render(<VerifyResult readout={readout} blocked={blocked} />);
  const result = root.querySelector(".verify-inline-result") as HTMLElement;
  return { root, result };
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
};

const nothingFired: VerifyReadout = {
  matched: [],
};

describe("VerifyResult", () => {
  it("shows the matched-rule count in one short line", () => {
    const { result } = mount(twoMatched);
    expect(result.textContent).toBe("Last 5 minutes: 2 matched");
    expect(result.children).toHaveLength(0);
  });

  it("does not expand into per-rule tallies or unmatched guidance", () => {
    const { root } = mount(twoMatched);
    expect(root.querySelector(".verify-row")).toBeNull();
    expect(root.textContent).not.toContain("authorization");
    expect(root.textContent).not.toContain("needs access");
  });

  it("keeps the result in the plain UI face", () => {
    const { result } = mount(twoMatched);
    expect(result.querySelector(".mono")).toBeNull();
  });

  it("exposes the complete line as a title when CSS truncates it", () => {
    const { result } = mount(twoMatched);
    expect(result.title).toBe(result.textContent);
  });

  it("states the honest match window when nothing fired", () => {
    const { result } = mount(nothingFired);
    expect(result.textContent).toBe(
      "No matches in the last 5 minutes on this tab.",
    );
  });

  it("leads with the grant precondition when a rule is blocked", () => {
    const { result } = mount(nothingFired, {
      ruleCount: 1,
      host: "api.example.com",
      moreSites: 0,
    });
    expect(result.textContent).toBe(
      "1 rule can't run. Needs access to api.example.com.",
    );
  });

  it("counts additional blocked sites without adding controls", () => {
    const { root, result } = mount(nothingFired, {
      ruleCount: 2,
      host: "api.example.com",
      moreSites: 2,
    });
    expect(result.textContent).toBe(
      "2 rules can't run. Needs access to api.example.com and 2 more sites.",
    );
    expect(root.querySelector("button")).toBeNull();
  });

  it("uses only its status live region to announce the on-demand result", () => {
    const { root, result } = mount(twoMatched);
    expect(result.getAttribute("role")).toBe("status");
    expect(root.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(root.querySelector(".sr-only")).toBeNull();
  });
});

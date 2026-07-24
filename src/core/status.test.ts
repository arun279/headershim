import { describe, expect, it } from "vitest";
import type { StateDoc } from "./model";
import { computeStatus } from "./status";

function doc(paused: boolean): StateDoc {
  return {
    v: 1,
    profiles: [],
    activeProfileId: "",
    nextRuleNum: 1,
    settings: { paused, theme: "system" },
  };
}

describe("computeStatus precedence", () => {
  it("puts paused above a failed reconcile", () => {
    expect(computeStatus({ doc: doc(true), reconcileError: true })).toBe(
      "paused",
    );
  });

  it("reports out-of-sync on a failed reconcile", () => {
    expect(computeStatus({ doc: doc(false), reconcileError: true })).toBe(
      "out-of-sync",
    );
  });

  it("is live once nothing outranks it", () => {
    expect(computeStatus({ doc: doc(false), reconcileError: false })).toBe(
      "live",
    );
  });
});

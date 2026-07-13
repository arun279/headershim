import { describe, expect, it } from "vitest";
import { BADGE_PALETTE, planBadge } from "./badge";
import type { Profile, StateDoc } from "./model";

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "profile-1",
    name: "Default",
    badgeText: "DE",
    color: "indigo",
    enabled: true,
    rules: [],
    ...overrides,
  };
}

function doc(overrides: Partial<StateDoc> = {}): StateDoc {
  return {
    v: 1,
    profiles: [profile()],
    focusedProfileId: "profile-1",
    nextRuleNum: 1,
    settings: { paused: false, theme: "system", badgeMode: "count" },
    ...overrides,
  };
}

function input(
  stateDoc: StateDoc,
  needsAccess = false,
  overrideTabIds: number[] = [],
) {
  return { doc: stateDoc, needsAccess, overrideTabIds };
}

describe("planBadge", () => {
  it("paints paused grey over every other state, with no text anywhere", () => {
    const paused = doc({
      settings: { paused: true, theme: "system", badgeMode: "initials" },
    });

    expect(planBadge(input(paused, true, [7]))).toEqual({
      state: {
        kind: "manual",
        global: true,
        text: "",
        backgroundColor: "#6E7B88",
        textColor: "#FFFFFF",
      },
      tabBadges: [],
    });
  });

  it("paints needs-access amber when not paused", () => {
    const plan = planBadge(input(doc(), true, [7]));

    expect(plan.state).toMatchObject({
      kind: "manual",
      global: true,
      text: "",
      backgroundColor: "#B07B00",
    });
    expect(plan.tabBadges).toEqual([]);
  });

  it("uses Chrome-managed count text on the focused profile color in count mode", () => {
    expect(planBadge(input(doc())).state).toEqual({
      kind: "count",
      backgroundColor: BADGE_PALETTE.indigo,
      textColor: "#FFFFFF",
    });
  });

  it("paints the focused profile initials in initials mode and marks override tabs", () => {
    const initials = doc({
      settings: { paused: false, theme: "system", badgeMode: "initials" },
    });

    expect(planBadge(input(initials, false, [4, 9]))).toEqual({
      state: {
        kind: "manual",
        global: false,
        text: "DE",
        backgroundColor: BADGE_PALETTE.indigo,
        textColor: "#FFFFFF",
      },
      tabBadges: [
        { tabId: 4, text: "T" },
        { tabId: 9, text: "T" },
      ],
    });
  });

  it("shows an empty neutral badge when no profile is enabled", () => {
    const disabled = doc({
      profiles: [profile({ enabled: false })],
      settings: { paused: false, theme: "system", badgeMode: "initials" },
    });

    const plan = planBadge(input(disabled, false, [4]));

    expect(plan.state).toMatchObject({
      kind: "manual",
      text: "",
      backgroundColor: "#6E7B88",
    });
    expect(plan.tabBadges).toEqual([{ tabId: 4, text: "T" }]);
  });
});

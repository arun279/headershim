import { describe, expect, it } from "vitest";
import { BADGE_PALETTE, planBadge } from "./badge";
import type { Profile, Settings, StateDoc } from "./model";

const NEUTRAL_GREY = "#6E7B88";
const WHITE = "#FFFFFF";

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "profile-1",
    name: "Default",
    badgeText: "DE",
    color: "indigo",
    rules: [],
    ...overrides,
  };
}

function doc(overrides: Partial<StateDoc> = {}): StateDoc {
  return {
    v: 1,
    profiles: [profile()],
    activeProfileId: "profile-1",
    nextRuleNum: 1,
    settings: { paused: false, theme: "system" },
    ...overrides,
  };
}

function settings(overrides: Partial<Settings>): Settings {
  return { paused: false, theme: "system", ...overrides };
}

describe("planBadge", () => {
  it("paints the active profile's badge text in its palette colour", () => {
    const active = doc({
      profiles: [profile({ badgeText: "PR", color: "crimson" })],
    });

    expect(planBadge(active)).toEqual({
      state: {
        text: "PR",
        backgroundColor: BADGE_PALETTE.crimson,
        textColor: WHITE,
      },
      title: "",
    });
  });

  it("paints paused grey with a pause mark over the active profile", () => {
    const paused = doc({ settings: settings({ paused: true }) });

    expect(planBadge(paused)).toEqual({
      state: { text: "II", backgroundColor: NEUTRAL_GREY, textColor: WHITE },
      title: "HeaderShim: paused",
    });
  });
});

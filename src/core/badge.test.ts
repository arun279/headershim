import { describe, expect, it } from "vitest";
import { BADGE_PALETTE, type BadgeInput, planBadge } from "./badge";
import type { Profile, Settings, StateDoc } from "./model";
import { computeStatus } from "./status";

const PAUSED_GREY = "#6E7B88";
const CANT_RUN_AMBER = "#B07B00";
const NEUTRAL_GREY = "#6E7B88";
const WHITE = "#FFFFFF";

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

interface InputOptions {
  doc: StateDoc;
  needsAccess?: boolean;
  reconcileError?: boolean;
  overrideTabIds?: number[];
}

// Badge input flows through the shared status selector, exactly as the
// background composes it, so precedence is tested end to end.
function input({
  doc: stateDoc,
  needsAccess = false,
  reconcileError = false,
  overrideTabIds = [],
}: InputOptions): BadgeInput {
  return {
    doc: stateDoc,
    status: computeStatus({
      doc: stateDoc,
      reconcileError,
      grantGaps: needsAccess
        ? [
            {
              profileId: "profile-1",
              ruleId: "rule-1",
              missing: ["*://*.api.example.com/*"],
            },
          ]
        : [],
    }),
    overrideTabIds,
  };
}

function settings(overrides: Partial<Settings>): Settings {
  return { paused: false, theme: "system", badgeMode: "count", ...overrides };
}

describe("planBadge precedence", () => {
  it("paints paused grey over every other state, with no text anywhere", () => {
    const paused = doc({ settings: settings({ paused: true }) });

    expect(
      planBadge(
        input({
          doc: paused,
          needsAccess: true,
          reconcileError: true,
          overrideTabIds: [7],
        }),
      ),
    ).toEqual({
      state: {
        kind: "manual",
        text: "",
        backgroundColor: PAUSED_GREY,
        textColor: WHITE,
      },
      tabBadges: [],
      title: "headershim — paused",
    });
  });

  it("paints the amber can't-run badge when reconcile has failed, even with access and count mode", () => {
    expect(planBadge(input({ doc: doc(), reconcileError: true }))).toEqual({
      state: {
        kind: "manual",
        text: "",
        backgroundColor: CANT_RUN_AMBER,
        textColor: WHITE,
      },
      tabBadges: [],
      title: "",
    });
  });

  it("paints amber for a missing grant and does not double up when reconcile also failed", () => {
    const needs = planBadge(input({ doc: doc(), needsAccess: true }));
    const both = planBadge(
      input({ doc: doc(), needsAccess: true, reconcileError: true }),
    );

    expect(needs.state).toMatchObject({
      kind: "manual",
      text: "",
      backgroundColor: CANT_RUN_AMBER,
    });
    expect(both).toEqual(needs);
  });

  it("uses Chrome-managed count text on the focused profile color in count mode", () => {
    expect(planBadge(input({ doc: doc() })).state).toEqual({
      kind: "count",
      backgroundColor: BADGE_PALETTE.indigo,
      textColor: WHITE,
    });
  });

  it("paints the focused profile initials in initials mode without per-tab markers", () => {
    const initials = doc({ settings: settings({ badgeMode: "initials" }) });

    expect(planBadge(input({ doc: initials, overrideTabIds: [4, 9] }))).toEqual(
      {
        state: {
          kind: "manual",
          text: "DE",
          backgroundColor: BADGE_PALETTE.indigo,
          textColor: WHITE,
        },
        tabBadges: [],
        title: "",
      },
    );
  });

  it("shows an empty neutral badge with a per-tab T marker on override tabs when no profile is enabled", () => {
    const disabled = doc({
      profiles: [profile({ enabled: false })],
      settings: settings({ badgeMode: "initials" }),
    });

    expect(planBadge(input({ doc: disabled, overrideTabIds: [4, 9] }))).toEqual(
      {
        state: {
          kind: "manual",
          text: "",
          backgroundColor: NEUTRAL_GREY,
          textColor: WHITE,
        },
        tabBadges: [
          { tabId: 4, text: "T" },
          { tabId: 9, text: "T" },
        ],
        title: "",
      },
    );
  });

  it("leaves the count to Chrome on a neutral background when no profile is enabled", () => {
    const disabled = doc({ profiles: [profile({ enabled: false })] });

    expect(planBadge(input({ doc: disabled, overrideTabIds: [4] }))).toEqual({
      state: { kind: "count", backgroundColor: NEUTRAL_GREY, textColor: WHITE },
      tabBadges: [],
      title: "",
    });
  });
});

describe("planBadge single-winner precedence across the input space", () => {
  const bits = [false, true];
  const modes = ["count", "initials"] as const;

  for (const paused of bits) {
    for (const needsAccess of bits) {
      for (const reconcileError of bits) {
        for (const badgeMode of modes) {
          for (const enabled of bits) {
            for (const withOverrides of bits) {
              const overrideTabIds = withOverrides ? [4, 9] : [];
              const label = `paused=${paused} needs=${needsAccess} reconcile=${reconcileError} mode=${badgeMode} enabled=${enabled} overrides=${withOverrides}`;
              const cantRun = needsAccess || reconcileError;

              it(`resolves a single winner: ${label}`, () => {
                const plan = planBadge(
                  input({
                    doc: doc({
                      profiles: [profile({ enabled })],
                      settings: settings({ paused, badgeMode }),
                    }),
                    needsAccess,
                    reconcileError,
                    overrideTabIds,
                  }),
                );

                // The Chrome-managed count is the only source of a count kind,
                // and only when no higher-priority state has taken over.
                expect(plan.state.kind === "count").toBe(
                  !paused && !cantRun && badgeMode === "count",
                );

                // Manual initials text belongs to an enabled profile in
                // initials mode alone; it never bleeds under a global state.
                if (plan.state.kind === "manual") {
                  expect(plan.state.text).toBe(
                    !paused && !cantRun && badgeMode === "initials" && enabled
                      ? "DE"
                      : "",
                  );
                }

                // Per-tab "T" markers ride only a neutral initials badge, so a
                // stale "T" can never sit on a paused or amber background.
                expect(plan.tabBadges).toEqual(
                  !paused &&
                    !cantRun &&
                    badgeMode === "initials" &&
                    !enabled &&
                    withOverrides
                    ? [
                        { tabId: 4, text: "T" },
                        { tabId: 9, text: "T" },
                      ]
                    : [],
                );

                // One background wins the whole precedence ladder.
                expect(plan.state.backgroundColor).toBe(
                  paused
                    ? PAUSED_GREY
                    : cantRun
                      ? CANT_RUN_AMBER
                      : enabled
                        ? BADGE_PALETTE.indigo
                        : NEUTRAL_GREY,
                );
                expect(plan.state.textColor).toBe(WHITE);

                // Only the paused state names itself in the tooltip; every
                // other winner clears back to the default title (SPEC §4.4).
                expect(plan.title).toBe(paused ? "headershim — paused" : "");
              });
            }
          }
        }
      }
    }
  }
});

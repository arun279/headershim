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

interface InputOptions {
  doc: StateDoc;
  needsAccess?: boolean;
  reconcileError?: boolean;
}

// Badge input flows through the shared status selector, exactly as the
// background composes it, so precedence is tested end to end.
function input({
  doc: stateDoc,
  needsAccess = false,
  reconcileError = false,
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
  };
}

function settings(overrides: Partial<Settings>): Settings {
  return { paused: false, theme: "system", ...overrides };
}

describe("planBadge precedence", () => {
  it("paints paused grey over every other state with a visible pause mark", () => {
    const paused = doc({ settings: settings({ paused: true }) });

    expect(
      planBadge(
        input({
          doc: paused,
          needsAccess: true,
          reconcileError: true,
        }),
      ),
    ).toEqual({
      state: {
        kind: "manual",
        text: "II",
        backgroundColor: PAUSED_GREY,
        textColor: WHITE,
      },
      title: "HeaderShim: paused",
    });
  });

  it("paints the amber can't-run badge when reconcile has failed, even with access", () => {
    expect(planBadge(input({ doc: doc(), reconcileError: true }))).toEqual({
      state: {
        kind: "manual",
        text: "!",
        backgroundColor: CANT_RUN_AMBER,
        textColor: WHITE,
      },
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
      text: "!",
      backgroundColor: CANT_RUN_AMBER,
    });
    expect(both).toEqual(needs);
  });

  it("uses Chrome-managed count text on the active profile color", () => {
    expect(planBadge(input({ doc: doc() })).state).toEqual({
      kind: "count",
      backgroundColor: BADGE_PALETTE.indigo,
      textColor: WHITE,
    });
  });

  it("leaves the count to Chrome on a neutral background when no profile is active", () => {
    const disabled = doc({ activeProfileId: undefined });

    expect(planBadge(input({ doc: disabled }))).toEqual({
      state: { kind: "count", backgroundColor: NEUTRAL_GREY, textColor: WHITE },
      title: "",
    });
  });
});

describe("planBadge single-winner precedence across the input space", () => {
  const bits = [false, true];

  for (const paused of bits) {
    for (const needsAccess of bits) {
      for (const reconcileError of bits) {
        for (const active of bits) {
          const label = `paused=${paused} needs=${needsAccess} reconcile=${reconcileError} active=${active}`;
          const cantRun = needsAccess || reconcileError;

          it(`resolves a single winner: ${label}`, () => {
            const plan = planBadge(
              input({
                doc: doc({
                  activeProfileId: active ? "profile-1" : undefined,
                  settings: settings({ paused }),
                }),
                needsAccess,
                reconcileError,
              }),
            );

            // The Chrome-managed count wins only when no higher-priority state
            // has taken over.
            expect(plan.state.kind === "count").toBe(!paused && !cantRun);

            if (plan.state.kind === "manual") {
              expect(plan.state.text).toBe(paused ? "II" : "!");
            }

            // One background wins the whole precedence ladder.
            expect(plan.state.backgroundColor).toBe(
              paused
                ? PAUSED_GREY
                : cantRun
                  ? CANT_RUN_AMBER
                  : active
                    ? BADGE_PALETTE.indigo
                    : NEUTRAL_GREY,
            );
            expect(plan.state.textColor).toBe(WHITE);

            // Only the paused state names itself in the tooltip; every other
            // winner clears back to the default title.
            expect(plan.title).toBe(paused ? "HeaderShim: paused" : "");
          });
        }
      }
    }
  }
});

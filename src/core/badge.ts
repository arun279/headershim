import type { BadgeColor, StateDoc } from "./model";

export interface TabBadgeText {
  readonly tabId: number;
  readonly text: string;
}

interface BadgeColors {
  readonly backgroundColor: string;
  readonly textColor: string;
}

export type BadgeState =
  | (BadgeColors & { readonly kind: "count" })
  | (BadgeColors & {
      readonly kind: "manual";
      readonly global: boolean;
      readonly text: string;
    });

export interface BadgePlan {
  readonly state: BadgeState;
  readonly tabBadges: readonly TabBadgeText[];
}

export interface BadgeInput {
  readonly doc: StateDoc;
  readonly needsAccess: boolean;
  readonly overrideTabIds: readonly number[];
}

export const BADGE_PALETTE = {
  indigo: "#4F5BC4",
  blue: "#1A6BC7",
  teal: "#0B7285",
  green: "#1D7A46",
  plum: "#7A3FB5",
  magenta: "#B03A78",
  crimson: "#C03538",
  slate: "#46586B",
} as const satisfies Record<BadgeColor, string>;

const WHITE = "#FFFFFF";
const PAUSED_FILL = "#6E7B88";
const NEEDS_ACCESS_FILL = "#B07B00";
const NEUTRAL_FILL = "#6E7B88";

export function planBadge({
  doc,
  needsAccess,
  overrideTabIds,
}: BadgeInput): BadgePlan {
  if (doc.settings.paused) {
    return globalBadge(PAUSED_FILL);
  }
  if (needsAccess) {
    return globalBadge(NEEDS_ACCESS_FILL);
  }

  const focused = doc.profiles.some((profile) => profile.enabled)
    ? doc.profiles.find((profile) => profile.id === doc.focusedProfileId)
    : undefined;
  const backgroundColor =
    focused === undefined ? NEUTRAL_FILL : BADGE_PALETTE[focused.color];
  if (doc.settings.badgeMode === "count") {
    return {
      state: { kind: "count", backgroundColor, textColor: WHITE },
      tabBadges: [],
    };
  }
  return {
    state: {
      kind: "manual",
      global: false,
      text: focused?.badgeText ?? "",
      backgroundColor,
      textColor: WHITE,
    },
    tabBadges: overrideTabIds.map((tabId) => ({ tabId, text: "T" })),
  };
}

function globalBadge(backgroundColor: string): BadgePlan {
  return {
    state: {
      kind: "manual",
      global: true,
      text: "",
      backgroundColor,
      textColor: WHITE,
    },
    tabBadges: [],
  };
}

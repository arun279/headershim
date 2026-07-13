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
  | (BadgeColors & { readonly kind: "manual"; readonly text: string });

export interface BadgePlan {
  readonly state: BadgeState;
  readonly tabBadges: readonly TabBadgeText[];
}

export interface BadgeInput {
  readonly doc: StateDoc;
  readonly needsAccess: boolean;
  readonly reconcileError: boolean;
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
const CANT_RUN_FILL = "#B07B00";
const NEUTRAL_FILL = "#6E7B88";

export function planBadge({
  doc,
  needsAccess,
  reconcileError,
  overrideTabIds,
}: BadgeInput): BadgePlan {
  if (doc.settings.paused) {
    return globalBadge(PAUSED_FILL);
  }
  // A missing grant and a failed reconcile are both can't-run states: rules the
  // user believes are live are not. The amber badge outranks either content
  // mode so no count or initials bleeds through (SPEC §4.4 precedence).
  if (reconcileError || needsAccess) {
    return globalBadge(CANT_RUN_FILL);
  }

  const focused = doc.profiles.some((profile) => profile.enabled)
    ? doc.profiles.find((profile) => profile.id === doc.focusedProfileId)
    : undefined;
  const backgroundColor =
    focused === undefined ? NEUTRAL_FILL : BADGE_PALETTE[focused.color];

  if (doc.settings.badgeMode === "count") {
    // Count is Chrome-managed per tab: an enabled profile paints its matches
    // everywhere, and with none enabled only This-tab overrides increment it.
    return {
      state: { kind: "count", backgroundColor, textColor: WHITE },
      tabBadges: [],
    };
  }

  if (focused === undefined) {
    // No enabled profile: the badge is empty and neutral, except tabs holding a
    // This-tab override carry a temporary "T" so modified traffic is never
    // invisible (SPEC §4.4).
    return {
      state: { kind: "manual", text: "", backgroundColor, textColor: WHITE },
      tabBadges: overrideTabIds.map((tabId) => ({ tabId, text: "T" })),
    };
  }
  return {
    state: {
      kind: "manual",
      text: focused.badgeText,
      backgroundColor,
      textColor: WHITE,
    },
    tabBadges: [],
  };
}

function globalBadge(backgroundColor: string): BadgePlan {
  return {
    state: { kind: "manual", text: "", backgroundColor, textColor: WHITE },
    tabBadges: [],
  };
}

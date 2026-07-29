import { BRAND_NAME } from "../brand";
import { activeProfile, type BadgeColor, type StateDoc } from "./model";

interface BadgeState {
  readonly text: string;
  readonly backgroundColor: string;
  readonly textColor: string;
}

export interface BadgePlan extends BadgeState {
  // The toolbar button's tooltip. Only the paused state names itself;
  // every other state clears back to the manifest default_title. Lives
  // here beside the badge glyphs, not in copy.ts, so the service worker never
  // has to import the whole copy module (it blows the background size budget).
  readonly title: string;
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
const NEUTRAL_FILL = "#6E7B88";
// The paused-state toolbar tooltip; the only state that names itself.
const PAUSED_TITLE = `${BRAND_NAME}: paused`;

// The badge carries one fact on every tab: which profile is active, drawn as its
// badge text in its palette colour. Pause is the single override. Per-site health
// (a missing grant) and transient reconcile failures are surfaced per rule in the
// popup and options, where they can name the site the global badge cannot.
export function planBadge(doc: StateDoc): BadgePlan {
  if (doc.settings.paused) {
    return { ...paint("II", NEUTRAL_FILL), title: PAUSED_TITLE };
  }
  const active = activeProfile(doc);
  return {
    ...paint(active.badgeText, BADGE_PALETTE[active.color]),
    title: "",
  };
}

function paint(text: string, backgroundColor: string): BadgeState {
  return { text, backgroundColor, textColor: WHITE };
}

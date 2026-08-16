import { copy } from "../copy";
import "./PauseBanner.css";

/**
 * The one annunciator for the global pause, stated once at the top of a shell's
 * frame so no page or branch beneath it has to re-say the cause, and none is
 * left to substitute a constant of its own or say nothing.
 */
export function PauseBanner() {
  return (
    <div class="pausebar" role="status">
      <PauseGlyph />
      {copy.readout.pausedBanner}
    </div>
  );
}

function PauseGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="4" y="3" width="3" height="10" rx="1" />
      <rect x="9" y="3" width="3" height="10" rx="1" />
    </svg>
  );
}

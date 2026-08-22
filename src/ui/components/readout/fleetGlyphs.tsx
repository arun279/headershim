import type { Direction } from "../../../core/model";
import { outcomeTone } from "../../dispositionCopy";
import type { Outcome } from "../../state/project";

export function DirectionGlyph({ direction }: { direction: Direction }) {
  return (
    <span class="mono" aria-hidden="true">
      {direction === "request" ? "→" : "←"}
    </span>
  );
}

export function StatusGlyph({
  outcome,
  paused,
}: {
  outcome: Outcome;
  paused: boolean;
}) {
  const tone = outcomeTone(outcome);
  if (tone === "stop") {
    return (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        aria-hidden="true"
      >
        <path d="M3 3l6 6m0-6l-6 6" />
      </svg>
    );
  }
  if (
    paused &&
    (outcome.kind === "placed" ||
      outcome.kind === "partial" ||
      outcome.kind === "runs-if-matched")
  ) {
    return (
      <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <rect x="3" y="2.5" width="2" height="7" rx="0.6" />
        <rect x="7" y="2.5" width="2" height="7" rx="0.6" />
      </svg>
    );
  }
  if (tone === "amber" || tone === "doubt") {
    return (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <circle cx="6" cy="6" r="4" />
    </svg>
  );
}

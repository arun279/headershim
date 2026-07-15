import { useEffect, useRef } from "preact/hooks";
import type {
  VerifyHint,
  VerifyReadout,
  VerifyUnmatchedRule,
} from "../../core/verify";
import { useAnnounce } from "../a11y/LiveRegion";
import { copy, type Sentence, sentenceText } from "../copy";
import { Button } from "./Button";
import { CheckGlyph, TriangleGlyph } from "./glyphs";
import { Sheet } from "./Sheet";
import { sentence } from "./sentence";
import { Truncate } from "./Truncate";
import "./VerifyPanel.css";

interface VerifyBlocked {
  readonly ruleCount: number;
  readonly host: string;
  readonly moreSites: number;
}

interface VerifyPanelProps {
  readout: VerifyReadout;
  /** A grant gap covering the tab: the highest-priority unmet precondition. */
  blocked?: VerifyBlocked | undefined;
  /** Grants the missing sites in the click gesture (surfaced inside Verify). */
  onGrant: () => void;
  /** Reloads the tab so a request actually flows, then closes the panel. */
  onReload: () => void;
  onClose: () => void;
}

/**
 * The proof-of-fire readout in its own popup mode. It leads with
 * the most basic unmet precondition, not the caching essay: a grant
 * gap first — with Grant surfaced here so the user need not dismiss the panel to
 * reach the banner it covers — then "nothing requested yet, reload to test",
 * then the matched tallies. The headline never reads as a configuration score.
 * Opening moves focus to it; it is announced politely; Esc or the close control
 * returns focus to the caller.
 */
export function VerifyPanel({
  readout,
  blocked,
  onGrant,
  onReload,
  onClose,
}: VerifyPanelProps) {
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const announce = useAnnounce();
  const matchedCount = readout.matched.length;
  const noRequest = blocked === undefined && matchedCount === 0;
  const headline: Sentence =
    blocked !== undefined
      ? copy.verify.blockedHeadline(
          blocked.ruleCount,
          blocked.host,
          blocked.moreSites,
        )
      : noRequest
        ? [copy.verify.noRequestHeadline]
        : copy.verify.matchedHeadline(matchedCount);
  const headlineText = sentenceText(headline);

  useEffect(() => {
    summaryRef.current?.focus();
    announce(headlineText);
  }, [headlineText, announce]);

  return (
    <Sheet
      class="verify-sheet"
      label={copy.verify.regionLabel}
      modal={false}
      header={
        <>
          <h1 class="verify-title">{copy.verify.heading}</h1>
          <Button kind="ghost" label={copy.verify.close} onClick={onClose}>
            <CloseGlyph />
          </Button>
        </>
      }
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div class="verify-content">
        <p class="verify-summary" ref={summaryRef} tabIndex={-1}>
          {sentence(headline)}
        </p>

        {blocked !== undefined && (
          <div class="verify-recover">
            <Button kind="caution" onClick={onGrant}>
              {copy.actions.grantAccess}
            </Button>
          </div>
        )}

        {noRequest && (
          <div class="verify-recover">
            <p class="verify-recover-hint">{copy.verify.reloadHint}</p>
            <Button kind="quiet" onClick={onReload}>
              {copy.actions.reloadTab}
            </Button>
          </div>
        )}

        {matchedCount > 0 && (
          <ul class="verify-rows" aria-label={copy.verify.matchedLabel}>
            {readout.matched.map((row) => (
              <li class="verify-row" key={row.rule.id}>
                <span class="verify-lamp fired" aria-hidden="true">
                  <CheckGlyph />
                </span>
                <Truncate value={row.rule.header} class="verify-name mono" />
                <span
                  class="verify-tally mono"
                  role="img"
                  aria-label={copy.verify.matchCount(row.count)}
                >
                  ×{row.count}
                </span>
              </li>
            ))}
          </ul>
        )}

        {matchedCount > 0 && readout.unmatched.length > 0 && (
          <div>
            <p class="silk verify-group-label">{copy.verify.noMatchesLabel}</p>
            <ul class="verify-rows" aria-label={copy.verify.noMatchesLabel}>
              {readout.unmatched.map((row) => (
                <li class="verify-row unmatched" key={row.rule.id}>
                  <span class="verify-lamp missed" aria-hidden="true">
                    <TriangleGlyph />
                  </span>
                  <Truncate value={row.rule.header} class="verify-name mono" />
                  <Hint row={row} />
                  <span
                    class="verify-tally mono"
                    role="img"
                    aria-label={copy.verify.matchCount(0)}
                  >
                    ×0
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {noRequest && <p class="verify-guidance">{copy.verify.stillNothing}</p>}
        <p class="verify-limits">{copy.verify.limits}</p>
      </div>
    </Sheet>
  );
}

function Hint({ row }: { row: VerifyUnmatchedRule }) {
  if (row.hint === undefined) {
    return null;
  }
  return <span class="verify-hint">{` — ${hintText(row.hint)}`}</span>;
}

function hintText(hint: VerifyHint): string {
  return copy.verify.hints[hint];
}

function CloseGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M3 3l6 6M9 3l-6 6"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  );
}

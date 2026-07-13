import { useEffect, useRef } from "preact/hooks";
import type {
  VerifyHint,
  VerifyReadout,
  VerifyUnmatchedRule,
} from "../../core/verify";
import { useAnnounce } from "../a11y/LiveRegion";
import { copy } from "../copy";
import { Button } from "./Button";
import { CheckGlyph, TriangleGlyph } from "./glyphs";
import "./VerifyPanel.css";

interface VerifyPanelProps {
  readout: VerifyReadout;
  onClose: () => void;
}

/**
 * The proof-of-fire readout (SPEC §5), sliding over the footer. It reuses the
 * annunciator's lamp grammar — ✓ advisory for rules that fired, ▲ caution for
 * those that did not — so "can it fire" and "did it fire" speak one language.
 * Opening moves focus to the summary; the summary sentence is announced through
 * the popup's polite live region; Esc or the close control returns focus to the
 * Verify button (the caller). Focus is never trapped.
 */
export function VerifyPanel({ readout, onClose }: VerifyPanelProps) {
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const announce = useAnnounce();
  const summary = copy.verify.summary(readout.matched.length, readout.total);

  useEffect(() => {
    summaryRef.current?.focus();
    announce(summary);
  }, [summary, announce]);

  const zeroMatches = readout.matched.length === 0;

  return (
    <section
      class="verify"
      aria-label={copy.verify.regionLabel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div class="verify-head">
        <span class="silk">{copy.verify.heading}</span>
        <p class="verify-summary" ref={summaryRef} tabIndex={-1}>
          {summary}
        </p>
        <Button kind="ghost" label={copy.verify.close} onClick={onClose}>
          <CloseGlyph />
        </Button>
      </div>

      {zeroMatches ? (
        <p class="verify-guidance">{copy.errors.verifyNoMatch}</p>
      ) : (
        <>
          <ul class="verify-rows" aria-label={copy.verify.matchedLabel}>
            {readout.matched.map((row) => (
              <li class="verify-row" key={row.rule.id}>
                <span class="verify-lamp fired" aria-hidden="true">
                  <CheckGlyph />
                </span>
                <span class="verify-name mono">{row.rule.header}</span>
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
          {readout.unmatched.length > 0 && (
            <div>
              <p class="silk verify-group-label">
                {copy.verify.noMatchesLabel}
              </p>
              <ul class="verify-rows" aria-label={copy.verify.noMatchesLabel}>
                {readout.unmatched.map((row) => (
                  <li class="verify-row unmatched" key={row.rule.id}>
                    <span class="verify-lamp missed" aria-hidden="true">
                      <TriangleGlyph />
                    </span>
                    <span class="verify-name mono">{row.rule.header}</span>
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
        </>
      )}

      <p class="verify-limits">{copy.verify.limits}</p>
    </section>
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

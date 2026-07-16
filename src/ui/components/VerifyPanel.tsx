import type { VerifyReadout } from "../../core/verify";
import { copy, type Sentence, sentenceText } from "../copy";
import "./VerifyPanel.css";

interface VerifyBlocked {
  readonly ruleCount: number;
  readonly host: string;
  readonly moreSites: number;
}

interface VerifyResultProps {
  readout: VerifyReadout;
  blocked?: VerifyBlocked | undefined;
}

/** A single-line, on-demand proof-of-fire result beside the footer action. */
export function VerifyResult({ readout, blocked }: VerifyResultProps) {
  const matchedCount = readout.matched.length;
  const headline: Sentence =
    blocked !== undefined
      ? copy.verify.blockedHeadline(
          blocked.ruleCount,
          blocked.host,
          blocked.moreSites,
        )
      : matchedCount === 0
        ? [copy.verify.noMatchesHeadline]
        : copy.verify.matchedHeadline(matchedCount);
  const text = sentenceText(headline);

  return (
    <p class="verify-inline-result" role="status" title={text}>
      {text}
    </p>
  );
}

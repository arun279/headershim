import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { SystemStatus } from "../../core/status";
import { useAnnounce } from "../a11y/LiveRegion";
import { copy, type Sentence, type SentencePart, sentenceText } from "../copy";
import { Button } from "./Button";
import { TRUNCATION_LIMITS, Truncate } from "./Truncate";
import "./Annunciator.css";

interface AnnunciatorProps {
  status: SystemStatus;
  /** This-tab override rows on the current tab (annunciator live detail). */
  temporaryCount: number;
  activeProfileCount: number;
  onResume: () => void;
  onGrantAccess: () => void;
}

/**
 * The persistent strip under the profile switcher: system state in words, at a
 * fixed position, at all times. Caution states announce assertively on their
 * first appearance per popup open and politely thereafter.
 */
export function Annunciator({
  status,
  temporaryCount,
  activeProfileCount,
  onResume,
  onGrantAccess,
}: AnnunciatorProps) {
  const announce = useAnnounce();
  const alertedKinds = useRef(new Set<SystemStatus["kind"]>());
  const caution =
    status.kind === "needs-access" || status.kind === "out-of-sync";
  const sentence = [
    ...sentenceFor(status, temporaryCount),
    ...(status.kind !== "paused" && activeProfileCount > 1
      ? copy.annunciator.activeProfiles(activeProfileCount)
      : []),
  ];
  const assertive = caution && !alertedKinds.current.has(status.kind);
  const announcement = caution ? sentenceText(sentence) : "";

  // The role swap alone cannot announce a caution present at the popup's first
  // render (AT ignores alerts already mounted), so push it through the root
  // assertive region on first appearance per kind; thereafter it stays polite.
  useEffect(() => {
    if (!assertive) {
      return;
    }
    alertedKinds.current.add(status.kind);
    announce(announcement, { assertive: true });
  }, [assertive, status.kind, announcement, announce]);

  return (
    <div
      class="annunciator"
      data-state={status.kind}
      role={assertive ? "alert" : "status"}
    >
      <span class="lamp" aria-hidden="true">
        {lampGlyph(status.kind)}
      </span>
      <p>{renderSentence(sentence)}</p>
      {status.kind === "paused" && (
        <Button kind="quiet" onClick={onResume}>
          {copy.actions.resume}
        </Button>
      )}
      {status.kind === "needs-access" && (
        <Button kind="caution" onClick={onGrantAccess}>
          {copy.actions.grantAccess}
        </Button>
      )}
    </div>
  );
}

function sentenceFor(status: SystemStatus, temporaryCount: number): Sentence {
  switch (status.kind) {
    case "paused":
      return copy.annunciator.paused;
    case "out-of-sync":
      return copy.annunciator.outOfSync;
    case "needs-access":
      return copy.annunciator.needsAccess(
        status.ruleCount,
        hostLabel(status.hosts[0]),
        Math.max(0, status.hosts.length - 1),
      );
    case "off":
      return copy.annunciator.off;
    case "live":
      // With a This-tab row active, "no rules yet" would deny live traffic
      // modification; the counted form stays honest at zero persistent rules.
      return status.ruleCount === 0 && temporaryCount === 0
        ? copy.annunciator.liveEmpty
        : copy.annunciator.live(
            status.ruleCount,
            status.totalRuleCount,
            temporaryCount,
          );
  }
}

function hostLabel(host: string | undefined): string {
  // The all-sites scope's missing origin is a pattern, not a hostname.
  return host === undefined || host === "*://*/*"
    ? copy.scopeSummary.allSites
    : host;
}

// The state word leads, set off from the detail by a full stop; the renderer
// bolds everything before the first break.
const LEAD_BREAK = ". ";

/** State word bold, hostnames and counts mono, per the annunciator grammar. */
function renderSentence(sentence: Sentence): ComponentChildren {
  const breakIndex = sentence.findIndex(
    (part) => typeof part === "string" && part.includes(LEAD_BREAK),
  );
  if (breakIndex === -1) {
    return renderParts(sentence);
  }

  const broken = sentence[breakIndex] as string;
  const at = broken.indexOf(LEAD_BREAK);
  const lead = [...sentence.slice(0, breakIndex), broken.slice(0, at)];
  const rest = [
    broken.slice(at + LEAD_BREAK.length),
    ...sentence.slice(breakIndex + 1),
  ];
  return (
    <>
      <strong>{renderParts(lead)}</strong>
      {LEAD_BREAK}
      {renderParts(rest)}
    </>
  );
}

function renderParts(parts: readonly SentencePart[]): ComponentChildren {
  return parts.map((part) =>
    typeof part === "string" ? (
      part
    ) : (
      <Truncate
        mode="end"
        value={part.data}
        maxChars={TRUNCATION_LIMITS.domain}
        class="mono"
      />
    ),
  );
}

function lampGlyph(kind: SystemStatus["kind"]) {
  switch (kind) {
    case "paused":
      return (
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M1.5 1h1.6v6H1.5zM4.9 1h1.6v6H4.9z" fill="var(--panel-0)" />
        </svg>
      );
    case "needs-access":
    case "out-of-sync":
      return (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M5 0.5 9.7 9H0.3Z" fill="var(--caution-bg)" />
        </svg>
      );
    case "live":
      return (
        <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
          <circle cx="3" cy="3" r="3" fill="var(--ink-mute)" />
        </svg>
      );
    case "off":
      return (
        <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
          <circle cx="3" cy="3" r="2.5" fill="none" stroke="var(--ink-mute)" />
        </svg>
      );
  }
}

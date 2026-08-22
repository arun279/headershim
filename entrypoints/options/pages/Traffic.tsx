import type { Projection } from "../../../src/core/applied";
import { request as requestPermissions } from "../../../src/platform/permissions";
import { EmptyState } from "../../../src/ui/components/EmptyState";
import {
  DirectionGlyph,
  StatusGlyph,
} from "../../../src/ui/components/readout/fleetGlyphs";
import {
  TRUNCATION_LIMITS,
  Truncate,
} from "../../../src/ui/components/Truncate";
import { copy } from "../../../src/ui/copy";
import {
  copy as optionsCopy,
  siteAccessCopy,
} from "../../../src/ui/copy.options";
import {
  canRun,
  displayTone,
  grantAction,
  transportKey,
  verb,
} from "../../../src/ui/dispositionCopy";
import {
  fleetRules,
  groupBySite,
  type TapeRow,
  tapeRows,
} from "../../../src/ui/state/fleet";
import "./Traffic.css";

const text = optionsCopy.options.traffic;

/**
 * Every change the compiled ruleset carries and where each one stands: applying,
 * a grant away, or refused, with any transport caveat the header carries said
 * beside the status rather than in its place. It reads that ruleset, never the
 * wire, so it states what HeaderShim is set to do and never that a request
 * happened. A rule that is off would do nothing, and nothing is what this page
 * omits. Values are never carried here, so a secret cannot reach it.
 */
export function TrafficPage({ projection }: { projection: Projection }) {
  const fleet = fleetRules(projection);
  const rows = tapeRows(groupBySite(fleet), projection);

  return (
    <section
      class="wb-page"
      aria-labelledby="traffic-title"
      aria-busy={projection.confirmation === "pending" ? "true" : undefined}
    >
      <h1 class="wb-title" id="traffic-title" tabIndex={-1}>
        {text.title}
      </h1>
      {projection.confirmation === "pending" && (
        <p role="status">{copy.readout.outOfSync}</p>
      )}

      <div class="tape">
        {rows.length === 0 ? (
          <div class="tape-empty">
            <EmptyState message={text.empty} />
          </div>
        ) : (
          <ul class="tape-list" aria-label={text.title}>
            {rows.map((row) => (
              <TapeLine key={row.key} row={row} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TapeLine({ row }: { row: TapeRow }) {
  const host = row.kind === "cross-site" ? text.crossSiteHost : row.host;
  const tone = displayTone(row.outcome, row.caveats);
  const grant = grantAction(row.outcome);
  // The pill only on rows that name one site: a concrete host is one request
  // away, while a cross-site row names no single site to ask for and keeps the
  // "needs access" word instead.
  const action =
    grant !== undefined && row.kind === "domain" ? grant : undefined;
  const caveat = caveatWord(row);
  return (
    <li class={`tape-row ${tone}${row.paused ? " paused" : ""}`}>
      <span class="tape-mark" aria-hidden="true">
        <StatusGlyph outcome={row.outcome} paused={row.paused} />
      </span>
      <Truncate
        mode="middle"
        value={host}
        maxChars={TRUNCATION_LIMITS.domain}
        class="mono tape-host"
      />
      <span class="tape-stamp mono">
        <span class="tape-op" aria-hidden="true">
          <DirectionGlyph direction={row.direction} />
        </span>
        <span class="tape-verb">
          {verb(row.outcome, row.operation, row.paused)}
        </span>
        <Truncate
          mode="middle"
          value={row.header}
          maxChars={TRUNCATION_LIMITS.header}
          class="tape-header"
        />
        {/* Two independent facts, as on every change line: where the rule
            stands, and the transport caveat its header carries either way. The
            Grant pill states the access fact itself, so the "needs access" word
            would only repeat it; the caveat word repeats nothing and stays. */}
        <span class="tape-meta">
          {action === undefined && (
            <span class="tape-status" title={statusLabel(row)}>
              {statusLabel(row)}
            </span>
          )}
          {caveat !== undefined && (
            <span class="tape-caveat" title={caveat}>
              {caveat}
            </span>
          )}
          {action !== undefined && (
            <button
              type="button"
              class="grant tape-action"
              aria-label={siteAccessCopy.grantOriginsLabel(action.origins)}
              onClick={() => void requestPermissions([...action.origins])}
            >
              {action.label}
            </button>
          )}
        </span>
      </span>
    </li>
  );
}

// A caveat states a wire consequence, so it says nothing for a row that will
// never reach the wire: a refusal, an over-limit rule, or one shadowed by
// another. A row that is only a grant away still carries it, so this gates on
// canRun rather than on the narrower running test behind the popup's counts.
function caveatWord(row: TapeRow): string | undefined {
  if (!canRun(row.outcome)) return undefined;
  const family = row.caveats.includes("h1-only")
    ? "h1-only"
    : row.caveats.includes("h2-breaking")
      ? "h2-breaking"
      : undefined;
  if (family === undefined) return undefined;
  const key = transportKey(family, row.header);
  // caveatsFor folds host into h1-only, and the options table has no host word.
  return key === "host" ? text.caveat.h1Only : text.caveat[key];
}

function statusLabel(row: TapeRow): string {
  if (row.paused && row.outcome.kind !== "absent") return text.status.paused;
  if (row.outcome.kind === "shadowed") return text.status.overridden;
  if (row.outcome.kind === "pending") return text.status.outOfSync;
  if (row.outcome.kind === "runs-if-matched") {
    return text.status.unconfirmed;
  }
  if (
    (row.outcome.kind === "absent" || row.outcome.kind === "partial") &&
    (row.outcome.reason.kind === "ungranted" ||
      row.outcome.reason.kind === "ungranted-initiator")
  ) {
    return text.status.needsAccess;
  }
  if (row.outcome.kind === "absent" || row.outcome.kind === "partial") {
    return row.outcome.reason.kind === "over-limit"
      ? text.status.overLimit
      : text.status.refused;
  }
  return text.status.live;
}

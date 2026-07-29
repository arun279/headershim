import type { Projection } from "../../../src/core/applied";
import type { StateDoc } from "../../../src/core/model";
import { request as requestPermissions } from "../../../src/platform/permissions";
import { EmptyState } from "../../../src/ui/components/EmptyState";
import {
  DirectionGlyph,
  StatusGlyph,
} from "../../../src/ui/components/readout/fleetGlyphs";
import { Truncate } from "../../../src/ui/components/Truncate";
import { copy, siteAccessCopy } from "../../../src/ui/copy";
import {
  displayTone,
  grantAction,
  verb,
} from "../../../src/ui/dispositionCopy";
import {
  fleetRules,
  groupBySite,
  type TapeRow,
  tapeRows,
} from "../../../src/ui/state/fleet";
import "./Traffic.css";

const text = copy.options.traffic;

/**
 * Every change the compiled ruleset carries and where each one stands: applying,
 * managed by Chrome, a grant away, or refused. It reads that ruleset, never the
 * wire, so it states what HeaderShim is set to do and never that a request
 * happened. A rule that is off would do nothing, and nothing is what this page
 * omits. Values are never carried here, so a secret cannot reach it.
 */
export function TrafficPage({
  doc,
  projection,
}: {
  doc: StateDoc;
  projection: Projection;
}) {
  const fleet = fleetRules(projection, doc);
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
  return (
    <li class={`tape-row ${tone}${row.paused ? " paused" : ""}`}>
      <span class="tape-mark" aria-hidden="true">
        <StatusGlyph outcome={row.outcome} paused={row.paused} />
      </span>
      <Truncate mode="middle" value={host} class="mono tape-host" />
      <span class="tape-stamp mono">
        <span class="tape-op" aria-hidden="true">
          <DirectionGlyph direction={row.direction} />
        </span>
        <span class="tape-verb">
          {verb(row.outcome, row.operation, row.paused)}
        </span>
        <Truncate mode="middle" value={row.header} class="tape-header" />
        {/* A row that says "needs access" and offers no way to give it leaves the
            reader to go and find the Site access page. A concrete host is one
            request away; a cross-site row names no single site to ask for. */}
        {grant !== undefined && row.kind === "domain" ? (
          <button
            type="button"
            class="grant tape-status"
            aria-label={siteAccessCopy.grantOriginsLabel(grant.origins)}
            onClick={() => void requestPermissions([...grant.origins])}
          >
            {grant.label}
          </button>
        ) : (
          <span class="tape-status" title={statusLabel(row)}>
            {statusLabel(row)}
          </span>
        )}
      </span>
    </li>
  );
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
  if (row.caveats.includes("network-managed")) {
    return text.status.managed;
  }
  return text.status.live;
}

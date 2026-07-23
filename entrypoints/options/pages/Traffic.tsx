import type { GrantSnapshot } from "../../../src/core/grants";
import type { StateDoc } from "../../../src/core/model";
import { originPatternForDomain } from "../../../src/core/scope";
import type { SystemStatus } from "../../../src/core/status";
import { request as requestPermissions } from "../../../src/platform/permissions";
import { EmptyState } from "../../../src/ui/components/EmptyState";
import {
  DirectionGlyph,
  StatusGlyph,
} from "../../../src/ui/components/readout/glyphs";
import { ProfileBadge } from "../../../src/ui/components/readout/ProfileBadge";
import {
  TRUNCATION_LIMITS,
  Truncate,
} from "../../../src/ui/components/Truncate";
import { copy } from "../../../src/ui/copy";
import {
  groupBySite,
  projectFleet,
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
  grants,
  status,
  isRegexSupported,
}: {
  doc: StateDoc;
  grants: GrantSnapshot;
  status: SystemStatus;
  isRegexSupported: (regex: string) => boolean;
}) {
  const fleet = projectFleet({
    doc,
    grants,
    isRegexSupported,
    status,
  });
  const rows = tapeRows(groupBySite(fleet));

  return (
    <section class="wb-page" aria-labelledby="traffic-title">
      <h1 class="wb-title" id="traffic-title" tabIndex={-1}>
        {text.title}
      </h1>

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
  return (
    <li class={`tape-row ${row.status}`}>
      <span class="tape-mark" aria-hidden="true">
        <StatusGlyph status={row.status} />
      </span>
      <ProfileBadge
        text={row.provenance.badgeText}
        color={row.provenance.color}
        size={14}
      />
      <Truncate mode="middle" value={host} class="mono tape-host" />
      <span class="tape-stamp mono">
        <span class="tape-op" aria-hidden="true">
          <DirectionGlyph direction={row.direction} />
        </span>
        <span class="tape-verb">{copy.readout.verb[row.operation]}</span>
        <Truncate
          mode="middle"
          value={row.header}
          maxChars={TRUNCATION_LIMITS.header}
          class="tape-header"
        />
      </span>
      {/* A row that says "needs access" and offers no way to give it leaves the
          reader to go and find the Site access page. A concrete host is one
          request away; a cross-site row names no single site to ask for. */}
      {row.status === "needs-access" && row.kind === "domain" ? (
        <button
          type="button"
          class="grant tape-status"
          aria-label={copy.options.siteAccess.grantLabel(row.host)}
          onClick={() =>
            void requestPermissions([originPatternForDomain(row.host)])
          }
        >
          {copy.options.siteAccess.grant}
        </button>
      ) : (
        <span class="tape-status">{statusLabel(row)}</span>
      )}
    </li>
  );
}

function statusLabel(row: TapeRow): string {
  switch (row.status) {
    case "live":
      return text.status.live;
    case "needs-access":
      return text.status.needsAccess;
    case "refused":
      return row.refused === undefined
        ? text.status.refused
        : copy.readout.refusedReason[row.refused];
    case "managed":
      return text.status.managed;
    case "out-of-sync":
      return text.status.outOfSync;
    case "unconfirmed":
      return text.status.unconfirmed;
    case "paused":
      return text.status.paused;
  }
}

import type { GrantSnapshot } from "../../../src/core/grants";
import type { StateDoc } from "../../../src/core/model";
import { OpGlyph } from "../../../src/ui/components/readout/glyphs";
import { ProfileBadge } from "../../../src/ui/components/readout/ProfileBadge";
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
 * The receipt under the fleet's honest-status claims. It reads the compiled
 * state, never the wire: every stamp HeaderShim is set to apply, and every one
 * it is skipping (ungranted) or Chrome refuses. Off rules are not traffic;
 * values are never carried, so a secret is categorically absent from the record.
 */
export function TrafficPage({
  doc,
  grants,
}: {
  doc: StateDoc;
  grants: GrantSnapshot;
}) {
  const fleet = projectFleet({
    profiles: doc.profiles,
    grants,
    paused: doc.settings.paused,
  });
  const rows = tapeRows(groupBySite(fleet));

  return (
    <section class="wb-page" aria-labelledby="traffic-title">
      <div>
        <h1 class="wb-title" id="traffic-title" tabIndex={-1}>
          {text.title}
        </h1>
        <p class="wb-sub">{text.subtitle}</p>
      </div>

      <div class="tape">
        <div class="tape-head">
          <span class="silk">{text.colStamp}</span>
          <span class="tape-secrets">{text.secretsNote}</span>
        </div>
        {rows.length === 0 ? (
          <p class="tape-empty">{text.empty}</p>
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
      <span class="tape-host mono">{host}</span>
      <span class="tape-stamp mono">
        <span class="tape-op" aria-hidden="true">
          <OpGlyph operation={row.operation} />
        </span>
        {row.header}
      </span>
      <span class="tape-status">{statusLabel(row.status)}</span>
    </li>
  );
}

function statusLabel(status: TapeRow["status"]): string {
  switch (status) {
    case "live":
      return text.status.live;
    case "needs-access":
      return text.status.needsAccess;
    case "refused":
      return text.status.refused;
    case "paused":
      return text.status.paused;
  }
}

function StatusGlyph({ status }: { status: TapeRow["status"] }) {
  if (status === "refused") {
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
  if (status === "paused") {
    return (
      <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <rect x="3" y="2.5" width="2" height="7" rx="0.6" />
        <rect x="7" y="2.5" width="2" height="7" rx="0.6" />
      </svg>
    );
  }
  if (status === "needs-access") {
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

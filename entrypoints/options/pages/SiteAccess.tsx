import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import {
  ALL_SITES_ORIGIN,
  type GrantSnapshot,
  isAllSitesOrigin,
  type SiteAccessEntry,
  siteAccessView,
} from "../../../src/core/grants";
import type { StateDoc } from "../../../src/core/model";
import {
  remove as removePermissions,
  request as requestPermissions,
} from "../../../src/platform/permissions";
import { useAnnounce } from "../../../src/ui/a11y/LiveRegion";
import { Button } from "../../../src/ui/components/Button";
import {
  CheckGlyph,
  TriangleGlyph,
} from "../../../src/ui/components/readout/glyphs";
import { Truncate } from "../../../src/ui/components/Truncate";
import { copy } from "../../../src/ui/copy";
import "./SiteAccess.css";

const text = copy.options.siteAccess;

/**
 * Every origin headershim can touch, and every origin its enabled rules still
 * need — the actionable group first. The list is a projection of
 * `permissions.getAll` and the rules' required origins, so a grant or
 * revocation from anywhere (this page, the popup, Chrome's own UI) lands
 * here through `permissions.onChanged` without a reload. The all-sites
 * card is the broad grant's only affordance and keeps its honest framing.
 */
export function SiteAccessPage({
  doc,
  grants,
}: {
  doc: StateDoc;
  grants: GrantSnapshot;
}) {
  const announce = useAnnounce();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [allSitesOpen, setAllSitesOpen] = useState(false);
  const view = siteAccessView(doc, grants);
  // Under the broad grant no rule can want for access, so a per-site list has
  // nothing left to say; the narrow grants that outlived it are still revocable
  // and keep the panel. Otherwise the page would answer "granted" and "nothing
  // granted yet" in the same breath.
  const showSites =
    !grants.allSites || view.needed.length > 0 || view.granted.length > 0;

  // A grant or revocation reparents the row to the other group, unmounting the
  // button that was clicked; land focus on the stable page heading rather than
  // <body> (WCAG 2.4.3).
  const anchorFocus = () => titleRef.current?.focus();

  // permissions.request must run synchronously in the click gesture; the
  // refreshed snapshot moves the row, the live region states the outcome.
  const grant = (entry: SiteAccessEntry) =>
    void requestPermissions([entry.origin]).then((granted) => {
      if (granted) {
        announce(copy.toast.activeOn(entry.domain));
        anchorFocus();
      }
    });

  const revoke = (entry: SiteAccessEntry) =>
    void removePermissions([entry.origin]).then((removed) => {
      if (removed) {
        announce(
          grants.allSites
            ? text.revokedUnderAllSites(entry.domain)
            : text.revoked(entry.domain),
        );
        anchorFocus();
      }
    });

  const grantAllSites = () =>
    void requestPermissions([ALL_SITES_ORIGIN]).then((granted) => {
      if (granted) {
        setAllSitesOpen(false);
        announce(text.allSites.on);
      }
    });

  const revokeAllSites = () =>
    void removePermissions(grants.origins.filter(isAllSitesOrigin)).then(
      (removed) => {
        if (removed) {
          announce(text.allSites.revoked);
        }
      },
    );

  return (
    <section
      class="wb-page site-access-page"
      aria-labelledby="site-access-title"
    >
      <h1 class="wb-title" id="site-access-title" ref={titleRef} tabIndex={-1}>
        {text.title}
      </h1>

      {grants.allSites && (
        <div class="sa-card sa-all-on">
          <p class="sa-all-on-line">
            <span class="sa-glyph granted">
              <CheckGlyph />
            </span>
            {text.allSites.on}
          </p>
          <Button kind="quiet" onClick={revokeAllSites}>
            {text.revoke}
          </Button>
        </div>
      )}

      {showSites && (
        <div class="sa-card">
          {view.needed.length > 0 && (
            <SiteGroup
              heading={text.neededHeading}
              entries={view.needed}
              glyph={
                <span class="sa-glyph needed">
                  <TriangleGlyph />
                </span>
              }
              count={text.usedBy}
              action={text.grant}
              actionLabel={text.grantLabel}
              onAction={grant}
            />
          )}
          {view.granted.length > 0 && (
            <SiteGroup
              heading={text.grantedHeading}
              entries={view.granted}
              glyph={
                <span class="sa-glyph granted">
                  <CheckGlyph />
                </span>
              }
              count={text.ruleCount}
              action={text.revoke}
              actionLabel={text.revokeLabel}
              onAction={revoke}
            />
          )}
          {view.needed.length === 0 && view.granted.length === 0 && (
            <p class="sa-empty">{copy.emptyState.siteAccess}</p>
          )}
          {view.initiatorNote && <p class="sa-note">{text.initiatorNote}</p>}
        </div>
      )}

      {!grants.allSites && (
        <div class="sa-card sa-all-sites">
          <h2 class="sa-all-heading">{text.allSites.heading}</h2>
          <p class="sa-all-body">{text.allSites.consequence}</p>
          <button
            type="button"
            class="sa-disclosure"
            aria-expanded={allSitesOpen}
            aria-controls={allSitesOpen ? "all-sites-details" : undefined}
            onClick={() => setAllSitesOpen((open) => !open)}
          >
            {text.allSites.disclosure}
            <span aria-hidden="true"> {allSitesOpen ? "▾" : "▸"}</span>
          </button>
          {allSitesOpen && (
            <div class="sa-all-details" id="all-sites-details">
              <p class="sa-all-warning">{text.allSites.warning}</p>
              <div>
                <Button kind="quiet" onClick={grantAllSites}>
                  {text.allSites.button}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SiteGroup({
  heading,
  entries,
  glyph,
  count,
  action,
  actionLabel,
  onAction,
}: {
  heading: string;
  entries: readonly SiteAccessEntry[];
  glyph: ComponentChildren;
  count: (n: number) => string;
  action: string;
  actionLabel: (domain: string) => string;
  onAction: (entry: SiteAccessEntry) => void;
}) {
  return (
    <>
      <h2 class="silk sa-group">{heading}</h2>
      <ul class="sa-list" aria-label={heading}>
        {entries.map((entry) => (
          <li key={entry.origin} class="sa-row">
            {glyph}
            {/* The host you are approving is the row's whole subject, and the
                registrable domain is in its tail: no character ceiling, and
                the middle gives way before either end does. */}
            <Truncate
              mode="middle"
              value={entry.domain}
              class="mono sa-domain"
            />
            <span class="sa-count">{count(entry.ruleCount)}</span>
            <Button
              kind="quiet"
              label={actionLabel(entry.domain)}
              onClick={() => onAction(entry)}
            >
              {action}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}

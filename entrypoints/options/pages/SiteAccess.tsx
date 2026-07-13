import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
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
import { CheckGlyph, TriangleGlyph } from "../../../src/ui/components/glyphs";
import { copy } from "../../../src/ui/copy";
import "./SiteAccess.css";

const text = copy.options.siteAccess;

/**
 * Every origin headershim can touch, and every origin its enabled rules still
 * need — the actionable group first (SPEC §4.2, DESIGN §5.10). The list is a
 * projection of `permissions.getAll` and the rules' required origins, so a
 * grant or revocation from anywhere (this page, the popup, Chrome's own UI)
 * lands here through `permissions.onChanged` without a reload. The all-sites
 * card is the broad grant's only affordance and keeps its honest framing
 * (SPEC §3.4).
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
  const view = siteAccessView(doc, grants);

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
    <section class="page" aria-labelledby="site-access-title">
      <h1
        class="page-title"
        id="site-access-title"
        ref={titleRef}
        tabIndex={-1}
      >
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

      {!grants.allSites && (
        <div class="sa-card sa-all-sites">
          <h2 class="sa-all-heading">{text.allSites.heading}</h2>
          <p class="sa-all-body">{text.allSites.body}</p>
          <div>
            <Button kind="quiet" onClick={grantAllSites}>
              {text.allSites.button}
            </Button>
          </div>
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
            <span class="mono sa-domain">{entry.domain}</span>
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

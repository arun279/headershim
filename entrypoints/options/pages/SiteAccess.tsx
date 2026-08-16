import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  ALL_SITES_ORIGIN,
  domainFromOriginPattern,
  type GrantSnapshot,
  isAllSitesOrigin,
  requiredOrigins,
} from "../../../src/core/grants";
import { headerSensitivity } from "../../../src/core/headers";
import {
  activeProfile,
  type StateDoc,
  type TabOverride,
} from "../../../src/core/model";
import {
  snapshot as readPermissions,
  remove as removePermissions,
  request as requestPermissions,
} from "../../../src/platform/permissions";
import {
  read as readSession,
  subscribe as subscribeSession,
} from "../../../src/platform/session-store";
import { useAnnounce } from "../../../src/ui/a11y/LiveRegion";
import { Button } from "../../../src/ui/components/Button";
import {
  CheckGlyph,
  TriangleGlyph,
} from "../../../src/ui/components/readout/glyphs";
import { sentence } from "../../../src/ui/components/sentence";
import { copy, siteAccessCopy } from "../../../src/ui/copy";
import {
  type SiteAccessEntry,
  siteAccessView,
} from "../../../src/ui/state/site-access";
import "./SiteAccess.css";

const text = siteAccessCopy;

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
  const pendingRef = useRef(false);
  const [allSitesOpen, setAllSitesOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const overrides = useSessionOverrides();
  const view = siteAccessView(doc, grants, overrides);
  const hasSiteRows =
    view.needed.length > 0 ||
    view.partial.length > 0 ||
    view.granted.length > 0;
  // A sensitive rule cautions only when its honest requirement is broad access:
  // requiredOrigins yields the all-sites origin for all-scope or hostless
  // pattern/regex rules, the only ones widened beyond one-at-a-time host grants.
  const broadSensitiveCount = activeProfile(doc).rules.filter(
    (rule) =>
      rule.enabled &&
      requiredOrigins(rule).some(isAllSitesOrigin) &&
      headerSensitivity(rule).length > 0,
  ).length;

  // A grant or revocation reparents the row to the other group, unmounting the
  // button that was clicked; land focus on the stable page heading rather than
  // <body> (WCAG 2.4.3).
  const anchorFocus = () => titleRef.current?.focus();

  const runPermission = (
    start: () => Promise<boolean>,
    success: string,
    failure: string,
    collapseAllSites = false,
  ) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    void start()
      .then(
        (completed) => {
          if (completed) {
            if (collapseAllSites) setAllSitesOpen(false);
            announce(success);
            anchorFocus();
          } else {
            announce(failure);
          }
        },
        () => announce(failure),
      )
      .finally(() => {
        pendingRef.current = false;
        setPending(false);
      });
  };

  const grant = (entry: SiteAccessEntry) =>
    runPermission(
      () => requestPermissions([entry.origin]),
      copy.toast.accessGranted,
      text.notGranted(entry.domain),
    );

  const broaden = (entry: SiteAccessEntry) =>
    runPermission(
      () => requestPermissions([entry.origin]),
      text.broadened(entry.domain),
      text.notBroadened(entry.domain),
    );

  const revoke = (entry: SiteAccessEntry) =>
    runPermission(
      () =>
        removeCurrentOrigins(
          (origin) =>
            !isAllSitesOrigin(origin) &&
            domainFromOriginPattern(origin) === entry.domain,
        ),
      grants.allSites
        ? text.revokedUnderAllSites(entry.domain)
        : text.revoked(entry.domain),
      text.revokeFailed(entry.domain),
    );

  const grantAllSites = () =>
    runPermission(
      () => requestPermissions([ALL_SITES_ORIGIN]),
      text.allSites.on,
      text.allSites.notGranted,
      true,
    );

  const revokeAllSites = () =>
    runPermission(
      () => removeCurrentOrigins(isAllSitesOrigin),
      text.allSites.revoked,
      text.allSites.revokeFailed,
    );

  return (
    <section
      class="wb-page"
      aria-labelledby="site-access-title"
      aria-busy={pending ? "true" : undefined}
    >
      <h1 class="wb-title" id="site-access-title" ref={titleRef} tabIndex={-1}>
        {text.title}
      </h1>
      <p class="sa-guidance">{text.guidance}</p>
      {view.initiatorNote && <p class="sa-note">{text.initiatorNote}</p>}

      {grants.allSites && (
        <div class="sa-card sa-all-on">
          <p class="sa-all-on-line">
            <span class="sa-glyph granted">
              <CheckGlyph />
            </span>
            {text.allSites.on}
          </p>
          <Button kind="quiet" disabled={pending} onClick={revokeAllSites}>
            {text.allSites.revoke}
          </Button>
        </div>
      )}

      {hasSiteRows && (
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
              count={usage}
              action={text.grant}
              actionLabel={text.grantLabel}
              pill
              disabled={pending}
              onAction={grant}
            />
          )}
          {view.partial.length > 0 && (
            <SiteGroup
              heading={text.partialHeading}
              entries={view.partial}
              glyph={
                <span class="sa-glyph partial" aria-hidden="true">
                  ◐
                </span>
              }
              count={(entry) => (
                <>
                  {usage(entry)} ·{" "}
                  {sentence(text.partial(entry.coveringOrigins ?? []))}
                </>
              )}
              action={text.broaden}
              actionLabel={text.broadenLabel}
              pill
              disabled={pending}
              onAction={broaden}
              onRevoke={revoke}
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
              count={usage}
              action={text.revoke}
              actionLabel={text.revokeLabel}
              disabled={pending}
              onAction={revoke}
            />
          )}
        </div>
      )}

      {!grants.allSites && !hasSiteRows && (
        <div class="sa-card">
          <p class="sa-empty">{copy.emptyState.siteAccess}</p>
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
            onClick={() => setAllSitesOpen((open) => !open)}
          >
            {text.allSites.disclosure}
            <span aria-hidden="true"> {allSitesOpen ? "▾" : "▸"}</span>
          </button>
          {allSitesOpen && (
            <div class="sa-all-details" id="all-sites-details">
              <p class="sa-all-warning">{text.allSites.warning}</p>
              {broadSensitiveCount > 0 && (
                <p class="sa-all-caution">
                  {text.allSites.sensitive(broadSensitiveCount)}
                </p>
              )}
              <div>
                <Button kind="quiet" disabled={pending} onClick={grantAllSites}>
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

async function removeCurrentOrigins(
  matches: (origin: string) => boolean,
): Promise<boolean> {
  const origins = (await readPermissions()).origins.filter(matches);
  return origins.length === 0 || removePermissions(origins);
}

/** Global session usage belongs to this global page, not the popup's tab view. */
function useSessionOverrides(): readonly TabOverride[] {
  const [overrides, setOverrides] = useState<readonly TabOverride[]>([]);
  useEffect(() => {
    let disposed = false;
    const load = () =>
      readSession().then((session) => {
        if (!disposed) setOverrides(Object.values(session.tabs).flat());
      });
    void load();
    const unsubscribe = subscribeSession(() => void load());
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  return overrides;
}

function SiteGroup({
  heading,
  entries,
  glyph,
  count,
  action,
  actionLabel,
  pill,
  disabled,
  onAction,
  onRevoke,
}: {
  heading: string;
  entries: readonly SiteAccessEntry[];
  glyph: ComponentChildren;
  count: (entry: SiteAccessEntry) => ComponentChildren;
  action: string;
  actionLabel: (domain: string) => string;
  /** Granting is the same act the rule rows offer, so it carries the same pill. */
  pill?: boolean;
  disabled: boolean;
  onAction: (entry: SiteAccessEntry) => void;
  onRevoke?: (entry: SiteAccessEntry) => void;
}) {
  return (
    <>
      <h2 class="silk sa-group">{heading}</h2>
      <ul class="sa-list" aria-label={heading}>
        {entries.map((entry) => (
          <li key={entry.origin} class="sa-row">
            {glyph}
            <span class="mono sa-domain">{entry.domain}</span>
            <span class="sa-count">{count(entry)}</span>
            <span class="sa-actions">
              {pill === true ? (
                <button
                  type="button"
                  class="grant"
                  aria-label={actionLabel(entry.domain)}
                  disabled={disabled}
                  onClick={() => onAction(entry)}
                >
                  {action}
                </button>
              ) : (
                <Button
                  kind="quiet"
                  label={actionLabel(entry.domain)}
                  disabled={disabled}
                  onClick={() => onAction(entry)}
                >
                  {action}
                </Button>
              )}
              {onRevoke !== undefined && entry.grantedOrigins !== undefined && (
                <Button
                  kind="quiet"
                  label={text.revokeLabel(entry.domain)}
                  disabled={disabled}
                  onClick={() => onRevoke(entry)}
                >
                  {text.revoke}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function usage(entry: SiteAccessEntry): string {
  const counts = [
    ...(entry.ruleCount > 0 ? [text.ruleCount(entry.ruleCount)] : []),
    ...(entry.thisTabCount === undefined
      ? []
      : [text.tabCount(entry.thisTabCount)]),
  ];
  return counts.length === 0
    ? text.unused
    : `${text.usageLead(entry.coverage)} ${counts.join(" · ")}`;
}

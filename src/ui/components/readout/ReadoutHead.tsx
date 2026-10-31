import { copy } from "../../copy";
import type { TabReadout } from "../../state/readout";
import { sentence } from "../sentence";
import { TRUNCATION_LIMITS, Truncate } from "../Truncate";
import { GlobeGlyph } from "./glyphs";
import { ProfilePicker, type ProfilePickerProps } from "./ProfilePicker";

type ReadoutHeadProps = Omit<ProfilePickerProps, "onSwitch"> & {
  readout: TabReadout;
  hasRows: boolean;
  globalNeedsAccess: boolean;
  paused: boolean;
  onSwitchProfile: (profileId: string) => void;
};

/**
 * The calmest, most valuable row leads with the site (the one thing you most
 * need to confirm), then answers the one question in a single line. Only the
 * exceptions get a substatus, and they are counted once.
 */
export function ReadoutHead({
  readout,
  hasRows,
  globalNeedsAccess,
  profiles,
  activeProfile,
  previousProfileId,
  switchShortcut,
  projection,
  tab,
  grants,
  overrides,
  isRegexSupported,
  paused,
  onSwitchProfile,
  onNewProfile,
  onRenameProfile,
}: ReadoutHeadProps) {
  const showGlance = readout.host !== undefined && hasRows;

  return (
    <header class="head">
      <div class="head-top">
        {/* The slot names the site this tab is on, in the face reserved for
            literal wire bytes. A tab with no site to name says so in a muted
            marker: an empty slot reads as a dropped element, and the marker is
            plain furniture, not the wire-byte face, so it never reads as a site
            of its own. */}
        {readout.host === undefined ? (
          <span class="site">
            <GlobeGlyph />
            <span class="no-site">{copy.readout.noSite}</span>
          </span>
        ) : (
          <span class="site">
            <GlobeGlyph />
            {/* Middle mode: the registrable domain sits in the tail, and it is
                the whole point of the row. */}
            <Truncate
              mode="middle"
              value={readout.host}
              maxChars={TRUNCATION_LIMITS.domain}
              class="host mono"
            />
          </span>
        )}
        <ProfilePicker
          profiles={profiles}
          activeProfile={activeProfile}
          previousProfileId={previousProfileId}
          switchShortcut={switchShortcut}
          projection={projection}
          tab={tab}
          grants={grants}
          overrides={overrides}
          isRegexSupported={isRegexSupported}
          onSwitch={onSwitchProfile}
          onNewProfile={onNewProfile}
          onRenameProfile={onRenameProfile}
        />
      </div>

      {globalNeedsAccess && (
        <p class="global-access" role="status">
          {copy.readout.globalNeedsAccess}
        </p>
      )}

      {showGlance && <ReadoutGlance readout={readout} paused={paused} />}
    </header>
  );
}

function ReadoutGlance({
  readout,
  paused,
}: {
  readout: TabReadout;
  paused: boolean;
}) {
  const attention =
    readout.needsAccess > 0 ||
    readout.refused > 0 ||
    readout.transport > 0 ||
    readout.security > 0;
  const doubt = readout.unconfirmed > 0;
  const segments = (
    [
      ["needsAccess", "amber"],
      ["refused", "stop"],
      ["transport", "amber"],
      ["security", "amber"],
      ["unconfirmed", "rest"],
      ["overridden", "rest"],
    ] as const
  ).filter(([key]) => readout[key] > 0);
  return (
    <div class="glance-wrap">
      <div class="glance">
        {(readout.total > 0 || readout.held > 0 || attention || doubt) && (
          <span
            class={`lamp ${
              paused ? "held" : attention ? "warn" : doubt ? "doubt" : "live"
            }`}
            aria-hidden="true"
          />
        )}
        <p class="status">
          {sentence(
            copy.readout.status(
              paused ? readout.held : readout.total,
              readout.listed,
              paused,
            ),
          )}
        </p>
      </div>
      {segments.length > 0 && (
        <p class="substatus">
          {segments.map(([key, tone]) => (
            <span key={key} class={`seg ${tone}`}>
              {copy.readout[key](readout[key])}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

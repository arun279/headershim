import type { Profile } from "../../../core/model";
import { copy } from "../../copy";
import type { TabReadout } from "../../state/readout";
import { sentence } from "../sentence";
import { TRUNCATION_LIMITS, Truncate } from "../Truncate";
import { GlobeGlyph } from "./glyphs";
import { ProfilePicker } from "./ProfilePicker";

interface ReadoutHeadProps {
  readout: TabReadout;
  hasRows: boolean;
  profiles: readonly Profile[];
  activeProfile: Profile | undefined;
  paused: boolean;
  onSwitchProfile: (profileId: string) => void;
  onNewProfile: () => void;
}

/**
 * The calmest, most valuable row leads with the site (the one thing you most
 * need to confirm), then answers the one question in a single line. Only the
 * exceptions get a substatus, and they are counted once.
 */
export function ReadoutHead({
  readout,
  hasRows,
  profiles,
  activeProfile,
  paused,
  onSwitchProfile,
  onNewProfile,
}: ReadoutHeadProps) {
  const attention =
    readout.needsAccess > 0 || readout.refused > 0 || readout.outOfSync > 0;
  const showGlance = readout.host !== undefined && hasRows && !paused;

  return (
    <header class="head">
      <div class="head-top">
        <span class="site">
          <GlobeGlyph />
          {/* Middle mode: the registrable domain sits in the tail, and it is
              the whole point of the row. */}
          <Truncate
            mode="middle"
            value={readout.host ?? copy.app.name}
            maxChars={TRUNCATION_LIMITS.domain}
            class="host mono"
          />
        </span>
        <ProfilePicker
          profiles={profiles}
          activeProfile={activeProfile}
          host={readout.host}
          onSwitch={onSwitchProfile}
          onNewProfile={onNewProfile}
        />
      </div>

      {showGlance && (
        <div class="glance-wrap">
          <div class="glance">
            {readout.total > 0 && (
              <span
                class={`lamp ${attention ? "warn" : "live"}`}
                aria-hidden="true"
              />
            )}
            <p class="status">{sentence(copy.readout.status(readout.total))}</p>
          </div>
          {(readout.needsAccess > 0 ||
            readout.refused > 0 ||
            readout.outOfSync > 0 ||
            readout.unconfirmed > 0 ||
            readout.overridden > 0) && (
            <p class="substatus">
              {readout.outOfSync > 0 && (
                <span class="seg amber">
                  {copy.readout.outOfSync(readout.outOfSync)}
                </span>
              )}
              {readout.needsAccess > 0 && (
                <span class="seg amber">
                  {copy.readout.needsAccess(readout.needsAccess)}
                </span>
              )}
              {readout.refused > 0 && (
                <span class="seg stop">
                  {copy.readout.refused(readout.refused)}
                </span>
              )}
              {readout.unconfirmed > 0 && (
                <span class="seg rest">
                  {copy.readout.unconfirmed(readout.unconfirmed)}
                </span>
              )}
              {readout.overridden > 0 && (
                <span class="seg rest">
                  {copy.readout.overridden(readout.overridden)}
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </header>
  );
}

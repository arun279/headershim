import type { Profile } from "../../../core/model";
import { copy } from "../../copy";
import type { TabReadout } from "../../state/readout";
import { sentence } from "../sentence";
import { GlobeGlyph } from "./glyphs";
import { ProfilePicker } from "./ProfilePicker";

interface ReadoutHeadProps {
  readout: TabReadout;
  profiles: readonly Profile[];
  enabledProfiles: readonly Profile[];
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
  profiles,
  enabledProfiles,
  paused,
  onSwitchProfile,
  onNewProfile,
}: ReadoutHeadProps) {
  const attention = readout.needsAccess > 0 || readout.refused > 0;
  const showGlance = readout.host !== undefined && readout.total > 0 && !paused;

  return (
    <header class="head">
      <div class="head-top">
        <span class="site">
          <GlobeGlyph />
          <span class="host mono">{readout.host ?? copy.app.name}</span>
        </span>
        <ProfilePicker
          profiles={profiles}
          enabledProfiles={enabledProfiles}
          host={readout.host}
          onSwitch={onSwitchProfile}
          onNewProfile={onNewProfile}
        />
      </div>

      {showGlance && (
        <div class="glance-wrap">
          <div class="glance">
            <span
              class={`lamp ${attention ? "warn" : "live"}`}
              aria-hidden="true"
            />
            <p class="status">{sentence(copy.readout.status(readout.total))}</p>
          </div>
          {(readout.needsAccess > 0 ||
            readout.refused > 0 ||
            readout.overridden > 0) && (
            <p class="substatus">
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

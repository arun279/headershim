import type { Profile } from "../../src/core/model";
import { Button } from "../../src/ui/components/Button";
import {
  type ProfileCommitOutcome,
  ProfileSwitcher,
} from "../../src/ui/components/ProfileSwitcher";
import { ThemeControl } from "../../src/ui/components/ThemeControl";
import { copy } from "../../src/ui/copy";
import type { Theme } from "../../src/ui/theme";
import "./PopupHeader.css";

interface PopupHeaderProps {
  profiles: readonly Profile[];
  focusedProfileId: string;
  newProfileName: string;
  theme: Theme;
  autoFocusProfiles?: boolean;
  onActivateProfile: (profileId: string) => void;
  onCreateProfile: (
    name: string,
    duplicateCurrentRules: boolean,
  ) => Promise<ProfileCommitOutcome>;
  onRenameProfile: (
    profileId: string,
    name: string,
  ) => Promise<ProfileCommitOutcome>;
  onEnableProfile: (profileId: string) => Promise<ProfileCommitOutcome>;
  onManageProfiles: () => void;
  onThemeChange: (theme: Theme) => void;
  onOpenOptions: () => void;
}

export function PopupHeader(props: PopupHeaderProps) {
  return (
    <header class="popup-head">
      <div class="popup-profile-region">
        <ProfileSwitcher
          profiles={props.profiles}
          focusedProfileId={props.focusedProfileId}
          newProfileName={props.newProfileName}
          onActivate={props.onActivateProfile}
          onCreate={props.onCreateProfile}
          onRename={props.onRenameProfile}
          onEnable={props.onEnableProfile}
          onManageProfiles={props.onManageProfiles}
          {...(props.autoFocusProfiles === undefined
            ? {}
            : { autoFocus: props.autoFocusProfiles })}
        />
      </div>
      <div class="popup-head-actions">
        <ThemeControl theme={props.theme} onChange={props.onThemeChange} />
        <Button
          kind="ghost"
          label={copy.actions.options}
          onClick={props.onOpenOptions}
        >
          <GearGlyph />
        </Button>
      </div>
    </header>
  );
}

function GearGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.2v2M8 12.8v2M1.2 8h2M12.8 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4" />
    </svg>
  );
}

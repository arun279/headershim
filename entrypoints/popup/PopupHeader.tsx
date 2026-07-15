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
      fill="currentColor"
      class="gear-glyph"
      aria-hidden="true"
    >
      <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.858 2.929 2.929 0 0 1 0 5.858" />
    </svg>
  );
}

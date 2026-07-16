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
  onFocusProfile: (profileId: string) => void;
  onToggleProfile: (
    profileId: string,
    enabled: boolean,
  ) => Promise<ProfileCommitOutcome>;
  onCreateProfile: (
    name: string,
    duplicateCurrentRules: boolean,
  ) => Promise<ProfileCommitOutcome>;
  onRenameProfile: (
    profileId: string,
    name: string,
  ) => Promise<ProfileCommitOutcome>;
  onCloneProfile: (profileId: string) => Promise<ProfileCommitOutcome>;
  onManageProfiles: () => void;
  onThemeChange: (theme: Theme) => void;
  onOpenOptions: () => void;
  showProfiles?: boolean;
}

export function PopupHeader(props: PopupHeaderProps) {
  return (
    <header
      class={
        props.showProfiles === false
          ? "popup-head profiles-hidden"
          : "popup-head"
      }
    >
      {props.showProfiles !== false && (
        <div class="popup-profile-region">
          <ProfileSwitcher
            profiles={props.profiles}
            focusedProfileId={props.focusedProfileId}
            newProfileName={props.newProfileName}
            onFocusProfile={props.onFocusProfile}
            onToggleProfile={props.onToggleProfile}
            onCreate={props.onCreateProfile}
            onRename={props.onRenameProfile}
            onClone={props.onCloneProfile}
            onManageProfiles={props.onManageProfiles}
          />
        </div>
      )}
      <div class="popup-head-actions">
        <ThemeControl theme={props.theme} onChange={props.onThemeChange} />
        <Button
          kind="ghost"
          label={copy.actions.options}
          onClick={props.onOpenOptions}
        >
          <SlidersGlyph />
        </Button>
      </div>
    </header>
  );
}

function SlidersGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      class="sliders-glyph"
      aria-hidden="true"
    >
      <path
        d="M2 4h4m3 0h5M2 8h7m3 0h2M2 12h2m3 0h7"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <circle
        cx="7.5"
        cy="4"
        r="1.5"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <circle
        cx="10.5"
        cy="8"
        r="1.5"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <circle
        cx="5.5"
        cy="12"
        r="1.5"
        stroke="currentColor"
        stroke-width="1.5"
      />
    </svg>
  );
}

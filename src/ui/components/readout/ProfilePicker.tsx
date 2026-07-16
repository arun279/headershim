import { useRef, useState } from "preact/hooks";
import type { Profile } from "../../../core/model";
import { copy } from "../../copy";
import { previewSwitch } from "../../state/readout";
import { sentence } from "../sentence";
import { usePopoverDismiss } from "../usePopoverDismiss";
import { CheckGlyph, ChevronGlyph, PlusGlyph } from "./glyphs";
import { ProfileBadge } from "./ProfileBadge";

interface ProfilePickerProps {
  profiles: readonly Profile[];
  enabledProfiles: readonly Profile[];
  host: string | undefined;
  onSwitch: (profileId: string) => void;
  onNewProfile: () => void;
}

/**
 * The profile switch. Exclusive by default (one on, the rest off) and
 * consequence-first: before you commit, hovering or focusing a profile previews
 * exactly what it would change on this tab, so the switch is never a surprise.
 */
export function ProfilePicker({
  profiles,
  enabledProfiles,
  host,
  onSwitch,
  onNewProfile,
}: ProfilePickerProps) {
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, popover, trigger, (restoreFocus) => {
    setOpen(false);
    setPreviewId(undefined);
    if (restoreFocus) trigger.current?.focus();
  });

  const solo = enabledProfiles.length === 1 ? enabledProfiles[0] : undefined;
  const preview =
    previewId === undefined
      ? undefined
      : profiles.find((profile) => profile.id === previewId);

  return (
    <div class="picker">
      <button
        type="button"
        ref={trigger}
        class="prof"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={copy.readout.switcher.chipLabel}
        onClick={() => setOpen((value) => !value)}
      >
        {solo !== undefined ? (
          <>
            <ProfileBadge text={solo.badgeText} color={solo.color} size={16} />
            <span class="lbl">{solo.name}</span>
          </>
        ) : (
          <span class="lbl">
            {copy.readout.switcher.chipMulti(enabledProfiles.length)}
          </span>
        )}
        <ChevronGlyph />
      </button>

      {open && (
        <div class="pop" ref={popover} role="menu">
          <div class="pop-h silk">{copy.readout.switcher.title}</div>
          <div class="pop-list">
            {profiles.map((profile) => {
              const on = profile.enabled;
              return (
                <button
                  type="button"
                  key={profile.id}
                  role="menuitemradio"
                  aria-checked={on}
                  class={`popt${on ? " sel" : ""}`}
                  aria-label={copy.readout.switcher.select(profile.name)}
                  onMouseEnter={() => setPreviewId(on ? undefined : profile.id)}
                  onFocus={() => setPreviewId(on ? undefined : profile.id)}
                  onClick={() => {
                    onSwitch(profile.id);
                    setOpen(false);
                    setPreviewId(undefined);
                  }}
                >
                  <ProfileBadge
                    text={profile.badgeText}
                    color={profile.color}
                    size={19}
                  />
                  <span class="nm">{profile.name}</span>
                  {on && (
                    <span class="chk" aria-hidden="true">
                      <CheckGlyph />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {preview !== undefined && (
            <SwitchPreviewPanel
              from={enabledProfiles}
              to={preview}
              host={host}
            />
          )}
          <button type="button" class="popt new" onClick={onNewProfile}>
            <PlusGlyph />
            {copy.readout.switcher.newProfile}
          </button>
        </div>
      )}
    </div>
  );
}

function SwitchPreviewPanel({
  from,
  to,
  host,
}: {
  from: readonly Profile[];
  to: Profile;
  host: string | undefined;
}) {
  const { drops, adds } = previewSwitch(from, to, host);
  if (drops.length === 0 && adds.length === 0) {
    return null;
  }
  const firstDrop = drops[0];
  const firstAdd = adds[0];
  const addLabel =
    firstAdd === undefined
      ? ""
      : firstAdd.display === undefined
        ? firstAdd.header
        : `${firstAdd.header}: ${firstAdd.display}`;
  return (
    <div class="preview">
      <div class="pl silk">{copy.readout.switcher.previewLead(to.name)}</div>
      {firstDrop !== undefined && (
        <p class="d drops">
          <MinusGlyph />
          {sentence(copy.readout.switcher.drops(firstDrop, drops.length - 1))}
        </p>
      )}
      {firstAdd !== undefined && (
        <p class="d adds">
          <PlusGlyph />
          {sentence(copy.readout.switcher.adds(addLabel, adds.length - 1))}
        </p>
      )}
    </div>
  );
}

function MinusGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      aria-hidden="true"
    >
      <path d="M4 8h8" />
    </svg>
  );
}

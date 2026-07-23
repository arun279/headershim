import { useEffect, useRef, useState } from "preact/hooks";
import type { Profile } from "../../../core/model";
import { copy } from "../../copy";
import { previewSwitch } from "../../state/readout";
import { sentence } from "../sentence";
import { ProfileName } from "../Truncate";
import { usePopoverDismiss } from "../usePopoverDismiss";
import { CheckGlyph, ChevronGlyph, PlusGlyph } from "./glyphs";
import { ProfileBadge } from "./ProfileBadge";

interface ProfilePickerProps {
  profiles: readonly Profile[];
  activeProfile: Profile | undefined;
  host: string | undefined;
  onSwitch: (profileId: string) => void;
  onNewProfile: () => Promise<string | undefined>;
  onRenameProfile: (profileId: string, name: string) => void;
}

/**
 * The profile switch. Exclusive by default (one on, the rest off) and
 * consequence-first: before you commit, hovering or focusing a profile previews
 * exactly what it would change on this tab, so the switch is never a surprise.
 */
export function ProfilePicker({
  profiles,
  activeProfile,
  host,
  onSwitch,
  onNewProfile,
  onRenameProfile,
}: ProfilePickerProps) {
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const profileButtons = useRef(new Map<string, HTMLButtonElement>());
  const nameInput = useRef<HTMLInputElement>(null);

  const setPickerOpen = (next: boolean) => {
    openRef.current = next;
    setOpen(next);
    if (!next) {
      setEditingId(undefined);
      setPreviewId(undefined);
    }
  };

  const focusCurrentProfile = () => {
    const id = activeProfile?.id ?? profiles[0]?.id;
    if (id !== undefined) profileButtons.current.get(id)?.focus();
  };

  const stopEditing = (restoreFocus: boolean) => {
    setEditingId(undefined);
    if (restoreFocus) {
      queueMicrotask(focusCurrentProfile);
    }
  };

  const commitName = (restoreFocus: boolean) => {
    const id = editingId;
    const value = nameInput.current?.value.trim() ?? "";
    stopEditing(restoreFocus);
    if (
      id !== undefined &&
      value.length > 0 &&
      value !== profiles.find((profile) => profile.id === id)?.name
    ) {
      onRenameProfile(id, value);
    }
  };

  usePopoverDismiss(open, popover, trigger, (restoreFocus) => {
    if (editingId !== undefined && restoreFocus) {
      stopEditing(true);
      return;
    }
    if (editingId !== undefined) commitName(false);
    setPickerOpen(false);
    if (restoreFocus) trigger.current?.focus();
  });

  useEffect(() => {
    if (open) focusCurrentProfile();
  }, [open]);

  useEffect(() => {
    if (open && editingId !== undefined) {
      nameInput.current?.focus();
      nameInput.current?.select();
    }
  }, [editingId, open, profiles]);

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
        aria-expanded={open}
        aria-controls="profile-switch-pop"
        aria-label={copy.readout.switcher.chipLabel}
        onClick={() => setPickerOpen(!openRef.current)}
      >
        {activeProfile !== undefined ? (
          <>
            <ProfileBadge
              text={activeProfile.badgeText}
              color={activeProfile.color}
              size={16}
            />
            <ProfileName value={activeProfile.name} class="lbl" />
          </>
        ) : (
          <span class="lbl">{copy.profiles.offTag}</span>
        )}
        <ChevronGlyph />
      </button>

      {open && (
        // biome-ignore lint/a11y/useSemanticElements: this is a disclosure popover, not a form fieldset.
        <div
          id="profile-switch-pop"
          class="pop"
          ref={popover}
          role="group"
          aria-labelledby="profile-switch-pop-h"
        >
          <div id="profile-switch-pop-h" class="pop-h silk">
            {copy.readout.switcher.title}
          </div>
          <div class="pop-list">
            {profiles.map((profile) => {
              const on = profile.id === activeProfile?.id;
              if (profile.id === editingId) {
                return (
                  <div
                    key={profile.id}
                    class={`popt${on ? " sel" : ""}`}
                    aria-current={on ? "true" : undefined}
                  >
                    <ProfileBadge
                      text={profile.badgeText}
                      color={profile.color}
                      size={19}
                    />
                    <input
                      class="profile-name-input inset-field"
                      type="text"
                      maxLength={48}
                      aria-label={copy.options.profiles.nameLabel}
                      defaultValue={profile.name}
                      ref={nameInput}
                      onBlur={() => commitName(false)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitName(true);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          stopEditing(true);
                        }
                      }}
                    />
                    {on && (
                      <span class="chk" aria-hidden="true">
                        <CheckGlyph />
                      </span>
                    )}
                  </div>
                );
              }
              return (
                <button
                  type="button"
                  key={profile.id}
                  ref={(node) => {
                    if (node === null) {
                      profileButtons.current.delete(profile.id);
                    } else {
                      profileButtons.current.set(profile.id, node);
                    }
                  }}
                  aria-current={on ? "true" : undefined}
                  class={`popt${on ? " sel" : ""}`}
                  onMouseEnter={() => setPreviewId(on ? undefined : profile.id)}
                  onFocus={() => setPreviewId(on ? undefined : profile.id)}
                  onClick={() => {
                    onSwitch(profile.id);
                    setPickerOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  <ProfileBadge
                    text={profile.badgeText}
                    color={profile.color}
                    size={19}
                  />
                  <ProfileName value={profile.name} class="nm" />
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
            <SwitchPreviewPanel from={activeProfile} to={preview} host={host} />
          )}
          <button
            type="button"
            class="popt new"
            onClick={async () => {
              const id = await onNewProfile();
              if (id !== undefined && openRef.current) setEditingId(id);
            }}
          >
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
  from: Profile | undefined;
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

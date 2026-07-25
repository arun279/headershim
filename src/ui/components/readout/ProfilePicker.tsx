import { useEffect, useRef, useState } from "preact/hooks";
import type { Profile } from "../../../core/model";
import { copy, type Sentence, sentenceText } from "../../copy";
import { previewSwitch, type SwitchPreview } from "../../state/readout";
import { InlineRename } from "../InlineRename";
import { sentence } from "../sentence";
import { ProfileName } from "../Truncate";
import { usePopoverDismiss } from "../usePopoverDismiss";
import { CheckGlyph, ChevronGlyph, PlusGlyph } from "./glyphs";
import { ProfileBadge } from "./ProfileBadge";

interface ProfilePickerProps {
  profiles: readonly Profile[];
  activeProfile: Profile;
  /** The profile the shortcut would flip to, when one has been established. */
  previousProfileId: string | undefined;
  /** The resolved profile-shortcut accelerator, absent when it is unbound. */
  switchShortcut: string | undefined;
  host: string | undefined;
  onSwitch: (profileId: string) => void;
  onNewProfile: () => Promise<string | undefined>;
  onRenameProfile: (profileId: string, name: string) => void;
}

/**
 * The profile switch. Exclusive by default (one on, the rest off) and
 * consequence-first: the closed chip's description names what the profile
 * shortcut would change on this tab, its target row carries the accelerator so
 * the key is discoverable, and inside the menu hovering or focusing any profile
 * previews its own switch, so the answer is never locked behind the act of
 * switching.
 */
export function ProfilePicker({
  profiles,
  activeProfile,
  previousProfileId,
  switchShortcut,
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

  const setPickerOpen = (next: boolean) => {
    openRef.current = next;
    setOpen(next);
    if (!next) {
      setEditingId(undefined);
      setPreviewId(undefined);
    }
  };

  const focusCurrentProfile = () => {
    profileButtons.current.get(activeProfile.id)?.focus();
  };

  const closeEditing = (restoreFocus: boolean) => {
    setEditingId(undefined);
    if (restoreFocus) {
      queueMicrotask(focusCurrentProfile);
    }
  };

  usePopoverDismiss(open, popover, trigger, (restoreFocus) => {
    // Escape while renaming cancels the rename and leaves the menu open; every
    // other dismiss closes the menu, which also ends any rename in progress.
    if (editingId !== undefined && restoreFocus) {
      closeEditing(true);
      return;
    }
    setPickerOpen(false);
    if (restoreFocus) trigger.current?.focus();
  });

  useEffect(() => {
    if (open) focusCurrentProfile();
  }, [open]);

  const preview =
    previewId === undefined
      ? undefined
      : profiles.find((profile) => profile.id === previewId);

  // The chip describes the switch its own shortcut would make: the flip back to
  // the profile you were last on, the one the profile shortcut activates.
  const flipTarget = profiles.find(
    (profile) => profile.id === previousProfileId,
  );
  const switchHint =
    flipTarget === undefined
      ? undefined
      : switchHintText(activeProfile, flipTarget, host);

  return (
    <div class="picker">
      <button
        type="button"
        ref={trigger}
        class="prof"
        aria-expanded={open}
        aria-controls="profile-switch-pop"
        aria-label={copy.readout.switcher.chipLabel}
        title={switchHint}
        onClick={() => setPickerOpen(!openRef.current)}
      >
        <ProfileBadge
          text={activeProfile.badgeText}
          color={activeProfile.color}
          size={16}
        />
        <ProfileName value={activeProfile.name} class="lbl" />
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
              const on = profile.id === activeProfile.id;
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
                    <InlineRename
                      value={profile.name}
                      onCommit={(name) => onRenameProfile(profile.id, name)}
                      onClose={closeEditing}
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
                  onMouseEnter={() => setPreviewId(profile.id)}
                  onFocus={() => setPreviewId(profile.id)}
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
                  {profile.id === previousProfileId &&
                    switchShortcut !== undefined && (
                      <span class="kbd mono">{switchShortcut}</span>
                    )}
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

interface SwitchDiff {
  empty: boolean;
  lead: string;
  drop: Sentence | undefined;
  add: Sentence | undefined;
}

/** The lead, first drop and first add of a switch, in the copy the panel reads. */
function switchDiff(to: Profile, preview: SwitchPreview): SwitchDiff {
  const { drops, adds } = preview;
  const firstDrop = drops[0];
  const firstAdd = adds[0];
  const addLabel =
    firstAdd === undefined
      ? undefined
      : firstAdd.display === undefined
        ? firstAdd.header
        : `${firstAdd.header}: ${firstAdd.display}`;
  return {
    empty: drops.length === 0 && adds.length === 0,
    lead: copy.readout.switcher.previewLead(to.name),
    drop:
      firstDrop === undefined
        ? undefined
        : copy.readout.switcher.drops(firstDrop, drops.length - 1),
    add:
      addLabel === undefined
        ? undefined
        : copy.readout.switcher.adds(addLabel, adds.length - 1),
  };
}

/** The switch consequence as one plain line, for the closed chip's description. */
function switchHintText(
  from: Profile,
  to: Profile,
  host: string | undefined,
): string | undefined {
  const diff = switchDiff(to, previewSwitch(from, to, host));
  if (diff.empty) return undefined;
  const parts = [diff.lead];
  if (diff.drop !== undefined) parts.push(sentenceText(diff.drop));
  if (diff.add !== undefined) parts.push(sentenceText(diff.add));
  return parts.join(", ");
}

function SwitchPreviewPanel({
  from,
  to,
  host,
}: {
  from: Profile;
  to: Profile;
  host: string | undefined;
}) {
  const diff = switchDiff(to, previewSwitch(from, to, host));
  if (diff.empty) {
    return null;
  }
  return (
    <div class="preview">
      <div class="pl silk">{diff.lead}</div>
      {diff.drop !== undefined && (
        <p class="d drops">
          <MinusGlyph />
          {sentence(diff.drop)}
        </p>
      )}
      {diff.add !== undefined && (
        <p class="d adds">
          <PlusGlyph />
          {sentence(diff.add)}
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

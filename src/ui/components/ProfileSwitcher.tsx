import type { JSX, RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Profile } from "../../core/model";
import { copy } from "../copy";
import {
  closePopover,
  openPositionedPopover,
  trapPopoverFocus,
} from "./popover";
import { Truncate } from "./Truncate";
import { usePopoverDismiss } from "./usePopoverDismiss";
import "./ProfileSwitcher.css";

export type ProfileCommitOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

interface ProfileSwitcherProps {
  profiles: readonly Profile[];
  focusedProfileId: string;
  newProfileName: string;
  /** Exclusive switch: this profile on, all others off. */
  onActivate: (profileId: string) => void;
  onCreate: (
    name: string,
    duplicateCurrentRules: boolean,
  ) => Promise<ProfileCommitOutcome>;
  onRename: (profileId: string, name: string) => Promise<ProfileCommitOutcome>;
  onEnable: (profileId: string) => Promise<ProfileCommitOutcome>;
  onManageProfiles: () => void;
  /** Focus the focused chip on mount (popup-open focus target). */
  autoFocus?: boolean;
}

export function ProfileSwitcher({
  profiles,
  focusedProfileId,
  newProfileName,
  onActivate,
  onCreate,
  onRename,
  onEnable,
  onManageProfiles,
  autoFocus,
}: ProfileSwitcherProps) {
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const menuButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const newButton = useRef<HTMLButtonElement>(null);
  const focusedIndex = Math.max(
    0,
    profiles.findIndex((profile) => profile.id === focusedProfileId),
  );
  const [roving, setRoving] = useState(focusedIndex);
  const [creating, setCreating] = useState(false);
  const [menuProfileId, setMenuProfileId] = useState<string | undefined>();
  const rovingIndex = Math.min(roving, profiles.length - 1);

  useEffect(() => {
    setRoving(focusedIndex);
  }, [focusedIndex]);

  // Popup-open focus placement only; later document changes update the tab
  // stop without moving the user's focus.
  useEffect(() => {
    if (autoFocus) {
      chips.current[focusedIndex]?.focus();
    }
  }, []);

  const moveTo = (index: number) => {
    const target = Math.max(0, Math.min(index, profiles.length - 1));
    setRoving(target);
    chips.current[target]?.focus();
  };

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    switch (event.key) {
      case "ArrowRight":
        moveTo(rovingIndex + 1);
        break;
      case "ArrowLeft":
        moveTo(rovingIndex - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(profiles.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const menuProfile = profiles.find((profile) => profile.id === menuProfileId);
  const menuIndex =
    menuProfile === undefined ? -1 : profiles.indexOf(menuProfile);

  return (
    <nav
      class="profiles"
      aria-label={copy.profiles.navLabel}
      onKeyDown={onKeyDown}
    >
      {profiles.map((profile, index) => (
        <div
          class={[
            "profile-chip",
            profile.enabled ? "" : "off",
            profile.id === focusedProfileId ? "current" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          key={profile.id}
        >
          <button
            type="button"
            class="chip"
            aria-current={profile.id === focusedProfileId ? "true" : undefined}
            tabIndex={index === rovingIndex ? 0 : -1}
            ref={(chip) => {
              chips.current[index] = chip;
            }}
            onClick={() => onActivate(profile.id)}
            onFocus={() => setRoving(index)}
          >
            <span
              class="chip-badge badge-glyph"
              aria-hidden="true"
              style={
                profile.enabled
                  ? { background: `var(--badge-${profile.color})` }
                  : undefined
              }
            >
              {profile.badgeText}
            </span>
            <Truncate value={profile.name} class="chip-name" />
            {!profile.enabled && (
              <span class="silk" aria-hidden="true">
                {copy.profiles.offTag}
              </span>
            )}
            <span class="sr-only">
              {copy.profiles.chipState(
                profile.id === focusedProfileId,
                profile.enabled,
              )}
            </span>
          </button>
          <button
            type="button"
            class="profile-menu-trigger"
            aria-label={copy.profiles.actions(profile.name)}
            aria-haspopup="dialog"
            aria-expanded={menuProfileId === profile.id}
            title={copy.profiles.actions(profile.name)}
            ref={(button) => {
              menuButtons.current[index] = button;
            }}
            onClick={() => {
              setCreating(false);
              setMenuProfileId((current) =>
                current === profile.id ? undefined : profile.id,
              );
            }}
          >
            <span aria-hidden="true">⋯</span>
          </button>
        </div>
      ))}
      <button
        type="button"
        class="new-profile-chip"
        aria-label={copy.options.profiles.newName}
        aria-haspopup="dialog"
        aria-expanded={creating}
        title={copy.options.profiles.newName}
        ref={newButton}
        onClick={() => {
          setMenuProfileId(undefined);
          setCreating((current) => !current);
        }}
      >
        <span aria-hidden="true">＋</span>
      </button>
      {creating && (
        <CreateProfilePopover
          trigger={newButton}
          initialName={newProfileName}
          onCreate={onCreate}
          onManageProfiles={onManageProfiles}
          onClose={(restoreFocus = true) => {
            setCreating(false);
            if (restoreFocus) {
              queueMicrotask(() => newButton.current?.focus());
            }
          }}
        />
      )}
      {menuProfile !== undefined && menuIndex >= 0 && (
        <ProfileMenu
          profile={menuProfile}
          trigger={{ current: menuButtons.current[menuIndex] ?? null }}
          onRename={onRename}
          onEnable={onEnable}
          onManageProfiles={onManageProfiles}
          onClose={(restoreFocus = true) => {
            setMenuProfileId(undefined);
            if (restoreFocus) {
              queueMicrotask(() => menuButtons.current[menuIndex]?.focus());
            }
          }}
        />
      )}
    </nav>
  );
}

interface PopoverProps {
  trigger: { readonly current: HTMLButtonElement | null };
  onManageProfiles: () => void;
  onClose: (restoreFocus?: boolean) => void;
}

function useProfilePopover(
  popover: RefObject<HTMLDivElement | null>,
  trigger: PopoverProps["trigger"],
  align: "start" | "end",
  initialInput: RefObject<HTMLInputElement | null> | undefined,
  onClose: PopoverProps["onClose"],
) {
  useLayoutEffect(() => {
    if (popover.current === null || trigger.current === null) return;
    openPositionedPopover(popover.current, trigger.current, align);
    if (initialInput?.current === undefined || initialInput.current === null) {
      popover.current.querySelector<HTMLButtonElement>("button")?.focus();
    } else {
      initialInput.current.focus();
      initialInput.current.select();
    }
    return () => closePopover(popover.current);
  }, []);

  usePopoverDismiss(true, popover, trigger, onClose);
}

function handlePopoverKeyDown(
  event: JSX.TargetedKeyboardEvent<HTMLDivElement>,
  popover: HTMLDivElement | null,
  onClose: () => void,
) {
  event.stopPropagation();
  if (event.key === "Tab" && popover !== null) {
    trapPopoverFocus(event, popover);
  } else if (event.key === "Escape") {
    event.preventDefault();
    onClose();
  }
}

function CreateProfilePopover({
  trigger,
  initialName,
  onCreate,
  onManageProfiles,
  onClose,
}: PopoverProps & {
  initialName: string;
  onCreate: ProfileSwitcherProps["onCreate"];
}) {
  const popover = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [duplicate, setDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useProfilePopover(popover, trigger, "start", input, onClose);

  const submit = async (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    const outcome = await onCreate(name, duplicate);
    setSaving(false);
    if (outcome.ok) {
      onClose();
    } else {
      setError(outcome.error);
      input.current?.focus();
    }
  };

  return (
    <div
      class="menu-pop profile-pop profile-create-pop"
      popover="manual"
      role="dialog"
      aria-labelledby="new-profile-title"
      ref={popover}
      onKeyDown={(event) =>
        handlePopoverKeyDown(event, popover.current, onClose)
      }
    >
      <h2 class="profile-pop-title" id="new-profile-title">
        {copy.options.profiles.newName}
      </h2>
      <form class="profile-pop-form" onSubmit={submit}>
        <label class="profile-pop-label" for="new-profile-name">
          {copy.options.profiles.nameLabel}
        </label>
        <input
          id="new-profile-name"
          class="inset-field profile-name-field"
          type="text"
          maxLength={48}
          required
          value={name}
          aria-invalid={error !== undefined ? true : undefined}
          aria-describedby={
            error === undefined ? undefined : "profile-create-error"
          }
          ref={input}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <label class="profile-duplicate">
          <input
            type="checkbox"
            checked={duplicate}
            onChange={(event) => setDuplicate(event.currentTarget.checked)}
          />
          <span>{copy.profiles.duplicateRules}</span>
        </label>
        {error !== undefined && (
          <p class="profile-pop-error" role="alert" id="profile-create-error">
            {error}
          </p>
        )}
        <button type="submit" class="btn primary" disabled={saving}>
          {copy.profiles.create}
        </button>
      </form>
      <button
        type="button"
        class="menu-item profile-manage"
        onClick={() => {
          onClose();
          onManageProfiles();
        }}
      >
        {copy.profiles.manage}
      </button>
    </div>
  );
}

function ProfileMenu({
  profile,
  trigger,
  onRename,
  onEnable,
  onManageProfiles,
  onClose,
}: PopoverProps & {
  profile: Profile;
  onRename: ProfileSwitcherProps["onRename"];
  onEnable: ProfileSwitcherProps["onEnable"];
}) {
  const popover = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(profile.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useProfilePopover(popover, trigger, "end", undefined, onClose);

  useLayoutEffect(() => {
    if (renaming) {
      input.current?.focus();
      input.current?.select();
    }
  }, [renaming]);

  const commitRename = async (
    event: JSX.TargetedSubmitEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    const outcome = await onRename(profile.id, name);
    setSaving(false);
    if (outcome.ok) {
      onClose();
    } else {
      setError(outcome.error);
      input.current?.focus();
    }
  };

  const enable = async () => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    const outcome = await onEnable(profile.id);
    setSaving(false);
    if (outcome.ok) {
      onClose();
    } else {
      setError(outcome.error);
    }
  };

  return (
    <div
      class="menu-pop profile-pop profile-actions-pop"
      popover="manual"
      role="dialog"
      aria-label={copy.profiles.actions(profile.name)}
      ref={popover}
      onKeyDown={(event) =>
        handlePopoverKeyDown(event, popover.current, onClose)
      }
    >
      {renaming ? (
        <form class="profile-pop-form" onSubmit={commitRename}>
          <label class="profile-pop-label" for={`rename-${profile.id}`}>
            {copy.options.profiles.nameLabel}
          </label>
          <input
            id={`rename-${profile.id}`}
            class="inset-field profile-name-field"
            type="text"
            maxLength={48}
            required
            value={name}
            aria-invalid={error !== undefined ? true : undefined}
            aria-describedby={
              error === undefined ? undefined : `rename-error-${profile.id}`
            }
            ref={input}
            onInput={(event) => setName(event.currentTarget.value)}
          />
          {error !== undefined && (
            <p
              class="profile-pop-error"
              role="alert"
              id={`rename-error-${profile.id}`}
            >
              {error}
            </p>
          )}
          <button type="submit" class="btn primary" disabled={saving}>
            {copy.options.profiles.rename}
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            class="menu-item"
            onClick={() => setRenaming(true)}
          >
            {copy.options.profiles.rename}
          </button>
          {!profile.enabled && (
            <button
              type="button"
              class="menu-item"
              disabled={saving}
              onClick={() => void enable()}
            >
              {copy.profiles.enableWithoutSwitching}
            </button>
          )}
          {error !== undefined && (
            <p class="profile-pop-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      <button
        type="button"
        class="menu-item profile-manage"
        onClick={() => {
          onClose();
          onManageProfiles();
        }}
      >
        {copy.profiles.manage}
      </button>
    </div>
  );
}

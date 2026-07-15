import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { BadgeColor, Profile } from "../../core/model";
import { useAnnounce } from "../a11y/LiveRegion";
import { copy } from "../copy";
import { BadgeEditor } from "./BadgeEditor";
import { Button } from "./Button";
import { Toggle } from "./Toggle";
import { Truncate } from "./Truncate";
import "./ProfileList.css";

interface ProfileListProps {
  profiles: readonly Profile[];
  /** The expanded card, whose badge and rules are open for editing. */
  openProfileId: string | undefined;
  onOpen: (profileId: string) => void;
  onToggle: (profileId: string, enabled: boolean) => void;
  onReorder: (profileId: string, toIndex: number) => void;
  onRename: (profileId: string, name: string) => void;
  onClone: (profileId: string) => void;
  onDelete: (profileId: string) => void;
  onBadgeChange: (
    profileId: string,
    badgeText: string,
    color: BadgeColor,
  ) => void;
}

/**
 * The profile management list: one card per profile, reorderable by drag or by
 * focusing a card's handle and pressing the arrow keys (each keyboard move is
 * announced with the new position). The open card expands to the badge editor
 * and rename/clone/delete actions.
 */
export function ProfileList(props: ProfileListProps) {
  const { profiles } = props;
  const announce = useAnnounce();
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const draggingId = useRef<string | undefined>(undefined);
  const [pendingFocus, setPendingFocus] = useState<string | undefined>(
    undefined,
  );

  const order = profiles.map((profile) => profile.id).join();
  // A keyboard move re-renders from the new document; focus follows the card to
  // its new slot so an arrow-key run stays on the same profile.
  useEffect(() => {
    if (pendingFocus === undefined) {
      return;
    }
    handles.current.get(pendingFocus)?.focus();
    setPendingFocus(undefined);
  }, [order, pendingFocus]);

  const moveBy = (profile: Profile, delta: number) => {
    const from = profiles.indexOf(profile);
    const to = from + delta;
    if (to < 0 || to >= profiles.length) {
      return;
    }
    props.onReorder(profile.id, to);
    setPendingFocus(profile.id);
    announce(copy.options.profiles.reordered(profile.name, to + 1));
  };

  const onDragEnter = (target: Profile) => {
    const id = draggingId.current;
    if (id === undefined || id === target.id) {
      return;
    }
    props.onReorder(id, profiles.indexOf(target));
  };

  return (
    <ul class="profile-list">
      {profiles.map((profile) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          open={profile.id === props.openProfileId}
          setsize={profiles.length}
          posinset={profiles.indexOf(profile) + 1}
          handleRef={(node) => {
            if (node === null) {
              handles.current.delete(profile.id);
            } else {
              handles.current.set(profile.id, node);
            }
          }}
          onOpen={() => props.onOpen(profile.id)}
          onToggle={(enabled) => props.onToggle(profile.id, enabled)}
          onRename={(name) => props.onRename(profile.id, name)}
          onClone={() => props.onClone(profile.id)}
          onDelete={() => props.onDelete(profile.id)}
          onBadgeChange={(badgeText, color) =>
            props.onBadgeChange(profile.id, badgeText, color)
          }
          onMoveKey={(delta) => moveBy(profile, delta)}
          onDragStart={() => {
            draggingId.current = profile.id;
          }}
          onDragEnter={() => onDragEnter(profile)}
          onDragEnd={() => {
            draggingId.current = undefined;
          }}
        />
      ))}
    </ul>
  );
}

interface ProfileCardProps {
  profile: Profile;
  open: boolean;
  setsize: number;
  posinset: number;
  handleRef: (node: HTMLButtonElement | null) => void;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  onRename: (name: string) => void;
  onClone: () => void;
  onDelete: () => void;
  onBadgeChange: (badgeText: string, color: BadgeColor) => void;
  onMoveKey: (delta: number) => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
}

function ProfileCard(props: ProfileCardProps) {
  const { profile } = props;
  const [renaming, setRenaming] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);

  const startRename = () => {
    setRenaming(true);
    // Focus lands after the input mounts.
    queueMicrotask(() => nameInput.current?.select());
  };

  const commitName = () => {
    const value = nameInput.current?.value.trim() ?? "";
    setRenaming(false);
    if (value.length > 0 && value !== profile.name) {
      props.onRename(value);
    }
  };

  const onHandleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    switch (event.key) {
      case "ArrowUp":
        props.onMoveKey(-1);
        break;
      case "ArrowDown":
        props.onMoveKey(1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <li
      class={props.open ? "profile-card open" : "profile-card"}
      data-profile-id={profile.id}
      aria-setsize={props.setsize}
      aria-posinset={props.posinset}
      onDragEnter={props.onDragEnter}
      onDragOver={(event) => event.preventDefault()}
    >
      <div class="profile-head">
        <button
          type="button"
          class="drag-handle"
          aria-label={copy.options.profiles.reorderHandle(profile.name)}
          draggable
          ref={props.handleRef}
          onKeyDown={onHandleKeyDown}
          onDragStart={props.onDragStart}
          onDragEnd={props.onDragEnd}
        >
          <DragGlyph />
        </button>
        {renaming ? (
          <input
            class="profile-name-input inset-field"
            type="text"
            maxLength={48}
            aria-label={copy.options.profiles.nameLabel}
            defaultValue={profile.name}
            ref={nameInput}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitName();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            class="profile-open"
            aria-expanded={props.open}
            onClick={props.onOpen}
          >
            <span
              class={
                profile.enabled
                  ? "profile-badge badge-glyph"
                  : "profile-badge badge-glyph off"
              }
              aria-hidden="true"
              style={
                profile.enabled
                  ? { background: `var(--badge-${profile.color})` }
                  : undefined
              }
            >
              {profile.badgeText}
            </span>
            <Truncate value={profile.name} class="profile-name" />
          </button>
        )}
        <span class="profile-rulecount">
          {copy.options.profiles.ruleCount(profile.rules.length)}
        </span>
        <Toggle
          checked={profile.enabled}
          label={copy.options.profiles.toggleLabel(
            profile.name,
            profile.enabled,
          )}
          onChange={props.onToggle}
        />
      </div>
      {props.open && !renaming && (
        <div class="profile-detail">
          <BadgeEditor
            badgeText={profile.badgeText}
            color={profile.color}
            onChange={props.onBadgeChange}
          />
          <div class="profile-actions">
            <Button kind="quiet" onClick={startRename}>
              {copy.options.profiles.rename}
            </Button>
            <Button kind="quiet" onClick={props.onClone}>
              {copy.options.profiles.clone}
            </Button>
            <Button kind="quiet" onClick={props.onDelete}>
              {copy.options.profiles.delete}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function DragGlyph() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
      <g fill="currentColor">
        <circle cx="3" cy="3" r="1.2" />
        <circle cx="7" cy="3" r="1.2" />
        <circle cx="3" cy="8" r="1.2" />
        <circle cx="7" cy="8" r="1.2" />
        <circle cx="3" cy="13" r="1.2" />
        <circle cx="7" cy="13" r="1.2" />
      </g>
    </svg>
  );
}

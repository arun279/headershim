import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Profile } from "../../core/model";
import { copy } from "../copy";
import "./ProfileSwitcher.css";

interface ProfileSwitcherProps {
  profiles: readonly Profile[];
  focusedProfileId: string;
  /** Exclusive switch: this profile on, all others off (click / Enter). */
  onActivate: (profileId: string) => void;
  /** Toggle only this profile (Shift+click / Shift+Enter). */
  onToggle: (profileId: string) => void;
  /** Focus the focused chip on mount (popup-open focus target, SPEC §9). */
  autoFocus?: boolean;
}

export function ProfileSwitcher({
  profiles,
  focusedProfileId,
  onActivate,
  onToggle,
  autoFocus,
}: ProfileSwitcherProps) {
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const focusedIndex = Math.max(
    0,
    profiles.findIndex((profile) => profile.id === focusedProfileId),
  );
  // Roving tabindex: one chip in the tab order, arrows move within the row.
  const [roving, setRoving] = useState(focusedIndex);
  const rovingIndex = Math.min(roving, profiles.length - 1);

  // Popup-open focus placement only; later doc changes must not steal focus.
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

  return (
    <nav
      class="profiles"
      aria-label={copy.profiles.navLabel}
      onKeyDown={onKeyDown}
    >
      {profiles.map((profile, index) => (
        <button
          key={profile.id}
          type="button"
          class={profile.enabled ? "chip" : "chip off"}
          aria-current={profile.id === focusedProfileId ? "true" : undefined}
          tabIndex={index === rovingIndex ? 0 : -1}
          ref={(chip) => {
            chips.current[index] = chip;
          }}
          onClick={(event) =>
            (event.shiftKey ? onToggle : onActivate)(profile.id)
          }
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
          {profile.name}
          {!profile.enabled && (
            <span class="offtag" aria-hidden="true">
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
      ))}
    </nav>
  );
}

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { COMMON_HEADER_NAMES } from "../../core/header-names";
import { classifyHeaderName, normalizeHeaderName } from "../../core/headers";
import type { HeaderOp } from "../../core/model";
import { useAnnounce } from "../a11y/LiveRegion";
import { copy } from "../copy";
import { sentence } from "./sentence";
import "./HeaderNameInput.css";

interface HeaderNameInputProps {
  /** Raw text as typed; the editor echoes it and the store lowercases it. */
  value: string;
  /** Append makes a hop-by-hop advisory prominent the moment it's selected. */
  operation: HeaderOp;
  /** Blocking commit error, rendered inline under the field. */
  error?: string | undefined;
  autoFocus?: boolean;
  onInput: (raw: string) => void;
}

/**
 * Combobox over the bundled common-header list (never fetched). Typing
 * filters; ↓/↑ move the active option; Enter accepts it (a closed list lets
 * Enter bubble to commit the rule); Esc closes the list first and only then
 * reaches the editor. Match counts are announced politely. Under the field:
 * the case-honesty microline and the discouraged-header advisories, which
 * appear the moment the typed name matches and persist.
 */
export function HeaderNameInput(props: HeaderNameInputProps) {
  const id = useId();
  const announce = useAnnounce();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // No option is active until the user arrows into the list: Enter must
  // commit a custom name as typed, never hijack it into a suggestion.
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  const normalized = normalizeHeaderName(props.value);
  const matches = matchesFor(normalized);
  const active =
    activeIndex === undefined
      ? undefined
      : Math.min(activeIndex, matches.length - 1);
  const classification = classifyHeaderName(props.value);

  // Mount-time gesture: focus moves into the editor when it opens, never again.
  // Synchronous with the commit that mounts the editor, not a post-paint effect:
  // the just-vacated row would otherwise drop focus to <body> for a frame, and a
  // key pressed in that gap (Esc on a slow machine) reaches neither the editor
  // nor the popup-root handler — both sit under <main>, below where body events
  // bubble — so it is silently dropped. Landing focus inside the editor in the
  // same commit that makes it visible closes that gap.
  useLayoutEffect(() => {
    if (props.autoFocus === true) {
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (open) {
      announce(copy.editor.suggestions(matches.length));
    }
  }, [open, matches.length, announce]);

  const select = (name: string) => {
    props.onInput(name);
    setOpen(false);
  };

  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const caseId = `${id}-case`;
  const showCase =
    props.value.trim() !== "" && props.value.trim() !== normalized;
  const describedBy = [
    ...(showCase ? [caseId] : []),
    ...classification.advisories.map((advisory) => `${id}-${advisory.kind}`),
    ...(props.error === undefined ? [] : [errorId]),
  ].join(" ");

  return (
    <div class="editor-field">
      <label class="editor-label" for={`${id}-input`}>
        {copy.editor.labels.headerName}
      </label>
      <div class="editor-control combobox">
        <input
          id={`${id}-input`}
          ref={inputRef}
          class="field mono"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && active !== undefined ? `${id}-opt-${active}` : undefined
          }
          aria-invalid={props.error !== undefined ? true : undefined}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          value={props.value}
          onInput={(event) => {
            const raw = event.currentTarget.value;
            props.onInput(raw);
            setActiveIndex(undefined);
            setOpen(
              raw.trim() !== "" &&
                matchesFor(normalizeHeaderName(raw)).length > 0,
            );
          }}
          onKeyDown={(event) => {
            switch (event.key) {
              case "ArrowDown":
              case "ArrowUp": {
                event.preventDefault();
                if (matches.length === 0) {
                  return;
                }
                const down = event.key === "ArrowDown";
                if (!open) {
                  setOpen(true);
                  setActiveIndex(down ? 0 : matches.length - 1);
                  return;
                }
                setActiveIndex(
                  active === undefined
                    ? down
                      ? 0
                      : matches.length - 1
                    : (active + (down ? 1 : -1) + matches.length) %
                        matches.length,
                );
                return;
              }
              case "Enter": {
                const name = active === undefined ? undefined : matches[active];
                if (open && name !== undefined) {
                  event.preventDefault();
                  select(name);
                }
                return;
              }
              case "Escape":
                if (open) {
                  event.preventDefault();
                  setOpen(false);
                }
                return;
            }
          }}
          onBlur={() => setOpen(false)}
        />
        {open && (
          <div class="combo-list" role="listbox" id={listId}>
            {matches.map((name, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: aria-activedescendant pattern — the combobox input owns the keyboard (↓/↑/Enter); click is the pointer path.
              <div
                key={name}
                id={`${id}-opt-${index}`}
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                class={
                  index === active ? "combo-option active" : "combo-option"
                }
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(name)}
              >
                <span class="mono">{name}</span>
                {copy.headerHints[name] !== undefined && (
                  <span class="combo-hint">— {copy.headerHints[name]}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {showCase && (
          <p class="editor-micro" id={caseId}>
            {sentence(copy.editor.savedAs(normalized))}
          </p>
        )}
        {classification.advisories.map((advisory) => (
          <p
            key={advisory.kind}
            id={`${id}-${advisory.kind}`}
            class={
              props.operation === "append" &&
              advisory.kind === "network-managed"
                ? "editor-advisory prominent"
                : "editor-advisory"
            }
          >
            {advisory.kind === "network-managed"
              ? copy.advisories.managedHeader
              : copy.advisories.host}
          </p>
        ))}
        {props.error !== undefined && (
          <p class="editor-error" role="alert" id={errorId}>
            {props.error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Prefix matches lead, substring matches follow; empty input offers the whole list. */
function matchesFor(query: string): string[] {
  if (query === "") {
    return [...COMMON_HEADER_NAMES];
  }
  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of COMMON_HEADER_NAMES) {
    if (name.startsWith(query)) {
      starts.push(name);
    } else if (name.includes(query)) {
      contains.push(name);
    }
  }
  return [...starts, ...contains];
}

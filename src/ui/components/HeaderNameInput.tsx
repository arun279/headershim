import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { COMMON_HEADER_NAMES } from "../../core/header-names";
import { normalizeHeaderName, validateHeaderName } from "../../core/headers";
import type { Direction } from "../../core/model";
import { useAnnounce } from "../a11y/LiveRegion";
import { copy } from "../copy";
import { headerErrorMessage } from "../state/header-errors";
import { closePopover, openPositionedPopover } from "./popover";
import { sentence } from "./sentence";
import "./HeaderNameInput.css";
import "./MenuSurface.css";

interface HeaderNameInputProps {
  /** Raw text as typed; the editor echoes it and the store lowercases it. */
  value: string;
  /** Picks the placeholder example so it names a header this side can carry. */
  direction: Direction;
  /** Blocking commit error, rendered inline under the field. */
  error?: string | undefined;
  autoFocus?: boolean;
  inputRef?: ((element: HTMLInputElement | null) => void) | undefined;
  onInput: (raw: string) => void;
  /**
   * Offers pasted text to the editor before it lands: a whole `name: value`
   * line belongs across both fields, not in this one. True means the editor
   * took it.
   */
  onPasteLine?: ((text: string) => boolean) | undefined;
}

/**
 * Combobox over the bundled common-header list (never fetched). The list opens
 * on ↓ or the trailing chevron, never on a keystroke, so it cannot paint over
 * the value field below; typing then filters an already-open list. ↑/↓ move the
 * active option; Enter accepts it (a closed list lets Enter bubble to commit the
 * rule); Esc closes the list first and only then
 * reaches the editor. Match counts are announced politely. Under the field:
 * the case-honesty microline. Header advisories render in the editor's pinned
 * caution band so they remain visible at the save decision. A pasted
 * `name: value` line is handed to the editor, which splits it across its two
 * fields rather than failing this one's token grammar on the colon.
 */
export function HeaderNameInput(props: HeaderNameInputProps) {
  const id = useId();
  const announce = useAnnounce();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
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
  // One source for "the list is on screen": intent to open, and matches to show.
  // Every ARIA flag, the positioning effect and the render read it, so a query
  // that matches nothing can never float an empty box over the field below.
  const expanded = open && matches.length > 0;

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
    if (expanded) {
      announce(copy.editor.suggestions(matches.length));
    }
  }, [expanded, matches.length, announce]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const input = inputRef.current;
    if (!expanded || list === null || input === null) {
      return;
    }
    openPositionedPopover(list, input);
    return () => closePopover(list);
  }, [expanded, matches.length]);

  const select = (name: string) => {
    props.onInput(name);
    setOpen(false);
  };

  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const caseId = `${id}-case`;
  // The same verdict the commit runs, one keystroke early: an illegal name puts
  // its error where the case line would sit, so the field never reassures about
  // a name the save will refuse. A commit that got further raises props.error.
  const nameError =
    props.value.trim() === "" ? undefined : validateHeaderName(normalized);
  const message =
    nameError === undefined ? props.error : headerErrorMessage(nameError);
  const showCase =
    message === undefined &&
    props.value.trim() !== "" &&
    props.value.trim() !== normalized;
  const describedBy = message !== undefined ? errorId : showCase ? caseId : "";

  return (
    <div class="editor-field">
      <label class="editor-label" for={`${id}-input`}>
        {copy.editor.labels.headerName}
      </label>
      <div class="editor-control combobox">
        <input
          id={`${id}-input`}
          ref={(element) => {
            inputRef.current = element;
            props.inputRef?.(element);
          }}
          class="field mono"
          placeholder={copy.editor.placeholders.headerName[props.direction]}
          type="text"
          spellcheck={false}
          autocomplete="off"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            expanded && active !== undefined ? `${id}-opt-${active}` : undefined
          }
          aria-invalid={message !== undefined ? true : undefined}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          value={props.value}
          onInput={(event) => {
            props.onInput(event.currentTarget.value);
            setActiveIndex(undefined);
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
                if (expanded) {
                  event.preventDefault();
                  setOpen(false);
                }
                return;
            }
          }}
          onPaste={(event) => {
            const text = event.clipboardData?.getData("text/plain") ?? "";
            if (props.onPasteLine?.(text) === true) {
              event.preventDefault();
              setOpen(false);
            }
          }}
          onBlur={() => {
            setOpen(false);
            setActiveIndex(undefined);
          }}
        />
        <button
          type="button"
          class="combo-toggle"
          tabIndex={-1}
          aria-hidden="true"
          disabled={matches.length === 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setActiveIndex(undefined);
            setOpen((current) => !current);
            inputRef.current?.focus();
          }}
        >
          ▾
        </button>
        {expanded && (
          <div
            class="combo-list"
            role="listbox"
            id={listId}
            ref={listRef}
            popover="manual"
          >
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
                  <span class="combo-hint">: {copy.headerHints[name]}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {message !== undefined ? (
        <p class="editor-error" role="alert" id={errorId}>
          {message}
        </p>
      ) : (
        showCase && (
          <p class="editor-micro" id={caseId}>
            {sentence(copy.editor.savedAs(normalized))}
          </p>
        )
      )}
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

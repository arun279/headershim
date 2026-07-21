import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { COMMON_HEADER_NAMES } from "../../core/header-names";
import { normalizeHeaderName } from "../../core/headers";
import { useAnnounce } from "../a11y/LiveRegion";
import { copy } from "../copy";
import { closePopover, openPositionedPopover } from "./popover";
import { sentence } from "./sentence";
import "./HeaderNameInput.css";
import "./MenuSurface.css";

interface HeaderNameInputProps {
  /** Raw text as typed; the editor echoes it and the store lowercases it. */
  value: string;
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
 * Combobox over the bundled common-header list (never fetched). Typing
 * filters; ↓/↑ move the active option; Enter accepts it (a closed list lets
 * Enter bubble to commit the rule); Esc closes the list first and only then
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

  useLayoutEffect(() => {
    const list = listRef.current;
    const input = inputRef.current;
    if (!open || list === null || input === null) {
      return;
    }
    openPositionedPopover(list, input);
    return () => closePopover(list);
  }, [open, matches.length]);

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
          ref={(element) => {
            inputRef.current = element;
            props.inputRef?.(element);
          }}
          class="field mono"
          placeholder={copy.editor.placeholders.headerName}
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
        {open && (
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
        {showCase && (
          <p class="editor-micro" id={caseId}>
            {sentence(copy.editor.savedAs(normalized))}
          </p>
        )}
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

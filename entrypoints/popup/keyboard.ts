/**
 * The popup's keyboard model. Three contexts, three pure maps:
 *
 * - `popupKeyHandler` — popup-wide commands (n/t/p/v, profile digits, Esc),
 *   attached at the popup root. Single-letter and digit shortcuts are inert
 *   while focus is in a text field.
 * - `rowCommand` — keys that act on the focused rule row.
 * - `listNavCommand` — roving-tabindex movement within the rule list.
 *
 * The row and list maps live here so the whole binding table is one file; the
 * rule list consumes them for focus mechanics it alone can perform. Editor
 * commit keys (Enter, Ctrl/Cmd+Enter, Esc) belong to the editor itself: layers
 * consume their keys with preventDefault, and this handler ignores anything
 * already consumed.
 */

type KeyLike = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "shiftKey"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "target"
  | "defaultPrevented"
  | "preventDefault"
>;

export interface PopupCommands {
  /** `n` — open the new-rule composer. */
  newRule?: () => void;
  /** `t` — open a new This-tab override row. */
  newThisTabOverride?: () => void;
  /** `p` — toggle global pause. */
  togglePause?: () => void;
  /** `v` — run Verify on the current tab. */
  verify?: () => void;
  /** `1` through `9` focuses the profile at that position without toggling it. */
  focusProfile?: (position: number) => void;
  /** `Shift+1`–`9` — toggle that profile without touching the others. */
  toggleProfile?: (position: number) => void;
  /** `Esc` with no layer open — close the popup. */
  closePopup?: () => void;
}

export function popupKeyHandler(
  commands: PopupCommands,
): (event: KeyboardEvent) => void {
  return (event) => {
    // A layer (menu, editor, modal) that handled the key owns it.
    if (event.defaultPrevented) {
      return;
    }
    if (event.key === "Escape") {
      commands.closePopup?.();
      return;
    }
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      isTextField(event.target)
    ) {
      return;
    }

    const digit = profileDigit(event);
    if (digit !== undefined) {
      dispatch(
        event,
        event.shiftKey ? commands.toggleProfile : commands.focusProfile,
        digit,
      );
      return;
    }
    if (event.shiftKey) {
      return;
    }
    switch (event.key) {
      case "n":
        return dispatch(event, commands.newRule);
      case "t":
        return dispatch(event, commands.newThisTabOverride);
      case "p":
        return dispatch(event, commands.togglePause);
      case "v":
        return dispatch(event, commands.verify);
    }
  };
}

function dispatch(
  event: KeyLike,
  command: ((position: number) => void) | undefined,
  position = 0,
): void {
  if (command !== undefined) {
    event.preventDefault();
    command(position);
  }
}

/**
 * Profile positions read the physical digit row (and numpad), so Shift+1 works
 * on every layout instead of depending on what `!` happens to be.
 */
function profileDigit(event: KeyLike): number | undefined {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  return match === null ? undefined : Number(match[1]);
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

export type RowCommand = "edit" | "toggle" | "grant" | "delete" | "menu";

/** Keys that act on the focused rule row (the row element itself, not a control inside it). */
export function rowCommand(event: KeyLike): RowCommand | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return undefined;
  }
  // Shift+F10 is the context-menu key for keyboards without a ContextMenu key.
  if (event.shiftKey) {
    return event.key === "F10" ? "menu" : undefined;
  }
  switch (event.key) {
    case "Enter":
      return "edit";
    case " ":
      return "toggle";
    case "g":
      return "grant";
    case "Delete":
    case "Backspace":
      return "delete";
    case "ContextMenu":
      return "menu";
    default:
      return undefined;
  }
}

export type ListNavCommand = "up" | "down" | "first" | "last";

/** Roving-tabindex movement between rule rows. */
export function listNavCommand(event: KeyLike): ListNavCommand | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return undefined;
  }
  switch (event.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return undefined;
  }
}

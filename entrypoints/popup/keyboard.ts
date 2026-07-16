/**
 * The popup's keyboard model. Three contexts, three pure maps:
 *
 * - `popupKeyHandler` — popup-wide commands (n/t/p, Esc), attached at the popup
 *   root. Single-letter shortcuts are inert while focus is in a text field.
 * - `rowCommand` — keys that act on a focused rule row (options bulk panel).
 * - `listNavCommand` — roving-tabindex movement within a rule list.
 *
 * The row and list maps live here so the whole binding table is one file. Layer
 * commit keys (Enter, Ctrl/Cmd+Enter, Esc) belong to the layer itself: layers
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
  /** `n` — add a change (open the rule composer). */
  addChange?: () => void;
  /** `t` — add a this-tab change. */
  justThisTab?: () => void;
  /** `p` — toggle global pause. */
  togglePause?: () => void;
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
      event.shiftKey ||
      isTextField(event.target)
    ) {
      return;
    }
    switch (event.key) {
      case "n":
        return dispatch(event, commands.addChange);
      case "t":
        return dispatch(event, commands.justThisTab);
      case "p":
        return dispatch(event, commands.togglePause);
    }
  };
}

function dispatch(event: KeyLike, command: (() => void) | undefined): void {
  if (command !== undefined) {
    event.preventDefault();
    command();
  }
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

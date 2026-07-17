/**
 * The popup's keyboard model: `popupKeyHandler` maps popup-wide commands
 * (n/t/p, Esc) and is attached at the popup root. Single-letter shortcuts are
 * inert while focus is in a text field.
 *
 * Layer commit keys (Enter, Ctrl/Cmd+Enter, Esc) belong to the layer itself:
 * layers consume their keys with preventDefault, and this handler ignores
 * anything already consumed.
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

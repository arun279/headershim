// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  listNavCommand,
  type PopupCommands,
  popupKeyHandler,
  rowCommand,
} from "../../entrypoints/popup/keyboard";

function commands() {
  return {
    newRule: vi.fn(),
    newThisTabOverride: vi.fn(),
    togglePause: vi.fn(),
    verify: vi.fn(),
    focusProfile: vi.fn(),
    toggleProfile: vi.fn(),
    closePopup: vi.fn(),
  } satisfies PopupCommands;
}

function keydown(
  init: KeyboardEventInit & { key: string },
  target?: HTMLElement,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  (target ?? document.body).dispatchEvent(event);
  return event;
}

describe("popupKeyHandler", () => {
  it.each([
    ["n", "newRule"],
    ["t", "newThisTabOverride"],
    ["p", "togglePause"],
    ["v", "verify"],
  ] as const)("%s dispatches %s and consumes the key", (key, command) => {
    const dispatched = commands();
    const handler = popupKeyHandler(dispatched);
    const event = keydown({ key });
    handler(event);
    expect(dispatched[command]).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("digits switch to the profile at that position, exclusively", () => {
    const dispatched = commands();
    const handler = popupKeyHandler(dispatched);
    handler(keydown({ key: "1", code: "Digit1" }));
    handler(keydown({ key: "9", code: "Digit9" }));
    handler(keydown({ key: "5", code: "Numpad5" }));
    expect(dispatched.focusProfile.mock.calls).toEqual([[1], [9], [5]]);
    expect(dispatched.toggleProfile).not.toHaveBeenCalled();
  });

  it("Shift+digit toggles that profile without touching the others", () => {
    const dispatched = commands();
    const handler = popupKeyHandler(dispatched);
    // Shift+2 types "@" on a US layout; the physical digit key still binds.
    handler(keydown({ key: "@", code: "Digit2", shiftKey: true }));
    expect(dispatched.toggleProfile).toHaveBeenCalledWith(2);
    expect(dispatched.focusProfile).not.toHaveBeenCalled();
  });

  it("ignores Digit0 and non-digit codes", () => {
    const dispatched = commands();
    const handler = popupKeyHandler(dispatched);
    handler(keydown({ key: "0", code: "Digit0" }));
    expect(dispatched.focusProfile).not.toHaveBeenCalled();
  });

  it("Escape closes the popup, even from a text field", () => {
    const dispatched = commands();
    const handler = popupKeyHandler(dispatched);
    const input = document.createElement("input");
    document.body.appendChild(input);
    handler(keydown({ key: "Escape" }, input));
    expect(dispatched.closePopup).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it.each([
    "input",
    "textarea",
    "select",
  ] as const)("single letters and digits are inert while focus is in a %s", (tag) => {
    const dispatched = commands();
    const handler = popupKeyHandler(dispatched);
    const field = document.createElement(tag);
    document.body.appendChild(field);
    for (const init of [
      { key: "n" },
      { key: "t" },
      { key: "p" },
      { key: "v" },
      { key: "1", code: "Digit1" },
      { key: "!", code: "Digit1", shiftKey: true },
    ]) {
      const event = keydown(init, field);
      handler(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(dispatched.newRule).not.toHaveBeenCalled();
    expect(dispatched.newThisTabOverride).not.toHaveBeenCalled();
    expect(dispatched.togglePause).not.toHaveBeenCalled();
    expect(dispatched.verify).not.toHaveBeenCalled();
    expect(dispatched.focusProfile).not.toHaveBeenCalled();
    expect(dispatched.toggleProfile).not.toHaveBeenCalled();
    field.remove();
  });

  it("is inert in contenteditable regions", () => {
    const dispatched = commands();
    const handler = popupKeyHandler(dispatched);
    const region = document.createElement("div");
    region.contentEditable = "true";
    document.body.appendChild(region);
    handler(keydown({ key: "p" }, region));
    expect(dispatched.togglePause).not.toHaveBeenCalled();
    region.remove();
  });

  it("leaves modified and shifted letters alone", () => {
    const dispatched = commands();
    const handler = popupKeyHandler(dispatched);
    handler(keydown({ key: "n", ctrlKey: true }));
    handler(keydown({ key: "p", metaKey: true }));
    handler(keydown({ key: "v", altKey: true }));
    handler(keydown({ key: "N", shiftKey: true }));
    expect(dispatched.newRule).not.toHaveBeenCalled();
    expect(dispatched.togglePause).not.toHaveBeenCalled();
    expect(dispatched.verify).not.toHaveBeenCalled();
  });

  it("never re-handles a key a layer already consumed", () => {
    const dispatched = commands();
    const handler = popupKeyHandler(dispatched);
    const event = keydown({ key: "p" });
    event.preventDefault();
    handler(event);
    expect(dispatched.togglePause).not.toHaveBeenCalled();
  });

  it("no-ops without preventDefault when a command has no surface yet", () => {
    const handler = popupKeyHandler({});
    const event = keydown({ key: "n" });
    handler(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("rowCommand", () => {
  it.each([
    ["Enter", "edit"],
    [" ", "toggle"],
    ["g", "grant"],
    ["Delete", "delete"],
    ["Backspace", "delete"],
    ["ContextMenu", "menu"],
  ] as const)("%s → %s", (key, expected) => {
    expect(rowCommand(keydown({ key }))).toBe(expected);
  });

  it("Shift+F10 opens the menu for keyboards without a ContextMenu key", () => {
    expect(rowCommand(keydown({ key: "F10", shiftKey: true }))).toBe("menu");
    expect(rowCommand(keydown({ key: "F10" }))).toBeUndefined();
  });

  it("ignores other and modified keys", () => {
    expect(rowCommand(keydown({ key: "a" }))).toBeUndefined();
    expect(
      rowCommand(keydown({ key: "Enter", ctrlKey: true })),
    ).toBeUndefined();
    expect(rowCommand(keydown({ key: " ", shiftKey: true }))).toBeUndefined();
    expect(
      rowCommand(keydown({ key: "F10", shiftKey: true, altKey: true })),
    ).toBeUndefined();
  });
});

describe("listNavCommand", () => {
  it.each([
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["Home", "first"],
    ["End", "last"],
  ] as const)("%s → %s", (key, expected) => {
    expect(listNavCommand(keydown({ key }))).toBe(expected);
  });

  it("ignores other and modified keys", () => {
    expect(listNavCommand(keydown({ key: "PageDown" }))).toBeUndefined();
    expect(
      listNavCommand(keydown({ key: "ArrowDown", altKey: true })),
    ).toBeUndefined();
  });
});

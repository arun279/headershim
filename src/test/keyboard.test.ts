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
    addChange: vi.fn(),
    justThisTab: vi.fn(),
    togglePause: vi.fn(),
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
    ["n", "addChange"],
    ["t", "justThisTab"],
    ["p", "togglePause"],
  ] as const)("%s dispatches %s and consumes the key", (key, command) => {
    const dispatched = commands();
    const handler = popupKeyHandler(dispatched);
    const event = keydown({ key });
    handler(event);
    expect(dispatched[command]).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
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
    for (const init of [{ key: "n" }, { key: "t" }, { key: "p" }]) {
      const event = keydown(init, field);
      handler(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(dispatched.addChange).not.toHaveBeenCalled();
    expect(dispatched.justThisTab).not.toHaveBeenCalled();
    expect(dispatched.togglePause).not.toHaveBeenCalled();
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
    handler(keydown({ key: "t", altKey: true }));
    handler(keydown({ key: "N", shiftKey: true }));
    expect(dispatched.addChange).not.toHaveBeenCalled();
    expect(dispatched.togglePause).not.toHaveBeenCalled();
    expect(dispatched.justThisTab).not.toHaveBeenCalled();
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

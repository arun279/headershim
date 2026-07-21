import type { VNode } from "preact";
import { render as preactRender } from "preact";
import { act } from "preact/test-utils";
import { afterEach } from "vitest";

let container: HTMLDivElement | null = null;

/** Mounts a component into a fresh document container, flushing effects via act. */
export function render(ui: VNode): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    preactRender(ui, container as HTMLDivElement);
  });
  return container;
}

/** Runs an interaction and flushes any resulting state updates and effects. */
export function fire(interaction: () => void): void {
  act(interaction);
}

/** Finds the button whose visible text is exactly `label`, or throws. */
export function findButton(root: ParentNode, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (button === undefined) {
    throw new Error(`no button labeled "${label}"`);
  }
  return button;
}

export function press(target: HTMLElement, key: string): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

/** Sets an input's value the way a user would: value + bubbling input event. */
export function typeInto(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Pastes plain text into a field the way the clipboard delivers it. */
export function pasteInto(
  input: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): void {
  act(() => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => text },
    });
    input.dispatchEvent(event);
  });
}

/** Dispatches a focus departure from `from` towards `to` (null = nowhere). */
export function focusOut(from: HTMLElement, to: EventTarget | null): void {
  act(() => {
    from.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: to }),
    );
  });
}

/**
 * Flushes a few macrotask rounds under act, letting storage events, lock
 * queues, and subscription reloads land before assertions.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

afterEach(() => {
  if (container !== null) {
    preactRender(null, container);
    container.remove();
    container = null;
  }
});

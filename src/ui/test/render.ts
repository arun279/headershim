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
export function typeInto(input: HTMLInputElement, value: string): void {
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
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
 * Moves real focus to a throwaway element outside any mounted component, the way
 * clicking or tabbing away from an inline editor does. Focus-leave logic that
 * keys off where focus actually settles (document.activeElement) needs the
 * departure to be real, not a synthetic focusout event.
 */
export function blurToOutside(): void {
  const sink = document.createElement("button");
  document.body.appendChild(sink);
  act(() => {
    sink.focus();
  });
}

/**
 * Flushes a few macrotask rounds (plus an animation frame) under act, letting
 * storage events, lock queues, subscription reloads, and deferred focus-settle
 * checks land before assertions.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null)),
      );
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

import type { VNode } from "preact";
import { render as preactRender } from "preact";
import { act } from "preact/test-utils";
import { afterEach } from "vitest";

let container: HTMLDivElement | null = null;
const watching = new Set<MutationObserver>();

function freshContainer(): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

/** Mounts a component into a fresh document container, flushing effects via act. */
export function render(ui: VNode): HTMLElement {
  const root = freshContainer();
  act(() => {
    preactRender(ui, root);
  });
  return root;
}

/**
 * Mounts outside act, leaving Preact's passive effects queued for the frame it
 * schedules them on. Pair with `atPaint` to observe the commit that paints a
 * surface; `render` drains both effect queues before it returns.
 */
export function paint(ui: VNode): HTMLElement {
  const root = freshContainer();
  preactRender(ui, root);
  return root;
}

/** Runs an interaction and flushes any resulting state updates and effects. */
export function fire(interaction: () => void): void {
  act(interaction);
}

/**
 * Reports what `observe` finds on the microtask checkpoint after the first
 * commit `painted` accepts, which is the instant that surface reaches the
 * screen. Preact runs layout effects inside that commit and defers passive ones
 * to a later frame, so a fact already true here was established while the
 * surface was being painted. Set it up before the mount or interaction that
 * paints, and drive that with `paint` or a bare DOM call: anything routed
 * through act flushes both effect queues before this can look.
 *
 * A commit that never satisfies `painted` leaves the promise pending, so the
 * observer is torn down with the container rather than left armed to fire
 * `observe` into the next test's document.
 */
export function atPaint<T>(
  painted: () => boolean,
  observe: () => T,
): Promise<T> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!painted()) return;
      observer.disconnect();
      resolve(observe());
    });
    watching.add(observer);
    observer.observe(document.body, { childList: true, subtree: true });
  });
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
  for (const observer of watching) {
    observer.disconnect();
  }
  watching.clear();
  if (container !== null) {
    preactRender(null, container);
    container.remove();
    container = null;
  }
});

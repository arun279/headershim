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

export function press(target: HTMLElement, key: string): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
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

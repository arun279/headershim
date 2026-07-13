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

afterEach(() => {
  if (container !== null) {
    preactRender(null, container);
    container.remove();
    container = null;
  }
});

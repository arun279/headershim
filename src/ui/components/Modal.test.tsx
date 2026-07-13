// @vitest-environment happy-dom
import { render as preactRender, type VNode } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { press, render } from "../test/render";
import { Modal } from "./Modal";

const dialog = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;

describe("Modal", () => {
  it("is a labelled modal dialog", () => {
    const root = render(
      <Modal title="Delete profile 'QA roles'?" onClose={() => {}}>
        <button type="button">Cancel</button>
      </Modal>,
    );
    const el = dialog(root);
    expect(el.getAttribute("aria-modal")).toBe("true");
    const labelId = el.getAttribute("aria-labelledby");
    expect(root.querySelector(`#${labelId}`)?.textContent).toBe(
      "Delete profile 'QA roles'?",
    );
  });

  it("moves focus to the initial target on open (Cancel first)", () => {
    function Host() {
      const cancel = useRef<HTMLButtonElement>(null);
      return (
        <Modal title="Delete?" onClose={() => {}} initialFocus={cancel}>
          <button type="button">Delete</button>
          <button type="button" ref={cancel}>
            Cancel
          </button>
        </Modal>
      );
    }
    const root = render(<Host />);
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    const root = render(
      <Modal title="Delete?" onClose={onClose}>
        <button type="button">Cancel</button>
      </Modal>,
    );
    press(dialog(root), "Escape");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("wraps Tab from last back to first focusable", () => {
    const root = render(
      <Modal title="Delete?" onClose={() => {}}>
        <button type="button">Delete</button>
        <button type="button">Cancel</button>
      </Modal>,
    );
    const buttons =
      root.querySelectorAll<HTMLButtonElement>(".modal-card button");
    const last = buttons[buttons.length - 1] as HTMLButtonElement;
    last.focus();
    press(dialog(root), "Tab");
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("returns focus to the trigger on unmount", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const ui: VNode = (
      <Modal title="Delete?" onClose={() => {}}>
        <button type="button">Cancel</button>
      </Modal>
    );
    act(() => preactRender(ui, container));
    expect(document.activeElement?.textContent).toBe("Cancel");

    act(() => preactRender(null, container));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
    container.remove();
  });
});

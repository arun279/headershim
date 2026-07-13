// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fire, render } from "../test/render";
import { Toast } from "./Toast";

const toast = (root: HTMLElement) =>
  root.querySelector<HTMLElement>(".toast") as HTMLElement;

describe("Toast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("announces politely and shows no close control", () => {
    const root = render(<Toast onDismiss={() => {}}>Rule deleted</Toast>);
    const el = toast(root);
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("aria-live")).toBe("polite");
    expect(el.textContent).toContain("Rule deleted");
    expect(root.querySelector(".toast-action")).toBeNull();
  });

  it("runs the action without dismissing on its own timer", () => {
    const onAction = vi.fn();
    const root = render(
      <Toast actionLabel="Undo" onAction={onAction} onDismiss={() => {}}>
        Rule deleted
      </Toast>,
    );
    const action = root.querySelector<HTMLButtonElement>(
      ".toast-action",
    ) as HTMLButtonElement;
    expect(action.textContent).toBe("Undo");
    fire(() => action.click());
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("self-dismisses after the default 6 seconds", () => {
    const onDismiss = vi.fn();
    render(<Toast onDismiss={onDismiss}>Active on api.example.com</Toast>);
    vi.advanceTimersByTime(5999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("honors a custom duration", () => {
    const onDismiss = vi.fn();
    render(
      <Toast onDismiss={onDismiss} duration={1000}>
        Saved
      </Toast>,
    );
    vi.advanceTimersByTime(1000);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("holds open with no auto-dismiss while persist keeps an action reachable", () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        onDismiss={onDismiss}
        persist
        actionLabel="Undo"
        onAction={() => {}}
      >
        Profile deleted
      </Toast>,
    );
    vi.advanceTimersByTime(60_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

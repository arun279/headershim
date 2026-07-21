// @vitest-environment happy-dom

import { useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fire, render } from "../test/render";
import { Toast } from "./Toast";

const toast = (root: HTMLElement) =>
  root.querySelector<HTMLElement>(".toast") as HTMLElement;

describe("Toast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("leaves announcements to the persistent live region and shows no close control", () => {
    const root = render(
      <Toast nonce={1} onDismiss={() => {}}>
        Rule deleted
      </Toast>,
    );
    const el = toast(root);
    expect(el.getAttribute("role")).toBeNull();
    expect(el.getAttribute("aria-live")).toBeNull();
    expect(el.textContent).toContain("Rule deleted");
    expect(root.querySelector(".toast-action")).toBeNull();
  });

  it("runs the action without dismissing on its own timer", () => {
    const onAction = vi.fn();
    const root = render(
      <Toast
        nonce={1}
        actionLabel="Undo"
        onAction={onAction}
        onDismiss={() => {}}
      >
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
    render(
      <Toast nonce={1} onDismiss={onDismiss}>
        Active on api.example.com
      </Toast>,
    );
    vi.advanceTimersByTime(5999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("honors a custom duration", () => {
    const onDismiss = vi.fn();
    render(
      <Toast nonce={1} onDismiss={onDismiss} duration={1000}>
        Saved
      </Toast>,
    );
    vi.advanceTimersByTime(1000);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps one countdown across parent rerenders", () => {
    const onDismiss = vi.fn();

    function Probe() {
      const [count, setCount] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setCount((value) => value + 1)}>
            Render {count}
          </button>
          <Toast nonce={1} onDismiss={() => onDismiss(count)}>
            Saved
          </Toast>
        </>
      );
    }

    const root = render(<Probe />);
    vi.advanceTimersByTime(3000);
    fire(() => root.querySelector<HTMLButtonElement>("button")?.click());
    vi.advanceTimersByTime(3000);
    expect(onDismiss).toHaveBeenCalledWith(1);
  });

  it("restarts the countdown for an identical notification raised again", () => {
    const onDismiss = vi.fn();

    function Probe() {
      const [nonce, setNonce] = useState(1);
      return (
        <>
          <button type="button" onClick={() => setNonce((value) => value + 1)}>
            Raise again
          </button>
          <Toast nonce={nonce} onDismiss={onDismiss}>
            Changes saved
          </Toast>
        </>
      );
    }

    const root = render(<Probe />);
    vi.advanceTimersByTime(5900);
    fire(() => root.querySelector<HTMLButtonElement>("button")?.click());
    vi.advanceTimersByTime(100);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5900);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("gives a late new message its full countdown", () => {
    const onDismiss = vi.fn();

    function Probe() {
      const [notification, setNotification] = useState({
        message: "First message",
        nonce: 1,
      });
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setNotification({ message: "Second message", nonce: 2 })
            }
          >
            Raise second
          </button>
          <Toast nonce={notification.nonce} onDismiss={onDismiss}>
            {notification.message}
          </Toast>
        </>
      );
    }

    const root = render(<Probe />);
    vi.advanceTimersByTime(5900);
    fire(() => root.querySelector<HTMLButtonElement>("button")?.click());
    expect(toast(root).textContent).toContain("Second message");
    vi.advanceTimersByTime(100);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5899);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("holds open with no auto-dismiss while persist keeps an action reachable", () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        nonce={1}
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

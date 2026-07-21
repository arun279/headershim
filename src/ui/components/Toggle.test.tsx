// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { fire, render } from "../test/render";
import { Toggle } from "./Toggle";

const getSwitch = (root: HTMLElement) =>
  root.querySelector<HTMLButtonElement>('[role="switch"]') as HTMLButtonElement;

describe("Toggle", () => {
  it("exposes switch role, checked state, and object-naming label", () => {
    const root = render(
      <Toggle checked label="Rule on: authorization" onChange={() => {}} />,
    );
    const sw = getSwitch(root);
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.getAttribute("aria-label")).toBe("Rule on: authorization");
  });

  it("reflects the off state", () => {
    const root = render(
      <Toggle checked={false} label="All header changes" onChange={() => {}} />,
    );
    expect(getSwitch(root).getAttribute("aria-checked")).toBe("false");
  });

  it("marks an on-but-paused switch for the stopped-state color", () => {
    const root = render(
      <Toggle
        checked
        label="Turn off: authorization"
        tone="paused"
        onChange={() => {}}
      />,
    );
    expect(getSwitch(root).classList.contains("sw-paused")).toBe(true);
  });

  it("marks a blocked checked switch for the solid held-state color", () => {
    const root = render(
      <Toggle
        checked
        label="Rule on: x-test"
        tone="blocked"
        onChange={() => {}}
      />,
    );
    expect(getSwitch(root).classList.contains("sw-blocked")).toBe(true);
  });

  it("marks an inert checked switch so it does not look live", () => {
    const root = render(
      <Toggle
        checked
        label="Rule on: x-test"
        tone="inert"
        onChange={() => {}}
      />,
    );
    expect(getSwitch(root).classList.contains("sw-inert")).toBe(true);
  });

  it("reports the flipped value on activation", () => {
    const onChange = vi.fn();
    const root = render(
      <Toggle checked={false} label="All header changes" onChange={onChange} />,
    );
    fire(() => getSwitch(root).click());
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not fire when disabled", () => {
    const onChange = vi.fn();
    const root = render(
      <Toggle checked label="Rule on: x" onChange={onChange} disabled />,
    );
    const sw = getSwitch(root);
    expect(sw.disabled).toBe(true);
    fire(() => sw.click());
    expect(onChange).not.toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { fire, render } from "../test/render";
import { LiveRegionProvider, useAnnounce } from "./LiveRegion";

let announce: (message: string) => void;

function Probe() {
  announce = useAnnounce();
  return null;
}

const region = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[role="status"]') as HTMLElement;

describe("LiveRegion", () => {
  it("hosts one polite, atomic region that starts empty", () => {
    const root = render(
      <LiveRegionProvider>
        <Probe />
      </LiveRegionProvider>,
    );
    const el = region(root);
    expect(el.getAttribute("aria-live")).toBe("polite");
    expect(el.getAttribute("aria-atomic")).toBe("true");
    expect(el.className).toBe("sr-only");
    expect(el.textContent).toBe("");
  });

  it("surfaces announced messages", () => {
    const root = render(
      <LiveRegionProvider>
        <Probe />
      </LiveRegionProvider>,
    );
    fire(() => announce("Active on api.example.com"));
    expect(region(root).textContent).toBe("Active on api.example.com");
  });

  it("re-announces an identical message via a fresh node", () => {
    const root = render(
      <LiveRegionProvider>
        <Probe />
      </LiveRegionProvider>,
    );
    fire(() => announce("Rule deleted"));
    const firstNode = region(root).firstElementChild;
    fire(() => announce("Rule deleted"));
    const secondNode = region(root).firstElementChild;
    expect(region(root).textContent).toBe("Rule deleted");
    expect(secondNode).not.toBe(firstNode);
  });
});

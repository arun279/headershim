// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { fire, render } from "../test/render";
import { Button } from "./Button";

const button = (root: HTMLElement) =>
  root.querySelector<HTMLButtonElement>("button") as HTMLButtonElement;

describe("Button", () => {
  it("renders the five kinds with their distinct paint classes", () => {
    expect(
      button(render(<Button kind="primary">Import</Button>)).className,
    ).toBe("btn primary");
    expect(button(render(<Button kind="quiet">Verify</Button>)).className).toBe(
      "btn quiet",
    );
    expect(
      button(render(<Button kind="caution">Grant access</Button>)).className,
    ).toBe("btn caution");
    expect(
      button(
        render(
          <Button kind="ghost" label="Options">
            gear
          </Button>,
        ),
      ).className,
    ).toBe("icon-btn");
    expect(
      button(render(<Button kind="destructive">Delete</Button>)).className,
    ).toBe("btn destructive");
  });

  it("names an icon-only ghost button for assistive tech and on hover", () => {
    const el = button(
      render(
        <Button kind="ghost" label="Options">
          gear
        </Button>,
      ),
    );
    expect(el.getAttribute("aria-label")).toBe("Options");
    // The one label feeds both channels, so hovering the bare icon names it too.
    expect(el.getAttribute("title")).toBe("Options");
  });

  it("invokes onClick and defaults type to button", () => {
    const onClick = vi.fn();
    const el = button(
      render(
        <Button kind="primary" onClick={onClick}>
          New rule
        </Button>,
      ),
    );
    expect(el.getAttribute("type")).toBe("button");
    fire(() => el.click());
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("blocks activation when disabled", () => {
    const onClick = vi.fn();
    const el = button(
      render(
        <Button kind="quiet" disabled onClick={onClick}>
          Export
        </Button>,
      ),
    );
    expect(el.disabled).toBe(true);
    fire(() => el.click());
    expect(onClick).not.toHaveBeenCalled();
  });
});

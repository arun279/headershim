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
    ).toBe("menu-item destructive");
  });

  it("gives destructive buttons the menuitem role and others none", () => {
    expect(
      button(render(<Button kind="destructive">Delete</Button>)).getAttribute(
        "role",
      ),
    ).toBe("menuitem");
    expect(
      button(render(<Button kind="primary">New</Button>)).getAttribute("role"),
    ).toBeNull();
  });

  it("names an icon-only ghost button for assistive tech", () => {
    expect(
      button(
        render(
          <Button kind="ghost" label="Options">
            gear
          </Button>,
        ),
      ).getAttribute("aria-label"),
    ).toBe("Options");
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

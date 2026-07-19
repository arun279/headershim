// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { fire, render } from "../test/render";
import { Segmented } from "./Segmented";

const OPTIONS = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
] as const;

describe("Segmented", () => {
  it("keeps native radio grouping and selection semantics", () => {
    const onChange = vi.fn();
    const root = render(
      <Segmented
        semantics="radio"
        name="choice"
        label="Choice"
        value="one"
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    const group = root.querySelector('[role="radiogroup"]') as HTMLElement;
    const radios = [
      ...group.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ];

    expect(group.className).toBe("segmented");
    expect(group.getAttribute("aria-label")).toBe("Choice");
    expect(radios.map((radio) => [radio.name, radio.checked])).toEqual([
      ["choice", true],
      ["choice", false],
    ]);

    fire(() => radios[1]?.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("two");
  });

  it("keeps pressed-button state and activation semantics", () => {
    const onChange = vi.fn();
    const root = render(
      <Segmented
        semantics="pressed"
        label="Choice"
        value="two"
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    const group = root.querySelector("fieldset.segmented") as HTMLElement;
    const buttons = [...group.querySelectorAll<HTMLButtonElement>("button")];

    expect(group.className).toBe("segmented");
    expect(
      buttons.map((button) => button.getAttribute("aria-pressed")),
    ).toEqual(["false", "true"]);
    expect(buttons.every((button) => button.type === "button")).toBe(true);

    fire(() => buttons[0]?.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("one");
  });
});

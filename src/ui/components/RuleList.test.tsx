// @vitest-environment happy-dom
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import type { Profile, Rule } from "../../core/model";
import { fire, press, render } from "../test/render";
import { RuleList } from "./RuleList";

let nextNum = 1;

function rule(id: string, overrides: Partial<Rule> = {}): Rule {
  return {
    id,
    num: nextNum++,
    direction: "request",
    operation: "set",
    header: `x-${id}`,
    value: "1",
    scope: { type: "domains", domains: ["api.acme.dev"] },
    resourceTypes: "all",
    initiators: ["app.acme.dev"],
    enabled: true,
    ...overrides,
  };
}

function profile(id: string, name: string, rules: Rule[]): Profile {
  return { id, name, badgeText: "XX", color: "teal", enabled: true, rules };
}

const twoGroups = () => [
  profile("staging", "Staging auth", [rule("a"), rule("b")]),
  profile("cors", "CORS dev", [rule("c")]),
];

/** For harness tests that never assert on the action callbacks. */
const inertHandlers = () => ({
  onToggle: vi.fn(),
  onGrant: vi.fn(),
  onDelete: vi.fn(),
  onDuplicate: vi.fn(),
  onMove: vi.fn(),
  onRegenerate: vi.fn(),
  onUndoDelete: vi.fn(),
});

function mount(overrides: Partial<Parameters<typeof RuleList>[0]> = {}) {
  const handlers = {
    onToggle: vi.fn(),
    onGrant: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onMove: vi.fn(),
    onRegenerate: vi.fn(),
    onUndoDelete: vi.fn(),
  };
  const props = {
    profiles: twoGroups(),
    allProfiles: [
      { id: "staging", name: "Staging auth" },
      { id: "cors", name: "CORS dev" },
    ],
    missingByRule: new Map<string, readonly string[]>(),
    invalidRuleIds: new Set<string>(),
    undoAvailable: false,
    ...handlers,
    ...overrides,
  };
  const root = render(<RuleList {...props} />);
  const rows = () => [...root.querySelectorAll<HTMLElement>(".rule-row")];
  return { root, rows, ...handlers };
}

describe("RuleList grouping", () => {
  it("renders one labeled list per enabled profile with rules", () => {
    const { root } = mount();
    expect(root.querySelector("section")?.getAttribute("aria-label")).toBe(
      "Rules",
    );
    const labels = [...root.querySelectorAll(".rule-group-label")];
    expect(labels.map((label) => label.textContent)).toEqual([
      "Staging auth",
      "CORS dev",
    ]);
    const lists = [...root.querySelectorAll("ul")];
    expect(lists).toHaveLength(2);
    expect(lists[0]?.getAttribute("aria-labelledby")).toBe(
      labels[0]?.getAttribute("id"),
    );
  });

  it("skips empty profiles entirely — no orphan group label", () => {
    const { root } = mount({
      profiles: [profile("empty", "Empty", []), ...twoGroups()],
    });
    expect(
      [...root.querySelectorAll(".rule-group-label")].map(
        (label) => label.textContent,
      ),
    ).toEqual(["Staging auth", "CORS dev"]);
  });

  it("positions rows globally across groups", () => {
    const { rows } = mount();
    expect(
      rows().map((row) => [
        row.getAttribute("aria-posinset"),
        row.getAttribute("aria-setsize"),
      ]),
    ).toEqual([
      ["1", "3"],
      ["2", "3"],
      ["3", "3"],
    ]);
  });

  it("marks later overlapping rules as overridden, across profile bounds", () => {
    const shadowing = rule("first", { header: "x-shared" });
    const shadowed = rule("last", { header: "x-shared" });
    const { rows } = mount({
      profiles: [
        profile("staging", "Staging auth", [shadowing]),
        profile("cors", "CORS dev", [shadowed]),
      ],
    });
    expect(rows()[0]?.textContent).not.toContain("overridden by a rule above");
    expect(rows()[1]?.textContent).toContain("overridden by a rule above");
  });

  it("maps missing origin patterns to bare hosts for the loud state", () => {
    const { rows } = mount({
      missingByRule: new Map([["a", ["*://*.api.acme.dev/*"]]]),
    });
    expect(rows()[0]?.textContent).toContain("Needs access · api.acme.dev");
    expect(rows()[0]?.classList.contains("blocked")).toBe(true);
  });

  it("hands a blocked row's Grant action the exact missing origins", () => {
    const { rows, onGrant } = mount({
      missingByRule: new Map([["a", ["*://*.api.acme.dev/*"]]]),
    });
    fire(() =>
      rows()[0]?.querySelector<HTMLButtonElement>(".rule-grant")?.click(),
    );
    expect(onGrant).toHaveBeenCalledExactlyOnceWith("staging", "a", [
      "*://*.api.acme.dev/*",
    ]);
    expect(
      rows()[0]?.querySelector<HTMLButtonElement>(".rule-grant")?.tabIndex,
    ).toBe(-1);
  });
});

describe("RuleList keyboard", () => {
  it("roves the tabindex: one row in the tab order, arrows move focus", () => {
    const { rows } = mount();
    expect(rows().map((row) => row.tabIndex)).toEqual([0, -1, -1]);

    fire(() => rows()[0]?.focus());
    press(rows()[0] as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(rows()[1]);
    expect(rows().map((row) => row.tabIndex)).toEqual([-1, 0, -1]);

    // Crosses the group boundary like any other step.
    press(rows()[1] as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(rows()[2]);
    press(rows()[2] as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(rows()[2]);

    press(rows()[2] as HTMLElement, "Home");
    expect(document.activeElement).toBe(rows()[0]);
    press(rows()[0] as HTMLElement, "End");
    expect(document.activeElement).toBe(rows()[2]);
    press(rows()[2] as HTMLElement, "ArrowUp");
    expect(document.activeElement).toBe(rows()[1]);
  });

  it("Enter edits, Space toggles, Delete and Backspace delete", () => {
    const { rows, onEdit, onToggle, onDelete } = mount();
    fire(() => rows()[0]?.focus());
    press(rows()[0] as HTMLElement, "Enter");
    expect(onEdit).toHaveBeenCalledWith("staging", "a");
    press(rows()[0] as HTMLElement, " ");
    expect(onToggle).toHaveBeenCalledWith("staging", "a", false);
    press(rows()[0] as HTMLElement, "Delete");
    press(rows()[1] as HTMLElement, "Backspace");
    expect(onDelete.mock.calls).toEqual([
      ["staging", "a"],
      ["staging", "b"],
    ]);
  });

  it("g grants a blocked row without adding an in-row Tab stop", () => {
    const { rows, onGrant } = mount({
      missingByRule: new Map([["a", ["*://*.api.acme.dev/*"]]]),
    });
    const first = rows()[0] as HTMLElement;

    press(first, "g");

    expect(onGrant).toHaveBeenCalledExactlyOnceWith("staging", "a", [
      "*://*.api.acme.dev/*",
    ]);
  });

  it("Space on an invalid row does nothing — the switch owns the redirect", () => {
    const { rows, onToggle } = mount({ invalidRuleIds: new Set(["a"]) });
    press(rows()[0] as HTMLElement, " ");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("ContextMenu opens the focused row's overflow menu", () => {
    const { root, rows } = mount();
    press(rows()[0] as HTMLElement, "ContextMenu");
    expect(root.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("row keys fire only from the row itself, not from controls inside it", () => {
    const { rows, onDelete, onEdit } = mount();
    const toggle = rows()[0]?.querySelector(".sw") as HTMLElement;
    press(toggle, "Delete");
    press(toggle, "Enter");
    expect(onDelete).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus in the list when the focused row is deleted", () => {
    let remove: () => void = () => {};
    function Harness() {
      const [profiles, setProfiles] = useState(twoGroups);
      remove = () =>
        setProfiles((prev) =>
          prev.map((entry) => ({
            ...entry,
            rules: entry.rules.filter((candidate) => candidate.id !== "b"),
          })),
        );
      return (
        <RuleList
          profiles={profiles}
          allProfiles={[]}
          missingByRule={new Map()}
          invalidRuleIds={new Set()}
          undoAvailable={false}
          {...inertHandlers()}
        />
      );
    }
    const root = render(<Harness />);
    const rows = () => [...root.querySelectorAll<HTMLElement>(".rule-row")];
    fire(() => rows()[1]?.focus());
    expect(document.activeElement).toBe(rows()[1]);

    fire(() => {
      (document.activeElement as HTMLElement).blur();
      remove();
    });
    expect(rows()).toHaveLength(2);
    expect(document.activeElement).toBe(rows()[1]);
    expect(rows()[1]?.tabIndex).toBe(0);
  });
});

// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Rule } from "../../core/model";
import { fire, press, render } from "../test/render";
import { RuleRow } from "./RuleRow";

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    num: 1,
    direction: "request",
    operation: "set",
    header: "authorization",
    value: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
    scope: { type: "domains", domains: ["api.staging.acme.dev"] },
    resourceTypes: "all",
    initiators: ["app.acme.dev"],
    enabled: true,
    ...overrides,
  };
}

function mount(
  props: Partial<Parameters<typeof RuleRow>[0]> & { rule?: Rule } = {},
) {
  const handlers = {
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onMoveToProfile: vi.fn(),
    onRegenerate: vi.fn(),
    onUndoDelete: vi.fn(),
    onFocus: vi.fn(),
    onRowCommand: vi.fn(),
  };
  const root = render(
    <ul>
      <RuleRow
        rule={rule()}
        undoAvailable={false}
        moveTargets={[{ id: "p2", name: "CORS dev" }]}
        posinset={3}
        setsize={12}
        tabIndex={0}
        {...handlers}
        {...props}
      />
    </ul>,
  );
  const row = root.querySelector(".rule-row") as HTMLElement;
  const line2 = () => root.querySelector(".rule-line2") as HTMLElement;
  const toggle = () => root.querySelector(".sw") as HTMLButtonElement;
  const menuButton = () =>
    root.querySelector(".rule-menu-btn") as HTMLButtonElement;
  const menuLabels = () =>
    [...root.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent,
    );
  return { root, row, line2, toggle, menuButton, menuLabels, ...handlers };
}

describe("RuleRow states", () => {
  it("enabled: on-switch, clean edge, name/value line, scoped line 2", () => {
    const { row, toggle, line2 } = mount({
      rule: rule({ comment: "staging token" }),
    });
    expect(row.classList.contains("enabled")).toBe(true);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(toggle().getAttribute("aria-label")).toBe("Rule on: authorization");
    expect(row.querySelector(".rule-name")?.textContent).toBe("authorization");
    expect(row.querySelector(".colon")?.textContent).toBe(": ");
    expect(line2().textContent).toBe("api.staging.acme.dev · staging token");
    expect(line2().querySelector(".mono")?.textContent).toBe(
      "api.staging.acme.dev",
    );
  });

  it("disabled: off-switch with the state in its name, no caution anywhere", () => {
    const { row, toggle } = mount({ rule: rule({ enabled: false }) });
    expect(row.classList.contains("disabled")).toBe(true);
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(toggle().getAttribute("aria-label")).toBe("Rule off: authorization");
    expect(row.querySelector(".rule-status")).toBeNull();
  });

  it("needs access: dashed-edge class, triangle + host, state in the description", () => {
    const { row, line2 } = mount({
      missingHosts: ["app.acme.dev", "api.acme.dev"],
    });
    expect(row.classList.contains("needs-access")).toBe(true);
    expect(line2().querySelector("svg")).not.toBeNull();
    expect(line2().textContent).toBe(" Needs access · app.acme.dev +1");
    expect(row.getAttribute("aria-description")).toContain("needs access");
  });

  it("temporary: dotted-edge class, sentence-case Temporary tag, applies-to line", () => {
    const { row, line2 } = mount({ temporary: { host: "app.acme.dev" } });
    expect(row.classList.contains("temporary")).toBe(true);
    // Uppercasing is CSS-only; the DOM keeps sentence case for AT and copy-paste.
    expect(line2().querySelector(".silk")?.textContent).toBe("Temporary");
    expect(line2().textContent).toContain(
      "applies to app.acme.dev requests in this tab",
    );
  });

  it("invalid: soft-disabled switch whose activation focuses the note", () => {
    const { row, toggle, line2, onToggle } = mount({
      rule: rule({
        enabled: false,
        scope: { type: "regex", regex: "(unclosed", hosts: [] },
      }),
      invalid: true,
    });
    expect(row.classList.contains("invalid")).toBe(true);
    expect(toggle().getAttribute("aria-disabled")).toBe("true");
    expect(line2().textContent).toBe(
      " Invalid regex — edit the scope to enable",
    );
    fire(() => toggle().click());
    expect(onToggle).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(line2().querySelector(".rule-status"));
  });

  it("overridden: passive mute note appended after the scope", () => {
    const { row, line2 } = mount({ overridden: true });
    expect(line2().textContent).toBe(
      "api.staging.acme.dev · overridden by a rule above",
    );
    expect(row.querySelector(".rule-status")).toBeNull();
  });

  it("names the direction for AT and shows the operation word", () => {
    const request = mount();
    const glyph = request.row.querySelector('[role="img"]');
    expect(glyph?.getAttribute("aria-label")).toBe("request");
    expect(glyph?.textContent).toBe("→");
    expect(request.row.querySelector(".rule-op")?.textContent).toBe("set");

    const response = mount({
      rule: rule({ direction: "response", operation: "append" }),
    });
    const back = response.row.querySelector('[role="img"]');
    expect(back?.getAttribute("aria-label")).toBe("response");
    expect(back?.textContent).toBe("←");
    expect(response.row.querySelector(".rule-op")?.textContent).toBe("append");
  });

  it("remove rules show the name only, no colon or value", () => {
    const { value: _, ...removeRule } = rule({ operation: "remove" });
    const { row } = mount({ rule: removeRule });
    expect(row.querySelector(".rule-name")?.textContent).toBe("authorization");
    expect(row.querySelector(".colon")).toBeNull();
    expect(row.querySelector(".rule-value")).toBeNull();
    expect(row.getAttribute("aria-description")).toBeNull();
  });

  it("exposes position and the full value to AT", () => {
    const { row } = mount();
    expect(row.getAttribute("aria-posinset")).toBe("3");
    expect(row.getAttribute("aria-setsize")).toBe("12");
    expect(row.getAttribute("aria-description")).toBe(
      "authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
    );
  });

  it("summarizes pattern, regex, and all-sites scopes without host lists", () => {
    const pattern = mount({
      rule: rule({
        scope: { type: "pattern", pattern: "||acme.dev^", hosts: [] },
      }),
    });
    expect(pattern.line2().textContent).toContain("pattern");
    const regex = mount({
      rule: rule({ scope: { type: "regex", regex: ".*", hosts: [] } }),
    });
    expect(regex.line2().textContent).toContain("regex");
    const all = mount({ rule: rule({ scope: { type: "all" } }) });
    expect(all.line2().textContent).toContain("all sites");
  });

  it("qualifies restricted resource types", () => {
    const one = mount({ rule: rule({ resourceTypes: ["xhr"] }) });
    expect(one.line2().textContent).toContain("XHR/fetch only");
    const two = mount({ rule: rule({ resourceTypes: ["xhr", "scripts"] }) });
    expect(two.line2().textContent).toContain("XHR/fetch, Scripts");
    const four = mount({
      rule: rule({ resourceTypes: ["xhr", "scripts", "images", "fonts"] }),
    });
    expect(four.line2().textContent).toContain("4 types");
  });
});

describe("RuleRow standing initiator note", () => {
  const note = "requests started by other pages also need those pages granted";

  it("appears when a rule reaches subresources and names no initiator", () => {
    const { line2 } = mount({ rule: rule({ initiators: [] }) });
    expect(line2().textContent).toContain(note);
  });

  it("never appears on a Pages-only rule", () => {
    const { line2 } = mount({
      rule: rule({ initiators: [], resourceTypes: ["pages"] }),
    });
    expect(line2().textContent).not.toContain(note);
  });

  it("stays quiet with named initiators or an all-sites scope", () => {
    const named = mount({ rule: rule({ initiators: ["app.acme.dev"] }) });
    expect(named.line2().textContent).not.toContain(note);
    const all = mount({
      rule: rule({ initiators: [], scope: { type: "all" } }),
    });
    expect(all.line2().textContent).not.toContain(note);
  });
});

describe("RuleRow overflow menu", () => {
  it("opens from the ⋯ button with the base actions", () => {
    const { menuButton, menuLabels } = mount();
    expect(menuButton().getAttribute("aria-haspopup")).toBe("menu");
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
    fire(() => menuButton().click());
    expect(menuButton().getAttribute("aria-expanded")).toBe("true");
    expect(menuLabels()).toEqual([
      "Edit",
      "Duplicate",
      "Move to profile ▸",
      "Delete",
    ]);
  });

  it("adds Regenerate value only when the value was generated", () => {
    const { menuButton, menuLabels } = mount({
      rule: rule({
        generated: { kind: "uuid", at: "2026-07-12T14:03:00.000Z" },
      }),
    });
    fire(() => menuButton().click());
    expect(menuLabels()).toContain("Regenerate value");
  });

  it("keeps Undo last delete available after the toast is long gone", () => {
    const { menuButton, menuLabels, onUndoDelete, root } = mount({
      undoAvailable: true,
    });
    fire(() => menuButton().click());
    expect(menuLabels()).toContain("Undo last delete");
    const undo = [...root.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Undo last delete",
    ) as HTMLButtonElement;
    fire(() => undo.click());
    expect(onUndoDelete).toHaveBeenCalledTimes(1);
  });

  it("marks Delete destructive and fires onDelete", () => {
    const { menuButton, onDelete, root } = mount();
    fire(() => menuButton().click());
    const item = [...root.querySelectorAll('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "Delete",
    ) as HTMLButtonElement;
    expect(item.classList.contains("destructive")).toBe(true);
    fire(() => item.click());
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("drills into Move to profile and reports the chosen target", () => {
    const { menuButton, menuLabels, onMoveToProfile, root } = mount();
    fire(() => menuButton().click());
    const move = [...root.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.startsWith("Move to profile"),
    ) as HTMLButtonElement;
    fire(() => move.click());
    expect(menuLabels()).toEqual(["CORS dev"]);
    const target = root.querySelector('[role="menuitem"]') as HTMLButtonElement;
    fire(() => target.click());
    expect(onMoveToProfile).toHaveBeenCalledWith("p2");
  });

  it("hides Move to profile when there is nowhere to move", () => {
    const { menuButton, menuLabels } = mount({ moveTargets: [] });
    fire(() => menuButton().click());
    expect(menuLabels()).not.toContain("Move to profile ▸");
  });

  it("keeps the switch, trigger, and menu items out of the tab order", () => {
    const { row, toggle, menuButton, root } = mount();
    expect(row.tabIndex).toBe(0);
    expect(toggle().tabIndex).toBe(-1);
    expect(menuButton().tabIndex).toBe(-1);
    fire(() => menuButton().click());
    for (const item of root.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )) {
      expect(item.tabIndex).toBe(-1);
    }
  });

  it("Home and End jump to the first and last menu item", () => {
    const { menuButton, root } = mount();
    fire(() => menuButton().click());
    const items = [
      ...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ];
    press(document.activeElement as HTMLElement, "End");
    expect(document.activeElement).toBe(items[items.length - 1]);
    press(document.activeElement as HTMLElement, "Home");
    expect(document.activeElement).toBe(items[0]);
  });

  it("moves focus in on open, arrows cycle, Esc returns to the trigger", () => {
    const { menuButton, root } = mount();
    fire(() => menuButton().click());
    const items = [
      ...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ];
    expect(document.activeElement).toBe(items[0]);
    press(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    press(document.activeElement as HTMLElement, "ArrowUp");
    expect(document.activeElement).toBe(items[0]);
    press(document.activeElement as HTMLElement, "ArrowUp");
    expect(document.activeElement).toBe(items[items.length - 1]);
    press(document.activeElement as HTMLElement, "Escape");
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(menuButton());
  });
});

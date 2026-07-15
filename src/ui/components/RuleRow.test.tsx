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
    onGrant: vi.fn(),
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
  it("running: on-switch, trace rail, name/value line, scoped line 2", () => {
    const { row, toggle, line2 } = mount({
      rule: rule({ comment: "staging token" }),
    });
    expect(row.classList.contains("running")).toBe(true);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(toggle().getAttribute("aria-label")).toBe("Rule on: authorization");
    expect(row.querySelector(".rule-name")?.textContent).toBe("authorization");
    expect(row.querySelector(".colon")?.textContent).toBe(": ");
    expect(row.querySelector(".rule-value-preview .rule-value")).not.toBeNull();
    expect(line2().textContent).toBe("api.staging.acme.dev · staging token");
    expect(line2().querySelector(".mono")?.textContent).toBe(
      "api.staging.acme.dev",
    );
  });

  it("disabled: off-switch with the state in its name, no caution anywhere", () => {
    const { row, toggle } = mount({ rule: rule({ enabled: false }) });
    expect(row.classList.contains("off")).toBe(true);
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(toggle().getAttribute("aria-label")).toBe("Rule off: authorization");
    expect(row.querySelector(".rule-status")).toBeNull();
  });

  it("blocked: held toggle, caution state, host, and row-level Grant", () => {
    const { row, line2, toggle, onGrant } = mount({
      missingHosts: ["app.acme.dev", "api.acme.dev"],
    });
    expect(row.classList.contains("blocked")).toBe(true);
    expect(toggle().closest(".rule-row")?.classList.contains("blocked")).toBe(
      true,
    );
    expect(toggle().classList.contains("sw-blocked")).toBe(true);
    expect(line2().querySelector("svg")).not.toBeNull();
    expect(line2().textContent).toContain("Needs access · app.acme.dev +1");
    expect(row.getAttribute("aria-description")).toContain("needs access");
    const grant = line2().querySelector(".rule-grant") as HTMLButtonElement;
    fire(() => grant.click());
    expect(onGrant).toHaveBeenCalledOnce();
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
      " Invalid regex. Edit the scope to enable",
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

  it("renders the value as a single-line Truncate that focus never reflows", () => {
    const { row } = mount();
    const value = row.querySelector(".rule-value") as HTMLElement;
    expect(value.classList.contains("truncate")).toBe(true);
    // The old focus-reveal escape hatch is gone: no hidden full-value clone
    // that focus could swap in and wrap the row taller.
    expect(row.querySelector(".mt-full")).toBeNull();
    const before = row.querySelectorAll(".rule-line1 *").length;
    fire(() => row.focus());
    expect(row.querySelectorAll(".rule-line1 *").length).toBe(before);
    expect(
      row.querySelector(".rule-value")?.classList.contains("truncate"),
    ).toBe(true);
  });

  it("middle-truncates a long header name with the shared limit", () => {
    const { row } = mount({
      rule: rule({ header: "x-corp-internal-request-tracing-identifier" }),
    });
    const name = row.querySelector(".rule-name") as HTMLElement;
    expect(name.classList.contains("truncate-end")).toBe(false);
    expect(name.textContent).toContain("…");
    // The full name stays reachable in title while the display is compact.
    expect(name.getAttribute("title")).toBe(
      "x-corp-internal-request-tracing-identifier",
    );
  });

  it("exposes position while keeping credential values redacted", () => {
    const { row } = mount();
    expect(row.getAttribute("aria-posinset")).toBe("3");
    expect(row.getAttribute("aria-setsize")).toBe("12");
    expect(row.getAttribute("aria-description")).toBe(
      "authorization: Bearer …redacted",
    );
    expect(row.textContent).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(row.querySelector(".rule-value")?.getAttribute("title")).toBe(
      "Bearer …redacted",
    );
  });

  it("opens from the readout while toggle, menu, and Grant stay separate", () => {
    const { row, toggle, menuButton, onEdit, onToggle, onGrant } = mount({
      missingHosts: ["api.acme.dev"],
    });
    fire(() => row.querySelector<HTMLElement>(".rule-lines")?.click());
    expect(onEdit).toHaveBeenCalledOnce();

    fire(() => toggle().click());
    fire(() => menuButton().click());
    fire(() => row.querySelector<HTMLButtonElement>(".rule-grant")?.click());
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onGrant).toHaveBeenCalledOnce();
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

  it("appears on a subresource-scoped rule with no named initiator", () => {
    const { line2 } = mount({
      rule: rule({ initiators: [], resourceTypes: ["xhr"] }),
    });
    expect(line2().textContent).toContain(note);
  });

  // A default all-types rule includes top-level navigation, so its requests
  // are the direct navigation the user made and need no standing caveat.
  it("stays quiet on a default all-types (direct-navigation) rule", () => {
    const { line2 } = mount({ rule: rule({ initiators: [] }) });
    expect(line2().textContent).not.toContain(note);
  });

  it("never appears on a Pages-only rule", () => {
    const { line2 } = mount({
      rule: rule({ initiators: [], resourceTypes: ["pages"] }),
    });
    expect(line2().textContent).not.toContain(note);
  });

  it("stays quiet with named initiators or an all-sites scope", () => {
    const named = mount({
      rule: rule({ initiators: ["app.acme.dev"], resourceTypes: ["xhr"] }),
    });
    expect(named.line2().textContent).not.toContain(note);
    const all = mount({
      rule: rule({
        initiators: [],
        scope: { type: "all" },
        resourceTypes: ["xhr"],
      }),
    });
    expect(all.line2().textContent).not.toContain(note);
  });
});

describe("RuleRow overflow menu", () => {
  it("opens from the ⋯ button with the base actions", () => {
    const { root, menuButton, menuLabels } = mount();
    expect(menuButton().getAttribute("aria-haspopup")).toBe("menu");
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
    fire(() => menuButton().click());
    expect(menuButton().getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector('[role="menu"]')?.getAttribute("popover")).toBe(
      "manual",
    );
    expect(menuLabels()).toEqual([
      "Edit",
      "Copy value",
      "Duplicate",
      "Move to profile ▸",
      "Delete",
    ]);
  });

  it("copies the full value from the menu and drops Copy value when there is none", () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      const { menuButton, root } = mount();
      fire(() => menuButton().click());
      const copyItem = [...root.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent === "Copy value",
      ) as HTMLButtonElement;
      fire(() => copyItem.click());
      expect(writeText).toHaveBeenCalledWith(rule().value);

      const { value: _, ...removeRule } = rule({ operation: "remove" });
      const removed = mount({ rule: removeRule });
      fire(() => removed.menuButton().click());
      expect(removed.menuLabels()).not.toContain("Copy value");
    } finally {
      vi.unstubAllGlobals();
    }
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

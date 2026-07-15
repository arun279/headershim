// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { copy } from "../copy";
import { fire, press, render, typeInto } from "../test/render";
import { GrantPanel, type GrantPanelProps } from "./GrantPanel";

function mount(props: Partial<GrantPanelProps> = {}) {
  const onAllow = vi.fn();
  const onRequestGrant = vi.fn(async () => true);
  const onGrantLater = vi.fn();
  const onDiscardRule = vi.fn();
  const onAllSites = vi.fn();
  const root = render(
    <GrantPanel
      scopeType="domains"
      targetHosts={["api.example.com"]}
      editableTargets={false}
      targetPrefill={[]}
      initiator={{ kind: "none" }}
      created
      onRequestGrant={onRequestGrant}
      onAllow={onAllow}
      onGrantLater={onGrantLater}
      onDiscardRule={onDiscardRule}
      onAllSites={onAllSites}
      {...props}
    />,
  );
  return {
    root,
    onAllow,
    onRequestGrant,
    onGrantLater,
    onDiscardRule,
    onAllSites,
    allow: () =>
      [...root.querySelectorAll("button")].find((button) =>
        button.textContent?.startsWith("Allow on"),
      ) as HTMLButtonElement,
    grantLater: () =>
      [...root.querySelectorAll("button")].find(
        (button) => button.textContent === copy.actions.grantLater,
      ) as HTMLButtonElement,
    input: (label: string) =>
      root.querySelector(`[aria-label="${label}"]`) as HTMLInputElement,
  };
}

function expectAllow(
  ctx: ReturnType<typeof mount>,
  selection: { targetHosts: string[]; initiators: string[] },
) {
  fire(() => ctx.allow().click());
  expect(ctx.onAllow).toHaveBeenCalledOnce();
  expect(ctx.onAllow.mock.calls[0]?.[0]).toEqual(selection);
}

describe("GrantPanel — single and multiple domains", () => {
  it("names one site and returns it verbatim on allow", () => {
    const ctx = mount();
    expect(ctx.root.textContent).toContain(
      copy.grantPanel.single("api.example.com"),
    );
    expect(ctx.allow().textContent).toBe(
      copy.actions.allowOn("api.example.com"),
    );
    expectAllow(ctx, {
      targetHosts: ["api.example.com"],
      initiators: [],
    });
  });

  it("lists every named site and counts them on the button", () => {
    const ctx = mount({
      targetHosts: ["api.example.com", "auth.example.com", "cdn.example.com"],
    });
    expect(ctx.root.textContent).toContain(copy.grantPanel.multiple(3));
    const hosts = [...ctx.root.querySelectorAll(".grant-hosts .mono")].map(
      (node) => node.textContent,
    );
    expect(hosts).toEqual([
      "api.example.com",
      "auth.example.com",
      "cdn.example.com",
    ]);
    expect(ctx.allow().textContent).toBe(copy.actions.allowOn("3 sites"));
  });

  it("routes Grant later back to the caller without a grant", () => {
    const ctx = mount();
    fire(() => ctx.grantLater().click());
    expect(ctx.onGrantLater).toHaveBeenCalledOnce();
    expect(ctx.onAllow).not.toHaveBeenCalled();
    expect(ctx.onRequestGrant).not.toHaveBeenCalled();
  });

  it("shows the labeled step and all three choices", () => {
    const ctx = mount();
    expect(ctx.root.textContent).toContain(copy.grantPanel.createdLead);
    expect(ctx.root.textContent).toContain(copy.grantPanel.heading);
    expect(
      [...ctx.root.querySelectorAll(".grant-actions button")].map(
        (button) => button.textContent,
      ),
    ).toEqual([
      copy.actions.discardRule,
      copy.actions.grantLater,
      copy.actions.allowOn("api.example.com"),
    ]);
  });

  it("requests access before handing the click outcome to the caller", () => {
    const order: string[] = [];
    const ctx = mount({
      onRequestGrant: vi.fn(async () => {
        order.push("request");
        return true;
      }),
      onAllow: vi.fn(() => order.push("allow")),
    });
    fire(() => ctx.allow().click());
    expect(order).toEqual(["request", "allow"]);
  });
});

describe("GrantPanel — pre-checked initiator line", () => {
  it("includes the tab origin by default and drops it when unchecked", () => {
    const ctx = mount({
      initiator: {
        kind: "checkbox",
        host: "app.example.com",
        target: "api.example.com",
      },
    });
    const checkbox = ctx.root.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(ctx.root.textContent).toContain("the site you're on");
    // Two distinct sites (target + initiator) → counted button.
    expect(ctx.allow().textContent).toBe(copy.actions.allowOn("2 sites"));

    fire(() => {
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(ctx.allow().textContent).toBe(
      copy.actions.allowOn("api.example.com"),
    );
    expectAllow(ctx, {
      targetHosts: ["api.example.com"],
      initiators: [],
    });
  });
});

describe("GrantPanel — pattern/regex two-chip variant", () => {
  it("collects target and initiator hosts as separate labeled inputs", () => {
    const ctx = mount({
      scopeType: "pattern",
      targetHosts: [],
      editableTargets: true,
      targetPrefill: ["api.acme.dev"],
      initiator: { kind: "chips", prefill: ["app.acme.dev"] },
    });
    expect(ctx.root.textContent).toContain(copy.grantPanel.patternIntro);
    expect(ctx.root.textContent).toContain(copy.grantPanel.targetsQuestion);
    expect(ctx.root.textContent).toContain(copy.grantPanel.initiatorsQuestion);
    expect(ctx.root.textContent).toContain(copy.grantPanel.patternEffect);

    const targetInput = ctx.input(copy.grantPanel.targetInputLabel);
    typeInto(targetInput, "cdn.acme.dev");
    press(targetInput, "Enter");

    expectAllow(ctx, {
      targetHosts: ["api.acme.dev", "cdn.acme.dev"],
      initiators: ["app.acme.dev"],
    });
  });

  it("moves focus to a surviving chip control when a middle target chip is removed", () => {
    const ctx = mount({
      scopeType: "pattern",
      targetHosts: [],
      editableTargets: true,
      targetPrefill: ["a.acme.dev", "b.acme.dev", "c.acme.dev"],
      initiator: { kind: "none" },
    });
    const xs = [
      ...ctx.root.querySelectorAll(".grant-chip-x"),
    ] as HTMLButtonElement[];
    fire(() => xs[1]?.click());

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      copy.grantPanel.removeSite("c.acme.dev"),
    );
  });

  it("offers the buried all-sites escape hatch", () => {
    const ctx = mount({
      scopeType: "regex",
      targetHosts: [],
      editableTargets: true,
      targetPrefill: [],
      initiator: { kind: "none" },
    });
    const link = [...ctx.root.querySelectorAll("button")].find(
      (button) => button.textContent === copy.grantPanel.allSitesLink,
    ) as HTMLButtonElement;
    fire(() => link.click());
    expect(ctx.onAllSites).toHaveBeenCalledOnce();
    // With nothing named yet, the grant button can't fire.
    expect(ctx.allow().disabled).toBe(true);
  });
});

describe("GrantPanel — no-context initiator input", () => {
  it("shows the explicit optional pages input when no origin was inferred", () => {
    const ctx = mount({
      initiator: { kind: "chips", prefill: [] },
    });
    expect(ctx.root.textContent).toContain(copy.grantPanel.noContextInitiators);
    const input = ctx.input(copy.grantPanel.initiatorInputLabel);
    typeInto(input, "portal.example.com");
    press(input, "Enter");
    expectAllow(ctx, {
      targetHosts: ["api.example.com"],
      initiators: ["portal.example.com"],
    });
  });
});

// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { GrantSnapshot } from "../../core/grants";
import type { Rule, RuleDraft } from "../../core/model";
import { err, ok, type Result } from "../../core/result";
import { copy } from "../copy";
import type { MutationError } from "../state/mutations";
import { fire, press, render, settle, typeInto } from "../test/render";
import { RuleEditor } from "./RuleEditor";

const rule = (overrides: Partial<Rule> = {}): Rule => ({
  id: "r1",
  num: 7,
  direction: "request",
  operation: "set",
  header: "authorization",
  value: "Bearer staging",
  scope: { type: "domains", domains: ["api.acme.dev"] },
  resourceTypes: "all",
  initiators: [],
  enabled: true,
  ...overrides,
});

const GRANTED_ALL: GrantSnapshot = { origins: [], allSites: true };

function mount(
  props: Partial<Parameters<typeof RuleEditor>[0]> = {},
  saveOutcome: { ok: true } | { error: MutationError } = { ok: true },
) {
  const onSave = vi.fn(async (_ruleId: string | undefined, draft: RuleDraft) =>
    "error" in saveOutcome ? err(saveOutcome.error) : ok(rule(draft)),
  );
  const onRequestGrant = vi.fn(async () => true);
  const onGranted = vi.fn();
  const onCommitted = vi.fn();
  const onGrantStep = vi.fn();
  const onDiscardRule = vi.fn(async () => undefined);
  const onClose = vi.fn();
  const root = render(
    <RuleEditor
      profileName="Default"
      prefillDomain="api.example.com"
      // Default to an all-sites grant so the commit-model tests exercise the
      // plain close path; grant-panel tests pass an explicit narrow snapshot.
      grants={GRANTED_ALL}
      onSave={onSave}
      onRequestGrant={onRequestGrant}
      onGranted={onGranted}
      onCommitted={onCommitted}
      onGrantStep={onGrantStep}
      onDiscardRule={onDiscardRule}
      onClose={onClose}
      {...props}
    />,
  );
  return {
    root,
    onSave,
    onRequestGrant,
    onGranted,
    onCommitted,
    onGrantStep,
    onDiscardRule,
    onClose,
    editor: root.querySelector(".rule-editor") as HTMLElement,
    nameInput: () =>
      root.querySelector('[role="combobox"]') as HTMLInputElement,
    valueInput: () =>
      root.querySelector(".value-row textarea") as HTMLTextAreaElement,
    chipInput: () =>
      root.querySelector(".domain-chip-input") as HTMLInputElement,
    select: () => root.querySelector("select") as HTMLSelectElement,
    grantPanel: () => root.querySelector(".grant-panel"),
    allowButton: () =>
      [...root.querySelectorAll(".grant-panel button")].find((button) =>
        button.textContent?.startsWith("Allow on"),
      ) as HTMLButtonElement,
    grantLaterButton: () =>
      [...root.querySelectorAll(".grant-panel button")].find(
        (button) => button.textContent === copy.actions.grantLater,
      ) as HTMLButtonElement,
    discardRuleButton: () =>
      [...root.querySelectorAll(".grant-panel button")].find(
        (button) => button.textContent === copy.actions.discardRule,
      ) as HTMLButtonElement,
    saveButton: () =>
      [...root.querySelectorAll(".editor-actions button")].find(
        (button) =>
          button.textContent === copy.actions.createRule ||
          button.textContent === copy.actions.saveChanges,
      ) as HTMLButtonElement,
    errors: () =>
      [...root.querySelectorAll(".editor-error")].map(
        (node) => node.textContent,
      ),
  };
}

const NARROW: GrantSnapshot = { origins: [], allSites: false };

function pressCtrlEnter(target: HTMLElement) {
  fire(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function setOperation(select: HTMLSelectElement, operation: string) {
  fire(() => {
    select.value = operation;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function discardDirtyDraft(ctx: ReturnType<typeof mount>) {
  const discard = [...ctx.root.querySelectorAll(".editor-actions button")].find(
    (button) => button.textContent === copy.editor.discardConfirm.discard,
  ) as HTMLButtonElement;
  fire(() => discard.click());
}

async function fillAndCommit(
  ctx: ReturnType<typeof mount>,
  header = "x-custom",
) {
  typeInto(ctx.nameInput(), header);
  typeInto(ctx.valueInput(), "v1");
  press(ctx.nameInput(), "Enter");
  await settle();
}

describe("RuleEditor commit model", () => {
  it("renders the new-rule sheet with an explicit Create rule action", () => {
    const { root } = mount();
    expect(root.querySelector(".sheet-head")?.textContent).toContain(
      "‹ New rule · Default",
    );
    expect(root.querySelector(".editor-actions")?.textContent).toContain(
      copy.actions.createRule,
    );
  });

  it("lands focus in the header field the moment it opens", () => {
    // Opening the editor must take focus in the same commit that mounts it: the
    // row it replaces drops focus to <body>, and a key pressed before focus
    // settles reaches neither the editor nor the popup-root handler (both sit
    // under <main>), so Esc would be silently dropped.
    const ctx = mount();
    expect(document.activeElement).toBe(ctx.nameInput());
    expect(ctx.root.textContent).toContain(copy.editor.domainSuggestion);
  });

  it("commits on Enter with the draft as typed and closes", async () => {
    const ctx = mount();
    await fillAndCommit(ctx, "X-Custom");
    expect(ctx.onSave).toHaveBeenCalledExactlyOnceWith(undefined, {
      direction: "request",
      operation: "set",
      header: "X-Custom",
      value: "v1",
      scope: { type: "domains", domains: ["api.example.com"] },
      resourceTypes: "all",
      initiators: [],
      enabled: true,
    });
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("closes a clean draft on Esc without saving", () => {
    const ctx = mount();
    press(ctx.nameInput(), "Escape");
    expect(ctx.onSave).not.toHaveBeenCalled();
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("guards a dirty Esc until the user explicitly discards", () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "x-custom");
    press(ctx.nameInput(), "Escape");
    expect(ctx.root.textContent).toContain(copy.editor.discardConfirm.title);
    expect(ctx.onClose).not.toHaveBeenCalled();

    const keep = [...ctx.root.querySelectorAll(".editor-actions button")].find(
      (button) => button.textContent === copy.editor.discardConfirm.keepEditing,
    ) as HTMLButtonElement;
    fire(() => keep.click());
    expect(ctx.root.textContent).not.toContain(
      copy.editor.discardConfirm.title,
    );

    press(ctx.nameInput(), "Escape");
    discardDirtyDraft(ctx);
    expect(ctx.onSave).not.toHaveBeenCalled();
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("Esc during an in-flight save waits for the outcome instead of pretending to revert", async () => {
    let release: (outcome: Result<Rule, MutationError>) => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<Result<Rule, MutationError>>((resolve) => {
          release = resolve;
        }),
    );
    const ctx = mount({ onSave });
    typeInto(ctx.nameInput(), "x-custom");
    typeInto(ctx.valueInput(), "v1");
    press(ctx.nameInput(), "Enter");
    press(ctx.nameInput(), "Escape");
    expect(ctx.onClose).not.toHaveBeenCalled();
    fire(() => release(ok(rule())));
    await settle();
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("Esc closes the suggestion list first, the editor second", () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "auth");
    expect(ctx.root.querySelector('[role="listbox"]')).not.toBeNull();
    press(ctx.nameInput(), "Escape");
    expect(ctx.root.querySelector('[role="listbox"]')).toBeNull();
    expect(ctx.onClose).not.toHaveBeenCalled();
    press(ctx.nameInput(), "Escape");
    expect(ctx.root.textContent).toContain(copy.editor.discardConfirm.title);
    discardDirtyDraft(ctx);
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("does nothing when focus leaves a dirty editor", async () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "x-custom");
    typeInto(ctx.valueInput(), "v1");
    fire(() => {
      ctx.editor.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    await settle();
    expect(ctx.onSave).not.toHaveBeenCalled();
    expect(ctx.onClose).not.toHaveBeenCalled();
  });

  it("does nothing when focus leaves an untouched editor", () => {
    const ctx = mount();
    fire(() => {
      ctx.editor.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(ctx.onSave).not.toHaveBeenCalled();
    expect(ctx.onClose).not.toHaveBeenCalled();
  });

  it("blocks an empty commit with the required-field copy, unsaved", async () => {
    const ctx = mount({ prefillDomain: undefined });
    press(ctx.nameInput(), "Enter");
    await settle();
    expect(ctx.onSave).not.toHaveBeenCalled();
    expect(ctx.errors()).toEqual([
      copy.errors.headerNameRequired,
      copy.errors.valueRequired,
      copy.errors.scopeEmpty.domains,
    ]);
  });

  it("pre-fills an edited rule and keeps its identity fields in the draft", async () => {
    const existing = rule({
      comment: "staging token",
      initiators: ["app.example.com"],
      enabled: false,
    });
    const ctx = mount({ rule: existing });
    expect(ctx.nameInput().value).toBe("authorization");
    expect(ctx.valueInput().value).toBe("Bearer staging");
    typeInto(ctx.valueInput(), "Bearer other");
    fire(() => ctx.saveButton().click());
    await settle();
    expect(ctx.onSave).toHaveBeenCalledExactlyOnceWith(
      "r1",
      expect.objectContaining({
        value: "Bearer other",
        comment: "staging token",
        initiators: ["app.example.com"],
        enabled: false,
      }),
    );
    expect(ctx.onCommitted).toHaveBeenCalledExactlyOnceWith("edit");
  });

  it("does not commit on Enter in the multiline value field", async () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "x-custom");
    typeInto(ctx.valueInput(), "v1");
    press(ctx.valueInput(), "Enter");
    await settle();
    expect(ctx.onSave).not.toHaveBeenCalled();
  });

  it("adds a typed domain on Enter and commits only on the next empty Enter", async () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "x-custom");
    typeInto(ctx.valueInput(), "v1");
    typeInto(ctx.chipInput(), "cdn.example.com");

    press(ctx.chipInput(), "Enter");
    await settle();
    expect(ctx.onSave).not.toHaveBeenCalled();
    expect(ctx.root.textContent).toContain("cdn.example.com");

    press(ctx.chipInput(), "Enter");
    await settle();
    expect(ctx.onSave).toHaveBeenCalledExactlyOnceWith(
      undefined,
      expect.objectContaining({
        scope: {
          type: "domains",
          domains: ["api.example.com", "cdn.example.com"],
        },
      }),
    );
  });

  it("commits from the single-line Comment field", async () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "x-custom");
    typeInto(ctx.valueInput(), "v1");
    const commentToggle = [...ctx.root.querySelectorAll(".disclosure")].find(
      (button) => button.textContent?.includes(copy.editor.labels.comment),
    ) as HTMLButtonElement;
    fire(() => commentToggle.click());
    const comment = ctx.root.querySelector(
      '.editor-option input[type="text"]',
    ) as HTMLInputElement;
    typeInto(comment, "staging token");

    press(comment, "Enter");
    await settle();

    expect(ctx.onSave).toHaveBeenCalledExactlyOnceWith(
      undefined,
      expect.objectContaining({ comment: "staging token" }),
    );
  });

  it("auto-expands non-default resource types on an existing rule", () => {
    const ctx = mount({ rule: rule({ resourceTypes: ["xhr", "scripts"] }) });
    const disclosure = [...ctx.root.querySelectorAll(".disclosure")].find(
      (button) => button.textContent?.includes("Resource types"),
    );
    expect(disclosure?.textContent).toContain(
      "Resource types · XHR/fetch, Scripts",
    );
    expect(disclosure?.getAttribute("aria-expanded")).toBe("true");
    expect(ctx.root.querySelector(".rt-grid")).not.toBeNull();
  });
});

describe("RuleEditor blocking errors (exact copy, input preserved)", () => {
  it("renders the pseudo-header copy under the name field", async () => {
    const ctx = mount(
      {},
      {
        error: {
          kind: "name-not-modifiable",
          copyId: "header-not-modifiable",
        },
      },
    );
    await fillAndCommit(ctx, ":authority");
    expect(ctx.onClose).not.toHaveBeenCalled();
    expect(ctx.nameInput().value).toBe(":authority");
    const field = ctx.nameInput().closest(".editor-field");
    expect(field?.textContent).toContain(copy.errors.headerNotModifiable);
  });

  it("renders the append-allowlist copy under the operation control", async () => {
    const ctx = mount(
      {},
      {
        error: {
          kind: "request-append-not-allowed",
          copyId: "request-append-not-allowed",
          header: "x-custom-token",
        },
      },
    );
    setOperation(ctx.select(), "append");
    await fillAndCommit(ctx, "x-custom-token");
    expect(ctx.nameInput().value).toBe("x-custom-token");
    const field = ctx.select().closest(".editor-primary-field");
    expect(field?.textContent).toContain(
      copy.errors.appendDisallowed("x-custom-token"),
    );
  });

  it.each([
    ["syntaxError", copy.errors.regexInvalid],
    ["memoryLimitExceeded", copy.errors.regexOversize],
  ])("renders the regex copy for %s under the scope field", async (reason, message) => {
    const ctx = mount(
      {},
      { error: { kind: "regex-invalid", regex: "(a|b", reason } },
    );
    const regexRadio = [...ctx.root.querySelectorAll(".segments input")].at(
      2,
    ) as HTMLInputElement;
    fire(() => regexRadio.click());
    const regexInput = ctx.root.querySelector(
      '[aria-label="Regex"]',
    ) as HTMLInputElement;
    typeInto(regexInput, "(a|b");
    await fillAndCommit(ctx);
    expect(ctx.errors()).toContain(message);
    expect(
      (ctx.root.querySelector('[aria-label="Regex"]') as HTMLInputElement)
        .value,
    ).toBe("(a|b");
  });

  it.each([
    [
      { kind: "enabled-rule-limit-exceeded", count: 4501, limit: 4500 },
      copy.errors.ruleCap,
    ],
    [
      { kind: "regex-rule-limit-exceeded", count: 1001, limit: 1000 },
      copy.errors.regexRuleCap,
    ],
    [
      { kind: "doc-byte-limit-exceeded", bytes: 1, limit: 4194304 },
      copy.errors.storageBudget,
    ],
  ] as const)("renders cap and budget errors at editor level", async (error, message) => {
    const ctx = mount({}, { error: error as MutationError });
    await fillAndCommit(ctx);
    expect(ctx.onClose).not.toHaveBeenCalled();
    expect(ctx.errors()).toContain(message);
    expect(ctx.nameInput().value).toBe("x-custom");
  });
});

describe("RuleEditor advisories and value field", () => {
  it("pins the caution advisory directly above the save bar", () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "te");
    const advisory = ctx.root.querySelector(".advisory-slot");
    expect(advisory?.textContent).toContain(copy.editor.caution);
    expect(advisory?.textContent).toContain(copy.advisories.managedHeader);
    expect(advisory?.parentElement?.classList.contains("sheet-pinned")).toBe(
      true,
    );
  });

  it("hides the value field for remove", () => {
    const ctx = mount();
    expect(ctx.root.querySelector(".value-row")).not.toBeNull();
    setOperation(ctx.select(), "remove");
    expect(ctx.root.querySelector(".value-row")).toBeNull();
  });

  it("inserts a generated UUID literal with the frozen note, regenerates, and clears on hand edit", () => {
    const ctx = mount();
    const insert = ctx.root.querySelector(".insert-btn") as HTMLButtonElement;
    fire(() => insert.click());
    const uuidItem = [...ctx.root.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === copy.editor.insertUuid,
    ) as HTMLButtonElement;
    fire(() => uuidItem.click());
    const first = ctx.valueInput().value;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx.root.textContent).toContain(copy.generatedValue.note);

    const regenerate = ctx.root.querySelector(
      ".editor-micro .link-btn",
    ) as HTMLButtonElement;
    expect(regenerate.textContent).toBe(copy.actions.regenerate);
    fire(() => regenerate.click());
    expect(ctx.valueInput().value).not.toBe(first);

    typeInto(ctx.valueInput(), "hand-edited");
    expect(ctx.root.textContent).not.toContain(copy.generatedValue.note);
  });

  it("shows the freeze time for a saved generated value", () => {
    const ctx = mount({
      rule: rule({
        value: "5cb4",
        generated: { kind: "uuid", at: "2026-07-12T14:03:27.000Z" },
      }),
    });
    expect(ctx.root.textContent).toContain(
      copy.generatedValue.frozen("2026-07-12 14:03 UTC"),
    );
    expect(ctx.root.querySelector(".editor-micro .link-btn")?.textContent).toBe(
      copy.actions.regenerate,
    );
  });
});

describe("RuleEditor grant moment", () => {
  it("opens the grant panel naming the site when it isn't granted, instead of closing", async () => {
    const ctx = mount({ grants: NARROW, prefillDomain: "api.example.com" });
    await fillAndCommit(ctx, "authorization");
    expect(ctx.onClose).not.toHaveBeenCalled();
    expect(ctx.grantPanel()?.textContent).toContain(
      copy.grantPanel.single("api.example.com"),
    );
    expect(ctx.grantPanel()?.textContent).toContain(copy.grantPanel.heading);
    expect(ctx.grantPanel()?.textContent).toContain(
      copy.grantPanel.createdLead,
    );
    expect(ctx.onCommitted).not.toHaveBeenCalled();
    expect(ctx.onGrantStep).toHaveBeenCalledOnce();
  });

  it("pre-checks the tab origin only when it differs from the target and the rule reaches subresources", async () => {
    const differs = mount({
      grants: NARROW,
      prefillDomain: "api.example.com",
      tabDomain: "app.example.com",
    });
    await fillAndCommit(differs, "authorization");
    expect(
      differs.root.querySelector('.grant-panel input[type="checkbox"]'),
    ).not.toBeNull();

    const sameOrigin = mount({
      grants: NARROW,
      prefillDomain: "api.example.com",
      tabDomain: "api.example.com",
    });
    await fillAndCommit(sameOrigin, "authorization");
    expect(
      sameOrigin.root.querySelector('.grant-panel input[type="checkbox"]'),
    ).toBeNull();
  });

  it("shows no initiator line for a Pages-only rule (no subresource reach)", async () => {
    const ctx = mount({
      grants: NARROW,
      tabDomain: "app.example.com",
      rule: rule({
        scope: { type: "domains", domains: ["api.example.com"] },
        resourceTypes: ["pages"],
      }),
    });
    typeInto(ctx.valueInput(), "Bearer next");
    fire(() => ctx.saveButton().click());
    await settle();
    expect(ctx.grantPanel()).not.toBeNull();
    expect(
      ctx.root.querySelector('.grant-panel input[type="checkbox"]'),
    ).toBeNull();
    expect(ctx.root.querySelector(".grant-panel .grant-field")).toBeNull();
  });

  it("fires one in-gesture prompt for target and initiator, reports it, and closes on allow", async () => {
    const ctx = mount({
      grants: NARROW,
      prefillDomain: "api.example.com",
      tabDomain: "app.example.com",
    });
    await fillAndCommit(ctx, "authorization");
    fire(() => ctx.allowButton().click());
    await settle();

    expect(ctx.onRequestGrant).toHaveBeenCalledExactlyOnceWith([
      "*://*.api.example.com/*",
      "*://*.app.example.com/*",
    ]);
    // The collected initiator is persisted onto the saved rule, so a
    // later revoke can re-light the loud state.
    expect(ctx.onSave).toHaveBeenLastCalledWith(
      "r1",
      expect.objectContaining({ initiators: ["app.example.com"] }),
    );
    expect(ctx.onGranted).toHaveBeenCalledExactlyOnceWith([
      "api.example.com",
      "app.example.com",
    ]);
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("keeps the saved rule and closes on Grant later", async () => {
    const ctx = mount({ grants: NARROW, prefillDomain: "api.example.com" });
    await fillAndCommit(ctx, "authorization");
    fire(() => ctx.grantLaterButton().click());
    await settle();
    expect(ctx.onSave).toHaveBeenCalledOnce();
    expect(ctx.onRequestGrant).not.toHaveBeenCalled();
    expect(ctx.onGranted).not.toHaveBeenCalled();
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("Ctrl/Cmd+Enter saves, advances, and focuses Allow without requesting", async () => {
    const ctx = mount({
      grants: NARROW,
      prefillDomain: "api.example.com",
      tabDomain: "app.example.com",
    });
    typeInto(ctx.nameInput(), "authorization");
    typeInto(ctx.valueInput(), "Bearer one");
    pressCtrlEnter(ctx.nameInput());
    await settle();
    expect(ctx.onSave).toHaveBeenCalled();
    expect(ctx.onRequestGrant).not.toHaveBeenCalled();
    expect(ctx.onGranted).not.toHaveBeenCalled();
    expect(ctx.onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ctx.allowButton());
  });

  it("offers Discard rule after saving and deletes that saved identity", async () => {
    const ctx = mount({ grants: NARROW, prefillDomain: "api.example.com" });
    await fillAndCommit(ctx, "authorization");
    fire(() => ctx.discardRuleButton().click());
    await settle();
    expect(ctx.onDiscardRule).toHaveBeenCalledExactlyOnceWith("r1");
    expect(ctx.onRequestGrant).not.toHaveBeenCalled();
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("persists collected pattern hosts onto scope.hosts on allow", async () => {
    const ctx = mount({
      grants: NARROW,
      tabDomain: "app.acme.dev",
      rule: rule({
        scope: { type: "pattern", pattern: "||acme.dev^", hosts: [] },
      }),
    });
    typeInto(ctx.valueInput(), "Bearer next");
    fire(() => ctx.saveButton().click());
    await settle();

    const targetInput = ctx.root.querySelector(
      `.grant-panel [aria-label="${copy.grantPanel.targetInputLabel}"]`,
    ) as HTMLInputElement;
    typeInto(targetInput, "api.acme.dev");
    press(targetInput, "Enter");
    fire(() => ctx.allowButton().click());
    await settle();

    expect(ctx.onSave).toHaveBeenLastCalledWith(
      "r1",
      expect.objectContaining({
        scope: expect.objectContaining({
          type: "pattern",
          hosts: expect.arrayContaining(["api.acme.dev"]),
        }),
      }),
    );
    expect(ctx.onGranted).toHaveBeenCalledOnce();
  });

  it("stays out of the way when the site is already granted", async () => {
    const granted: GrantSnapshot = {
      origins: ["*://*.api.example.com/*"],
      allSites: false,
    };
    const ctx = mount({ grants: granted, prefillDomain: "api.example.com" });
    await fillAndCommit(ctx, "authorization");
    expect(ctx.grantPanel()).toBeNull();
    expect(ctx.onClose).toHaveBeenCalledOnce();
    expect(ctx.onRequestGrant).not.toHaveBeenCalled();
  });

  it("still offers the initiator when the target is granted but the tab page isn't", async () => {
    // A cross-host subresource rule needs the calling page granted too; the
    // target being granted already can't stand in for it, so the panel opens.
    const granted: GrantSnapshot = {
      origins: ["*://*.api.example.com/*"],
      allSites: false,
    };
    const ctx = mount({
      grants: granted,
      prefillDomain: "api.example.com",
      tabDomain: "app.example.com",
    });
    await fillAndCommit(ctx, "authorization");
    expect(ctx.onClose).not.toHaveBeenCalled();
    expect(
      ctx.root.querySelector('.grant-panel input[type="checkbox"]'),
    ).not.toBeNull();
  });
});

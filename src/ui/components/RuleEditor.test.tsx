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
  const onGrantDeclined = vi.fn();
  const onCommitted = vi.fn();
  const onClose = vi.fn();
  const root = render(
    <RuleEditor
      profileName="Default"
      prefillDomain="api.example.com"
      // Default to an all-sites grant so the commit-model tests exercise the
      // plain close path; grant-commit tests pass an explicit narrow snapshot.
      grants={GRANTED_ALL}
      onSave={onSave}
      onRequestGrant={onRequestGrant}
      onGranted={onGranted}
      onGrantDeclined={onGrantDeclined}
      onCommitted={onCommitted}
      onClose={onClose}
      {...props}
    />,
  );
  return {
    root,
    onSave,
    onRequestGrant,
    onGranted,
    onGrantDeclined,
    onCommitted,
    onClose,
    editor: root.querySelector(".rule-editor") as HTMLElement,
    nameInput: () =>
      root.querySelector('[role="combobox"]') as HTMLInputElement,
    valueInput: () =>
      root.querySelector(".value-row textarea") as HTMLTextAreaElement,
    chipInput: () =>
      root.querySelector(".domain-chip-input") as HTMLInputElement,
    operationInput: (operation: string) =>
      root.querySelector(
        `.operation-segments input[value="${operation}"]`,
      ) as HTMLInputElement,
    saveButton: () =>
      root.querySelector(".editor-actions .primary") as HTMLButtonElement,
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

function setOperation(input: HTMLInputElement) {
  fire(() => {
    input.click();
  });
}

async function pressEnterThenSave(
  ctx: ReturnType<typeof mount>,
  target: HTMLElement,
) {
  press(target, "Enter");
  await settle();
  expect(ctx.onSave).not.toHaveBeenCalled();

  fire(() => ctx.saveButton().click());
  await settle();
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
  fire(() => ctx.saveButton().click());
  await settle();
}

function openGeneratedValue(ctx: ReturnType<typeof mount>): void {
  const disclosure = [...ctx.root.querySelectorAll(".disclosure")].find(
    (button) => button.textContent?.includes(copy.editor.labels.generatedValue),
  ) as HTMLButtonElement;
  fire(() => disclosure.click());
}

async function commitEditedValue(
  ctx: ReturnType<typeof mount>,
  value = "Bearer next",
): Promise<void> {
  typeInto(ctx.valueInput(), value);
  fire(() => ctx.saveButton().click());
  await settle();
}

function mountPageRule(
  scope: Rule["scope"],
  props: Partial<Parameters<typeof RuleEditor>[0]> = {},
) {
  return mount({
    grants: NARROW,
    rule: rule({ scope, resourceTypes: ["pages"] }),
    ...props,
  });
}

describe("RuleEditor commit model", () => {
  it("renders the new-rule sheet with an explicit Create rule action", () => {
    const ctx = mount();
    const { root } = ctx;
    expect(
      root
        .querySelector(".editor-sheet")
        ?.classList.contains("editor-sheet-with-footer"),
    ).toBe(true);
    expect(root.querySelector(".sheet-head")?.textContent).toContain(
      "New rule · Default",
    );
    const headerExit = root.querySelector(
      `.sheet-head button[aria-label="${copy.editor.close}"]`,
    );
    expect(headerExit?.querySelector("svg")).not.toBeNull();
    expect(root.querySelector(".sheet-head")?.firstElementChild).toBe(
      headerExit,
    );
    expect(
      [...root.querySelectorAll(".editor-actions button")].filter(
        (button) => button.textContent === copy.actions.cancel,
      ),
    ).toHaveLength(1);
    expect(root.querySelector(".editor-actions")?.textContent).toContain(
      copy.actions.createRule,
    );
    expect(ctx.nameInput().placeholder).toBe(
      copy.editor.placeholders.headerName,
    );
    expect(ctx.valueInput().placeholder).toBe(copy.editor.placeholders.value);
    expect(ctx.nameInput().size).toBe(
      copy.editor.placeholders.headerName.length,
    );
  });

  it("lands focus in the header field the moment it opens", () => {
    // Opening the editor must take focus in the same commit that mounts it: the
    // row it replaces drops focus to <body>, and a key pressed before focus
    // settles reaches neither the editor nor the popup-root handler (both sit
    // under <main>), so Esc would be silently dropped.
    const ctx = mount();
    expect(document.activeElement).toBe(ctx.nameInput());
    expect(ctx.root.textContent).toContain(copy.editor.domainsHelper);
  });

  it("sizes the composed header name from its content without separating the seam", () => {
    const ctx = mount({ rule: rule() });
    const name = ctx.nameInput();
    expect(name.size).toBe("authorization".length);

    typeInto(name, "access-control-allow-origin");
    expect(name.size).toBe("access-control-allow-origin".length);
    expect(
      name.closest(".compose-name-control")?.nextElementSibling?.classList,
    ).toContain("header-seam");

    typeInto(ctx.valueInput(), "v".repeat(60));
    expect(
      (
        ctx.valueInput().closest(".compose-value-control") as HTMLElement
      ).style.getPropertyValue("--compose-value-width"),
    ).toBe("60ch");
  });

  it("commits from the explicit primary action with the draft as typed", async () => {
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
    fire(() => ctx.saveButton().click());
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
    fire(() => ctx.saveButton().click());
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

  it("adds a typed domain on Enter and waits for the explicit save action", async () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "x-custom");
    typeInto(ctx.valueInput(), "v1");
    typeInto(ctx.chipInput(), "cdn.example.com");

    press(ctx.chipInput(), "Enter");
    await settle();
    expect(ctx.onSave).not.toHaveBeenCalled();
    expect(ctx.root.textContent).toContain("cdn.example.com");

    await pressEnterThenSave(ctx, ctx.chipInput());
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

  it("keeps Comment Enter inert and commits its value from the save action", async () => {
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

    await pressEnterThenSave(ctx, comment);
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
    const operation = ctx.operationInput("append");
    setOperation(operation);
    await fillAndCommit(ctx, "x-custom-token");
    expect(ctx.nameInput().value).toBe("x-custom-token");
    const field = operation.closest(".editor-primary-field");
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
    const regexRadio = ctx.root.querySelector(
      '.segments input[value="regex"]',
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
    setOperation(ctx.operationInput("remove"));
    expect(ctx.root.querySelector(".value-row")).toBeNull();
  });

  it("inserts a generated UUID literal with the frozen note, regenerates, and clears on hand edit", () => {
    const ctx = mount();
    expect(ctx.root.querySelector(".insert-btn")).toBeNull();
    openGeneratedValue(ctx);
    const uuid = [...ctx.root.querySelectorAll("button")].find(
      (button) => button.textContent === copy.editor.insertUuid,
    ) as HTMLButtonElement;
    fire(() => uuid.click());
    const first = ctx.valueInput().value;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx.root.textContent).toContain(copy.generatedValue.note);

    fire(() => uuid.click());
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
    openGeneratedValue(ctx);
    expect(ctx.root.textContent).toContain(
      copy.generatedValue.frozen("2026-07-12 14:03 UTC"),
    );
  });
});

describe("RuleEditor grant moment", () => {
  it("folds an ungranted host into the primary action and closes after commit", async () => {
    const ctx = mount({ grants: NARROW, prefillDomain: "api.example.com" });
    expect(ctx.saveButton().textContent).toBe(
      copy.actions.createRuleAndAllow("api.example.com"),
    );
    await fillAndCommit(ctx, "authorization");
    expect(ctx.onRequestGrant).toHaveBeenCalledExactlyOnceWith([
      "*://*.api.example.com/*",
    ]);
    expect(ctx.onSave).toHaveBeenCalledOnce();
    expect(ctx.onCommitted).toHaveBeenCalledExactlyOnceWith("create");
    expect(ctx.onGranted).toHaveBeenCalledExactlyOnceWith(["api.example.com"]);
    expect(ctx.onClose).toHaveBeenCalledOnce();
    expect(ctx.root.querySelector(".grant-panel")).toBeNull();
  });

  it("includes and records a different tab origin when the rule reaches subresources", async () => {
    const differs = mount({
      grants: NARROW,
      prefillDomain: "api.example.com",
      tabDomain: "app.example.com",
    });
    await fillAndCommit(differs, "authorization");
    expect(differs.onRequestGrant).toHaveBeenCalledExactlyOnceWith([
      "*://*.api.example.com/*",
      "*://*.app.example.com/*",
    ]);
    expect(differs.onSave).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ initiators: ["app.example.com"] }),
    );

    const sameOrigin = mount({
      grants: NARROW,
      prefillDomain: "api.example.com",
      tabDomain: "api.example.com",
    });
    await fillAndCommit(sameOrigin, "authorization");
    expect(sameOrigin.onRequestGrant).toHaveBeenCalledExactlyOnceWith([
      "*://*.api.example.com/*",
    ]);
    expect(sameOrigin.onSave).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ initiators: [] }),
    );
  });

  it("does not request or record an initiator for a Pages-only rule", async () => {
    const ctx = mountPageRule(
      { type: "domains", domains: ["api.example.com"] },
      {
        tabDomain: "app.example.com",
      },
    );
    await commitEditedValue(ctx);
    expect(ctx.onRequestGrant).toHaveBeenCalledExactlyOnceWith([
      "*://*.api.example.com/*",
    ]);
    expect(ctx.onSave).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ initiators: [] }),
    );
  });

  it("requests permission only after the save succeeds", async () => {
    const order: string[] = [];
    const onRequestGrant = vi.fn(async () => {
      order.push("grant");
      return true;
    });
    const onSave = vi.fn(
      async (_ruleId: string | undefined, draft: RuleDraft) => {
        order.push("save");
        return ok(rule(draft));
      },
    );
    const ctx = mount({
      grants: NARROW,
      prefillDomain: "api.example.com",
      onRequestGrant,
      onSave,
    });
    await fillAndCommit(ctx, "authorization");

    expect(order).toEqual(["save", "grant"]);
    expect(onRequestGrant).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("does not request permission when the save fails", async () => {
    const ctx = mount(
      { grants: NARROW, prefillDomain: "api.example.com" },
      {
        error: {
          kind: "doc-byte-limit-exceeded",
          bytes: 4_194_305,
          limit: 4_194_304,
        },
      },
    );
    await fillAndCommit(ctx, "authorization");

    expect(ctx.onSave).toHaveBeenCalledOnce();
    expect(ctx.onRequestGrant).not.toHaveBeenCalled();
    expect(ctx.onCommitted).not.toHaveBeenCalled();
    expect(ctx.onClose).not.toHaveBeenCalled();
    expect(ctx.errors()).toContain(copy.errors.storageBudget);
  });

  it("folds an ungranted all-sites scope into the primary action", async () => {
    const ctx = mount({ grants: NARROW });
    const allSites = ctx.root.querySelector(
      '.segments input[value="all"]',
    ) as HTMLInputElement;
    fire(() => allSites.click());

    expect(ctx.saveButton().textContent).toBe(
      copy.actions.createRuleAndAllow(copy.scopeSummary.allSites),
    );
    await fillAndCommit(ctx, "authorization");

    expect(ctx.onSave).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ scope: { type: "all" } }),
    );
    expect(ctx.onRequestGrant).toHaveBeenCalledExactlyOnceWith(["*://*/*"]);
    expect(ctx.onGranted).toHaveBeenCalledExactlyOnceWith([
      copy.scopeSummary.allSites,
    ]);
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("keeps all-sites saves plain when broad access is already granted", () => {
    const ctx = mount({ grants: GRANTED_ALL });
    const allSites = ctx.root.querySelector(
      '.segments input[value="all"]',
    ) as HTMLInputElement;
    fire(() => allSites.click());

    expect(ctx.saveButton().textContent).toBe(copy.actions.createRule);
  });

  it("keeps a declined rule and reports its honest blocked outcome", async () => {
    const onRequestGrant = vi.fn(async () => false);
    const ctx = mount({
      grants: NARROW,
      prefillDomain: "api.example.com",
      onRequestGrant,
    });
    await fillAndCommit(ctx, "authorization");

    expect(ctx.onSave).toHaveBeenCalledOnce();
    expect(onRequestGrant).toHaveBeenCalledOnce();
    expect(ctx.onGranted).not.toHaveBeenCalled();
    expect(ctx.onGrantDeclined).toHaveBeenCalledExactlyOnceWith(
      "api.example.com",
    );
    expect(ctx.onCommitted).toHaveBeenCalledOnce();
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("Ctrl/Cmd+Enter uses the same save-and-allow commit", async () => {
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
    expect(ctx.onRequestGrant).toHaveBeenCalledOnce();
    expect(ctx.onGranted).toHaveBeenCalledOnce();
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("infers and persists an anchored pattern host before requesting it", async () => {
    const ctx = mountPageRule({
      type: "pattern",
      pattern: "||api.acme.dev^",
      hosts: [],
    });
    await commitEditedValue(ctx);

    expect(ctx.onRequestGrant).toHaveBeenCalledExactlyOnceWith([
      "*://*.api.acme.dev/*",
    ]);
    expect(ctx.onSave).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({
        scope: {
          type: "pattern",
          pattern: "||api.acme.dev^",
          hosts: ["api.acme.dev"],
        },
      }),
    );
    expect(ctx.onGranted).toHaveBeenCalledOnce();
  });

  it("infers a literal host from a common anchored regex", async () => {
    const ctx = mountPageRule({
      type: "regex",
      regex: "^https://api\\.acme\\.dev/",
      hosts: [],
    });
    await commitEditedValue(ctx);

    expect(ctx.onRequestGrant).toHaveBeenCalledExactlyOnceWith([
      "*://*.api.acme.dev/*",
    ]);
    expect(ctx.onSave).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({
        scope: expect.objectContaining({ hosts: ["api.acme.dev"] }),
      }),
    );
  });

  it.each([
    {
      type: "pattern" as const,
      scope: {
        type: "pattern" as const,
        pattern: "/api/",
        hosts: [],
      },
    },
    {
      type: "regex" as const,
      scope: {
        type: "regex" as const,
        regex: "/v[0-9]+/",
        hosts: [],
      },
    },
  ])("saves a non-inferable $type scope without claiming a grant", async ({
    scope,
  }) => {
    const ctx = mountPageRule(scope);

    expect(ctx.saveButton().textContent).toBe(copy.actions.saveChanges);
    await commitEditedValue(ctx);

    expect(ctx.onSave).toHaveBeenCalledOnce();
    expect(ctx.onRequestGrant).not.toHaveBeenCalled();
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("stays out of the way when the site is already granted", async () => {
    const granted: GrantSnapshot = {
      origins: ["*://*.api.example.com/*"],
      allSites: false,
    };
    const ctx = mount({ grants: granted, prefillDomain: "api.example.com" });
    expect(ctx.saveButton().textContent).toBe(copy.actions.createRule);
    await fillAndCommit(ctx, "authorization");
    expect(ctx.onClose).toHaveBeenCalledOnce();
    expect(ctx.onRequestGrant).not.toHaveBeenCalled();
  });

  it("requests only the missing initiator when the target is already granted", async () => {
    const granted: GrantSnapshot = {
      origins: ["*://*.api.example.com/*"],
      allSites: false,
    };
    const ctx = mount({
      grants: granted,
      prefillDomain: "api.example.com",
      tabDomain: "app.example.com",
    });
    expect(ctx.saveButton().textContent).toBe(
      copy.actions.createRuleAndAllow("app.example.com"),
    );
    await fillAndCommit(ctx, "authorization");
    expect(ctx.onRequestGrant).toHaveBeenCalledExactlyOnceWith([
      "*://*.app.example.com/*",
    ]);
    expect(ctx.onSave).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ initiators: ["app.example.com"] }),
    );
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });
});

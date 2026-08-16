// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { GrantSnapshot } from "../../core/grants";
import type { Rule, RuleDraft } from "../../core/model";
import { err, ok, type Result } from "../../core/result";
import { copy } from "../copy";
import type { MutationError } from "../state/mutations";
import {
  atPaint,
  fire,
  pasteInto,
  press,
  render,
  settle,
  typeInto,
} from "../test/render";
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
  const onSave = vi.fn(
    async (
      _ruleId: string | undefined,
      draft: RuleDraft,
      _profileId: string | undefined,
    ) => ("error" in saveOutcome ? err(saveOutcome.error) : ok(rule(draft))),
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
        `.segmented input[value="${operation}"]`,
      ) as HTMLInputElement,
    saveButton: () =>
      root.querySelector(".editor-actions .primary") as HTMLButtonElement,
    profileSelect: () =>
      root.querySelector(".editor-profile-select") as HTMLSelectElement | null,
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
  await saveDraft(ctx);
}

async function saveDraft(ctx: ReturnType<typeof mount>) {
  fire(() => ctx.saveButton().click());
  await settle();
}

function pickScope(ctx: ReturnType<typeof mount>, type: "pattern" | "regex") {
  fire(() =>
    (
      ctx.root.querySelector(
        `.segmented input[value="${type}"]`,
      ) as HTMLInputElement
    ).click(),
  );
}

async function addGrantHost(ctx: ReturnType<typeof mount>, host: string) {
  const input = ctx.root.querySelector(".grant-chip-input") as HTMLInputElement;
  typeInto(input, host);
  press(input, "Enter");
  await settle();
}

async function saveAndExpectRefused(
  ctx: ReturnType<typeof mount>,
  error: string,
) {
  await saveDraft(ctx);
  expect(ctx.onSave).not.toHaveBeenCalled();
  expect(ctx.errors()).toContain(error);
}

function expectAllSitesGranted(ctx: ReturnType<typeof mount>) {
  expect(ctx.onRequestGrant).toHaveBeenCalledExactlyOnceWith(["*://*/*"]);
  expect(ctx.onGranted).toHaveBeenCalledOnce();
  expect(ctx.onClose).toHaveBeenCalledOnce();
}

function deleteButton(
  ctx: ReturnType<typeof mount>,
): HTMLButtonElement | undefined {
  return [...ctx.root.querySelectorAll(".editor-actions button")].find(
    (button) => button.textContent === copy.editor.delete,
  ) as HTMLButtonElement | undefined;
}

function openGenerateMenu(ctx: ReturnType<typeof mount>): void {
  fire(() =>
    (ctx.root.querySelector(".generate-btn") as HTMLButtonElement).click(),
  );
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
      copy.editor.placeholders.headerName.request,
    );
    // The value field carries no example: what a value looks like is decided by
    // the header named above it, so one header's example is wrong on the rest.
    expect(ctx.valueInput().placeholder).toBe("");
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

  it("hands focus to the first rejected field when a submit is refused", async () => {
    // The rejection is useless while focus sits on the button that raised it:
    // whoever cannot see the errors has to hunt for what to fix. A real click
    // focuses the button it lands on, so start focus where the browser leaves it.
    const ctx = mount();
    ctx.saveButton().focus();
    fire(() => ctx.saveButton().click());
    await settle();

    expect(ctx.errors()).toContain(copy.errors.headerNameRequired);
    expect(ctx.errors()).toContain(copy.errors.valueRequired);
    expect(document.activeElement).toBe(ctx.nameInput());
  });

  it("skips a valid field to focus the one that was actually rejected", async () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "x-custom");
    fire(() => ctx.saveButton().click());
    await settle();

    expect(ctx.errors()).toContain(copy.errors.valueRequired);
    expect(document.activeElement).toBe(ctx.valueInput());
  });

  it("keeps the header name and its value in two separately labelled fields", () => {
    const ctx = mount({ rule: rule() });
    expect(ctx.nameInput().value).toBe("authorization");
    expect(ctx.valueInput().value).toBe("Bearer staging");

    const labelOf = (field: HTMLElement) =>
      ctx.root.querySelector(`label[for="${field.id}"]`)?.textContent;
    expect(labelOf(ctx.nameInput())).toBe(copy.editor.labels.headerName);
    expect(labelOf(ctx.valueInput())).toBe(copy.editor.labels.value);
    expect(ctx.nameInput().closest(".editor-field")).not.toBe(
      ctx.valueInput().closest(".editor-field"),
    );
  });

  it("splits a pasted `name: value` line across both fields", async () => {
    const ctx = mount();
    pasteInto(ctx.nameInput(), "Authorization: Bearer eyJhbGciOi.J9");

    expect(ctx.nameInput().value).toBe("Authorization");
    expect(ctx.valueInput().value).toBe("Bearer eyJhbGciOi.J9");
    expect(ctx.root.textContent).toContain(copy.editor.pastedLineSplit);

    await saveDraft(ctx);
    expect(ctx.onSave).toHaveBeenCalledExactlyOnceWith(
      undefined,
      expect.objectContaining({
        header: "Authorization",
        value: "Bearer eyJhbGciOi.J9",
      }),
      undefined,
    );
  });

  it("does not split a paste that carries no header line", () => {
    const ctx = mount();
    pasteInto(ctx.nameInput(), "x-request-id");
    expect(ctx.valueInput().value).toBe("");
    expect(ctx.root.textContent).not.toContain(copy.editor.pastedLineSplit);
  });

  it("commits from the explicit primary action with the draft as typed", async () => {
    const ctx = mount();
    await fillAndCommit(ctx, "X-Custom");
    expect(ctx.onSave).toHaveBeenCalledExactlyOnceWith(
      undefined,
      {
        direction: "request",
        operation: "set",
        header: "X-Custom",
        value: "v1",
        scope: { type: "domains", domains: ["api.example.com"] },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
      undefined,
    );
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

  // Preact diffs the actions row by index, so the Cancel that raises the guard
  // and the Discard that replaces it are one DOM node, and a pointer Cancel
  // leaves focus sitting on it. Placing focus in the commit that paints the
  // guard is what stops an Enter struck straight after from answering the
  // question with the one outcome that cannot be taken back.
  it("focuses Keep editing in the commit that paints the guard", async () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "x-custom");
    const cancel = ctx.root.querySelector(
      ".editor-cancel",
    ) as HTMLButtonElement;
    cancel.focus();
    const focused = atPaint(
      () => ctx.root.querySelector(".discard-title") !== null,
      () => document.activeElement?.textContent,
    );

    cancel.click();
    expect(await focused).toBe(copy.editor.discardConfirm.keepEditing);
    expect(cancel.textContent).toBe(copy.editor.discardConfirm.discard);
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
    // The list opens on a deliberate ↓, not on the keystroke, so it never sits
    // over the value field waiting to eat a click meant for that field.
    press(ctx.nameInput(), "ArrowDown");
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
      undefined,
    );
    expect(ctx.onCommitted).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "edit" }),
    );
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
      undefined,
    );
  });

  it("refuses a domain that is not a hostname and marks the chip", async () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "x-custom");
    typeInto(ctx.valueInput(), "v1");
    typeInto(ctx.chipInput(), "*.example.com");
    press(ctx.chipInput(), "Enter");
    await settle();

    // The wildcard lands in the stop hue the moment it commits; the real domain
    // beside it stays plain.
    const invalidChips = ctx.root.querySelectorAll(".domain-chip.invalid");
    expect(invalidChips).toHaveLength(1);
    expect(invalidChips[0]?.textContent).toContain("*.example.com");

    // Chrome stores such an entry and matches no request, so the save is refused
    // rather than authoring a rule that reads live and changes nothing, and the
    // refusal lands focus on the scope input, not on the chip that cannot hold it.
    await saveAndExpectRefused(ctx, copy.errors.domainInvalid);
    expect(document.activeElement).toBe(ctx.chipInput());
  });

  it("saves an underscore host, which Chrome stores and matches verbatim", async () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "x-custom");
    typeInto(ctx.valueInput(), "v1");
    typeInto(ctx.chipInput(), "my_service.corp");
    press(ctx.chipInput(), "Enter");
    await settle();

    // The host is live, not a dead shape, so no chip is marked and the save runs.
    expect(ctx.root.querySelector(".domain-chip.invalid")).toBeNull();

    fire(() => ctx.saveButton().click());
    await settle();
    expect(ctx.onSave).toHaveBeenCalledExactlyOnceWith(
      undefined,
      expect.objectContaining({
        scope: {
          type: "domains",
          domains: ["api.example.com", "my_service.corp"],
        },
      }),
      undefined,
    );
  });

  it("refuses a wildcard grant host the same way, since it feeds requestDomains", async () => {
    const ctx = mount({ grants: NARROW });
    pickScope(ctx, "regex");
    typeInto(
      ctx.root.querySelector('[aria-label="Regex"]') as HTMLInputElement,
      ".*google.*",
    );
    await addGrantHost(ctx, "*.google.com");
    expect(
      ctx.root.querySelector(".grant-chip.invalid")?.textContent,
    ).toContain("*.google.com");

    typeInto(ctx.nameInput(), "authorization");
    typeInto(ctx.valueInput(), "Bearer one");
    await saveAndExpectRefused(ctx, copy.errors.domainInvalid);
    expect(ctx.onRequestGrant).not.toHaveBeenCalled();
    // The bad host, not the valid regex beside it, is what the refusal marks and
    // takes focus.
    expect(
      ctx.root
        .querySelector('[aria-label="Regex"]')
        ?.getAttribute("aria-invalid"),
    ).toBeNull();
    expect(document.activeElement).toBe(
      ctx.root.querySelector(".grant-chip-input"),
    );
  });

  it("marks the pattern, not the host, when the empty pattern is the shown refusal", async () => {
    const ctx = mount({ grants: NARROW });
    pickScope(ctx, "pattern");
    // Pattern left empty, and a malformed grant host present too: the empty
    // pattern is the refusal shown, so it, not the host, takes the mark and focus.
    await addGrantHost(ctx, "*.google.com");
    typeInto(ctx.nameInput(), "authorization");
    typeInto(ctx.valueInput(), "Bearer one");
    await saveAndExpectRefused(ctx, copy.errors.scopeEmpty.pattern);
    expect(document.activeElement).toBe(
      ctx.root.querySelector('[aria-label="URL pattern"]'),
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
      undefined,
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

  it("refuses request-append and lands focus on the operation control", async () => {
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
    setOperation(ctx.operationInput("append"));
    // A real click leaves focus on the primary; the refusal must move it.
    ctx.saveButton().focus();
    await fillAndCommit(ctx, "x-custom-token");
    expect(ctx.nameInput().value).toBe("x-custom-token");

    const append = ctx.operationInput("append");
    expect(append.closest(".editor-primary-field")?.textContent).toContain(
      copy.errors.appendDisallowed("x-custom-token"),
    );
    // A refusal that leaves focus on the button that raised it reads as a dead
    // click; the operation control owns the refusal, so it takes the mark and
    // the focus.
    expect(append.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(append);
  });

  it("lands focus on the resource-types control when none stays selected", async () => {
    const ctx = mount();
    typeInto(ctx.nameInput(), "x-custom");
    typeInto(ctx.valueInput(), "v1");
    const disclosure = () =>
      [...ctx.root.querySelectorAll(".disclosure")].find((button) =>
        button.textContent?.includes(copy.editor.labels.resourceTypes),
      ) as HTMLButtonElement;
    fire(() => disclosure().click());
    for (const box of ctx.root.querySelectorAll<HTMLInputElement>(
      ".rt-item input",
    )) {
      if (box.checked) {
        fire(() => box.click());
      }
    }
    ctx.saveButton().focus();
    await saveDraft(ctx);

    expect(ctx.onSave).not.toHaveBeenCalled();
    expect(ctx.errors()).toContain(copy.errors.scopeEmpty.resourceTypes);
    expect(disclosure().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(disclosure());
  });

  it.each([
    ["syntaxError", copy.errors.regexInvalid],
    ["memoryLimitExceeded", copy.errors.regexOversize],
  ])(
    "renders the regex copy for %s under the scope field",
    async (reason, message) => {
      const ctx = mount(
        {},
        { error: { kind: "regex-invalid", regex: "(a|b", reason } },
      );
      const regexRadio = ctx.root.querySelector(
        '.segmented input[value="regex"]',
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
    },
  );

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
  ] as const)(
    "renders cap and budget errors at editor level and lands focus on the banner",
    async (error, message) => {
      const ctx = mount({}, { error: error as MutationError });
      // A real click leaves focus on the primary; a form-level refusal has no
      // field to blame, so the banner itself must take the focus back off it.
      ctx.saveButton().focus();
      await fillAndCommit(ctx);
      expect(ctx.onClose).not.toHaveBeenCalled();
      expect(ctx.errors()).toContain(message);
      expect(ctx.nameInput().value).toBe("x-custom");
      expect(document.activeElement).toBe(
        ctx.root.querySelector(".editor-error-global"),
      );
    },
  );
});

describe("RuleEditor delete", () => {
  it("offers no delete while there is no saved rule to delete", () => {
    const ctx = mount({ onDelete: vi.fn() });
    expect(deleteButton(ctx)).toBeUndefined();
  });

  it("deletes on the first click, with nothing to confirm", () => {
    const onDelete = vi.fn();
    const ctx = mount({ rule: rule(), onDelete });
    fire(() => (deleteButton(ctx) as HTMLButtonElement).click());
    expect(onDelete).toHaveBeenCalledOnce();
    expect(ctx.root.textContent).not.toContain(
      copy.editor.discardConfirm.title,
    );
  });
});

describe("RuleEditor profile choice", () => {
  const PROFILES = [
    { id: "p1", name: "Staging auth" },
    { id: "p2", name: "Prod read-only" },
  ];

  it("says nothing about profiles when there is no choice to make", () => {
    const ctx = mount({ rule: rule() });
    expect(ctx.profileSelect()).toBeNull();
  });

  it("saves the rule into the picked profile", async () => {
    const ctx = mount({
      rule: rule(),
      profiles: PROFILES,
      profileId: "p1",
    });
    const select = ctx.profileSelect() as HTMLSelectElement;
    expect(select.value).toBe("p1");

    fire(() => {
      select.value = "p2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await saveDraft(ctx);

    expect(ctx.onSave).toHaveBeenCalledExactlyOnceWith(
      "r1",
      expect.objectContaining({ header: "authorization" }),
      "p2",
    );
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

  it("generates a UUID literal that replaces the value, regenerates, and clears on hand edit", () => {
    const ctx = mount();
    openGenerateMenu(ctx);
    const uuid = [...ctx.root.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === copy.editor.generateUuid,
    ) as HTMLButtonElement;
    fire(() => uuid.click());
    const first = ctx.valueInput().value;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    // The generated value drops the literal note; hand-editing brings it back.
    expect(ctx.root.textContent).not.toContain(copy.valueNote.literal);

    openGenerateMenu(ctx);
    const again = [...ctx.root.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === copy.editor.generateUuid,
    ) as HTMLButtonElement;
    fire(() => again.click());
    expect(ctx.valueInput().value).not.toBe(first);

    typeInto(ctx.valueInput(), "hand-edited");
    expect(ctx.root.textContent).toContain(copy.valueNote.literal);
  });

  it("shows the freeze time for a saved generated value", () => {
    const ctx = mount({
      rule: rule({
        value: "5cb4",
        generated: { kind: "uuid", at: "2026-07-12T14:03:27.000Z" },
      }),
    });
    expect(ctx.root.textContent).toContain(
      copy.valueNote.frozen("2026-07-12T14:03:27.000Z"),
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
    expect(ctx.onCommitted).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "create" }),
    );
    expect(ctx.onGranted).toHaveBeenCalledOnce();
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });

  it("requests a different tab origin without changing the authored initiators", async () => {
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
      expect.objectContaining({ initiators: [] }),
      undefined,
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
      undefined,
    );

    const broad = mount({
      grants: GRANTED_ALL,
      prefillDomain: "api.example.com",
      tabDomain: "app.example.com",
    });
    await fillAndCommit(broad, "authorization");
    expect(broad.onSave.mock.calls[0]?.[1].initiators).toEqual(
      differs.onSave.mock.calls[0]?.[1].initiators,
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
      undefined,
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
      '.segmented input[value="all"]',
    ) as HTMLInputElement;
    fire(() => allSites.click());

    expect(ctx.saveButton().textContent).toBe(
      copy.actions.createRuleAndAllow(copy.scopeSummary.allSites),
    );
    await fillAndCommit(ctx, "authorization");

    expect(ctx.onSave).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ scope: { type: "all" } }),
      undefined,
    );
    expectAllSitesGranted(ctx);
  });

  it("keeps all-sites saves plain when broad access is already granted", () => {
    const ctx = mount({ grants: GRANTED_ALL });
    const allSites = ctx.root.querySelector(
      '.segmented input[value="all"]',
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

  // An empty grant-host field is an explicit all-sites request. The editor must
  // not infer a host from the expression — anchored, literal, or otherwise — and
  // quietly narrow a rule the user left open, so every empty-host pattern/regex
  // discloses all sites and is saved exactly as authored.
  it.each([
    {
      label: "an anchored pattern",
      scope: {
        type: "pattern" as const,
        pattern: "||api.acme.dev^",
        hosts: [],
      },
    },
    {
      label: "a literal-host regex",
      scope: {
        type: "regex" as const,
        regex: "^https://api\\.acme\\.dev/",
        hosts: [],
      },
    },
    {
      label: "a hostless pattern",
      scope: { type: "pattern" as const, pattern: "/api/", hosts: [] },
    },
    {
      label: "a hostless regex",
      scope: { type: "regex" as const, regex: "/v[0-9]+/", hosts: [] },
    },
  ])("discloses all sites for $label with no grant host", async ({ scope }) => {
    const ctx = mountPageRule(scope);

    expect(ctx.saveButton().textContent).toBe(
      copy.actions.saveChangesAndAllow(copy.scopeSummary.allSites),
    );
    await commitEditedValue(ctx);

    expect(ctx.onSave).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({
        scope: expect.objectContaining({ hosts: [] }),
      }),
      undefined,
    );
    expectAllSitesGranted(ctx);
  });

  it("bounds a hostless regex to a typed host instead of all sites", async () => {
    const ctx = mount({ grants: NARROW });
    const regexRadio = ctx.root.querySelector(
      '.segmented input[value="regex"]',
    ) as HTMLInputElement;
    fire(() => regexRadio.click());
    const regexInput = ctx.root.querySelector(
      '[aria-label="Regex"]',
    ) as HTMLInputElement;
    typeInto(regexInput, ".*google.*");

    // With no host to grant, the honest request is all-sites and the button says so.
    expect(ctx.saveButton().textContent).toBe(
      copy.actions.createRuleAndAllow(copy.scopeSummary.allSites),
    );

    const hostInput = ctx.root.querySelector(
      ".grant-chip-input",
    ) as HTMLInputElement;
    typeInto(hostInput, "google.com");
    press(hostInput, "Enter");
    await settle();

    // A named host bounds the grant back to per-site.
    expect(ctx.saveButton().textContent).toBe(
      copy.actions.createRuleAndAllow("google.com"),
    );

    typeInto(ctx.nameInput(), "authorization");
    typeInto(ctx.valueInput(), "Bearer one");
    fire(() => ctx.saveButton().click());
    await settle();

    expect(ctx.onRequestGrant).toHaveBeenCalledExactlyOnceWith([
      "*://*.google.com/*",
    ]);
    expect(ctx.onSave).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        scope: { type: "regex", regex: ".*google.*", hosts: ["google.com"] },
      }),
      undefined,
    );
    expect(ctx.onGranted).toHaveBeenCalledOnce();
  });

  it("carries the grant hosts of an existing pattern rule into an editable field", () => {
    const ctx = mount({
      grants: NARROW,
      rule: rule({
        scope: {
          type: "pattern",
          pattern: "||api.acme.dev^",
          hosts: ["api.acme.dev"],
        },
      }),
    });
    const chip = [...ctx.root.querySelectorAll(".grant-chip")].map(
      (node) => node.textContent,
    );
    expect(chip.some((text) => text?.includes("api.acme.dev"))).toBe(true);
    expect(ctx.saveButton().textContent).toBe(
      copy.actions.saveChangesAndAllow("api.acme.dev"),
    );
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

  it("offers to widen Chrome's exact-origin toolbar grant", () => {
    const granted: GrantSnapshot = {
      origins: ["https://api.example.com/*"],
      allSites: false,
    };
    const ctx = mount({ grants: granted, prefillDomain: "api.example.com" });

    expect(ctx.saveButton().textContent).toBe(
      copy.actions.createRuleAndAllow("api.example.com"),
    );
  });

  // The button is the disclosure of reach that comes before Chrome's own dialog,
  // and the popup does not survive that dialog, so the button is the last word.
  // Naming the sites states exactly what Chrome will ask for; a count would hide
  // which sites, understating the very thing the button exists to state.
  it("names the sites when the commit asks Chrome for more than one", async () => {
    const ctx = mount({ grants: NARROW, prefillDomain: "api.example.com" });
    typeInto(ctx.chipInput(), "example.com");
    fire(() => press(ctx.chipInput(), "Enter"));

    expect(ctx.saveButton().textContent).toBe(
      copy.actions.createRuleAndAllow("api.example.com and example.com"),
    );

    ctx.onRequestGrant.mockResolvedValueOnce(false);
    await fillAndCommit(ctx, "authorization");
    expect(ctx.onRequestGrant).toHaveBeenCalledExactlyOnceWith([
      "*://*.api.example.com/*",
      "*://*.example.com/*",
    ]);
    // The decline names the same reach the button did.
    expect(ctx.onGrantDeclined).toHaveBeenCalledExactlyOnceWith(
      "api.example.com and example.com",
    );
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
      expect.objectContaining({ initiators: [] }),
      undefined,
    );
    expect(ctx.onClose).toHaveBeenCalledOnce();
  });
});

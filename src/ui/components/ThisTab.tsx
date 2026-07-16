import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type {
  Direction,
  HeaderOp,
  RuleDraft,
  TabOverride,
} from "../../core/model";
import { focusOnRemoval } from "../a11y/focus";
import { copy } from "../copy";
import {
  type HeaderFieldError,
  headerErrorToFieldError,
  headerValueEmptyErrors,
} from "../state/header-errors";
import {
  addOverride,
  removeOverride,
  type SessionMutationError,
  setOverrideEnabled,
  updateOverrideValue,
} from "../state/session-mutations";
import { Button } from "./Button";
import { handleEditorCommitKey } from "./editorKeys";
import { CheckGlyph, CloseGlyph, PencilGlyph } from "./glyphs";
import { HeaderFields } from "./HeaderFields";
import { HeaderLineFields } from "./HeaderLineFields";
import {
  closePopover,
  handleMenuNavigation,
  openPositionedPopover,
} from "./popover";
import { headerValueSummary, isSecretHeader } from "./RuleFace";
import { sentence } from "./sentence";
import { Toggle } from "./Toggle";
import { TRUNCATION_LIMITS, Truncate } from "./Truncate";
import { useDraftState } from "./useDraftState";
import { usePopoverDismiss } from "./usePopoverDismiss";
import "./ThisTab.css";

interface ThisTabProps {
  /** The active tab's id; undefined on chrome:// and store pages. */
  tabId: number | undefined;
  /** The active tab's own origin host; undefined where no rule can bind. */
  host: string | undefined;
  /** This-tab session overrides for the active tab, in insertion order. */
  overrides: readonly TabOverride[];
  /** Whether the composer is open (a fresh empty row awaiting input). */
  composing: boolean;
  /** Opens a fresh temporary override composer. */
  onOpenComposer: () => void;
  /** Promotes a temporary row into a real rule (pre-fills the editor). */
  onSaveAsRule: (override: TabOverride) => void;
  /** Closes the composer without adding. */
  onCloseComposer: () => void;
}

/**
 * The This-tab section. Rows apply immediately with no permission
 * prompt because opening the popup is the activeTab consent gesture. They
 * cover this tab's own origin only, end when the tab navigates
 * away or closes, and are suspended by global pause. Writes land in the session
 * store's metadata only; the background scheduler is the sole DNR writer. The
 * section remains present in normal list mode so the core loop is discoverable.
 */
export function ThisTab(props: ThisTabProps) {
  const { tabId, host, overrides, composing } = props;
  return (
    <section class="this-tab" aria-label={copy.thisTab.sectionLabel}>
      <div class="this-tab-head">
        <p>
          <span class="silk">{copy.thisTab.sectionLabel}</span>
          {host !== undefined && sentence(copy.thisTab.summary(host))}
        </p>
        {!composing && (
          <button
            type="button"
            class="link-btn this-tab-add"
            onClick={props.onOpenComposer}
          >
            {copy.thisTab.addOverride}
          </button>
        )}
      </div>
      <p class="this-tab-lifecycle">{copy.firstRun.tryThisTabSubline}</p>

      <ul class="this-tab-rows">
        {overrides.map((override) => (
          <OverrideRow
            key={override.num}
            override={override}
            onRemove={() => void removeOverride(override.tabId, override.num)}
            onSaveAsRule={() => props.onSaveAsRule(override)}
          />
        ))}
      </ul>

      {composing &&
        (host === undefined || tabId === undefined ? (
          <p class="this-tab-note" role="alert">
            {copy.thisTab.noHost}
          </p>
        ) : (
          <Composer tabId={tabId} host={host} onClose={props.onCloseComposer} />
        ))}
    </section>
  );
}

function OverrideRow({
  override,
  onRemove,
  onSaveAsRule,
}: {
  override: TabOverride;
  onRemove: () => void;
  onSaveAsRule: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const summary = headerValueSummary(override.header, override.value);

  const beginEdit = () => {
    if (override.value === undefined) return;
    setValue(isSecretHeader(override.header) ? "" : override.value);
    setError(undefined);
    setEditing(true);
  };

  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = async () => {
    if (saving) return;
    setSaving(true);
    const outcome = await updateOverrideValue(
      override.tabId,
      override.num,
      value,
    );
    setSaving(false);
    if (outcome.ok) {
      setEditing(false);
      return;
    }
    const mapped = mapError(outcome.error);
    setError(mapped.value ?? mapped.name ?? copy.errors.valueRequired);
  };

  return (
    <li class={override.enabled ? "this-tab-row" : "this-tab-row off"}>
      <Toggle
        checked={override.enabled}
        label={copy.rules.temporarySwitchLabel(
          override.header,
          override.enabled,
        )}
        onChange={(enabled) =>
          void setOverrideEnabled(override.tabId, override.num, enabled)
        }
      />
      <div class="rule-lines">
        {editing ? (
          <>
            <div class="rule-line1 inline-value-line">
              <span class="rule-name">{override.header}</span>
              <span class="colon">:</span>
              <input
                ref={inputRef}
                class="inline-value-input mono"
                type={isSecretHeader(override.header) ? "password" : "text"}
                value={value}
                placeholder={copy.rules.pasteNewValue}
                aria-label={copy.editor.labels.value}
                disabled={saving}
                onInput={(event) => setValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void commit();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setEditing(false);
                  }
                }}
              />
              <button
                type="button"
                class="inline-value-action inline-value-save"
                aria-label={copy.actions.saveChanges}
                disabled={saving}
                onClick={() => void commit()}
              >
                <CheckGlyph />
              </button>
              <button
                type="button"
                class="inline-value-action"
                aria-label={copy.actions.cancel}
                disabled={saving}
                onClick={() => setEditing(false)}
              >
                <CloseGlyph />
              </button>
            </div>
            <p class={error === undefined ? "rule-line2" : "editor-error"}>
              {error ?? copy.rules.editValueHint}
            </p>
          </>
        ) : (
          <>
            <p
              class={
                override.operation !== "remove" && summary !== undefined
                  ? "rule-line1 has-value"
                  : "rule-line1"
              }
            >
              <Truncate
                mode="middle"
                value={override.header}
                maxChars={TRUNCATION_LIMITS.header}
                class="rule-name"
              />
              {override.operation !== "remove" && summary !== undefined && (
                <span class="rule-value-preview">
                  <span class="colon">: </span>
                  <button
                    type="button"
                    class="rule-value-button"
                    aria-label={copy.menu.editValue}
                    onClick={beginEdit}
                  >
                    <Truncate
                      mode="middle"
                      value={summary}
                      maxChars={TRUNCATION_LIMITS.value}
                      class="rule-value"
                    />
                    <span class="rule-value-pencil">
                      <PencilGlyph />
                    </span>
                  </button>
                </span>
              )}
            </p>
            <p class="rule-line2">
              {override.operation !== "set" && (
                <span class="rule-op">
                  {copy.rules.operation[override.operation]}
                </span>
              )}{" "}
              <span
                class="rule-direction"
                role="img"
                aria-label={copy.rules.direction[override.direction]}
              >
                {override.direction === "request" ? "→" : "←"}
              </span>
            </p>
          </>
        )}
      </div>
      {!editing && (
        <button
          type="button"
          class="icon-btn this-tab-menu-btn"
          aria-label={copy.thisTab.menuLabel(override.header)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          ref={menuButtonRef}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ⋯
        </button>
      )}
      {menuOpen && (
        <OverrideMenu
          override={override}
          trigger={menuButtonRef}
          onEditValue={override.value === undefined ? undefined : beginEdit}
          onSaveAsRule={onSaveAsRule}
          onDelete={() => {
            if (menuButtonRef.current !== null) {
              focusOnRemoval(menuButtonRef.current);
            }
            onRemove();
          }}
          onClose={(restoreFocus) => {
            setMenuOpen(false);
            if (restoreFocus) {
              queueMicrotask(() => menuButtonRef.current?.focus());
            }
          }}
        />
      )}
    </li>
  );
}

function OverrideMenu({
  override,
  trigger,
  onEditValue,
  onSaveAsRule,
  onDelete,
  onClose,
}: {
  override: TabOverride;
  trigger: { readonly current: HTMLButtonElement | null };
  onEditValue: (() => void) | undefined;
  onSaveAsRule: () => void;
  onDelete: () => void;
  onClose: (restoreFocus: boolean) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (menu.current === null || trigger.current === null) return;
    openPositionedPopover(menu.current, trigger.current, "end");
    menu.current.querySelector<HTMLButtonElement>("button")?.focus();
    return () => closePopover(menu.current);
  }, []);
  usePopoverDismiss(true, menu, trigger, onClose);

  const activate = (action: () => void) => {
    onClose(false);
    action();
  };
  return (
    <div
      class="menu-pop this-tab-menu"
      popover="manual"
      role="menu"
      aria-label={copy.thisTab.menuLabel(override.header)}
      ref={menu}
      onKeyDown={(event) => {
        if (menu.current !== null) {
          handleMenuNavigation(event, menu.current, () => onClose(true));
        }
      }}
    >
      {onEditValue !== undefined && (
        <button
          type="button"
          role="menuitem"
          class="menu-item"
          onClick={() => activate(onEditValue)}
        >
          {copy.menu.editValue}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        class="menu-item"
        onClick={() => activate(onSaveAsRule)}
      >
        {copy.thisTab.saveAsRule}
      </button>
      <button
        type="button"
        role="menuitem"
        class="menu-item destructive"
        onClick={() => activate(onDelete)}
      >
        {copy.menu.delete}
      </button>
    </div>
  );
}

interface Draft {
  direction: Direction;
  operation: HeaderOp;
  header: string;
  value: string;
}

interface Errors extends HeaderFieldError {
  /** The session cap, shown below the fields rather than on one of them. */
  add?: string;
}

/**
 * The inline composer for a new This-tab override. Its action button and
 * Ctrl/Cmd+Enter are the only commit paths; Esc reverts and focus changes leave
 * the draft untouched. Header validation runs in the session write path; its
 * errors and the session cap render inline.
 */
function Composer({
  tabId,
  host,
  onClose,
}: {
  tabId: number;
  host: string;
  onClose: () => void;
}) {
  const id = useId();
  const [errors, setErrors] = useState<Errors>({});
  const commit = async () => {
    if (busyRef.current) {
      return;
    }
    const current = draftRef.current;
    const empties = headerValueEmptyErrors(current);
    if (empties !== undefined) {
      setErrors(empties);
      return;
    }
    busyRef.current = true;
    try {
      const outcome = await addOverride(tabId, host, {
        direction: current.direction,
        operation: current.operation,
        header: current.header,
        ...(current.operation === "remove" ? {} : { value: current.value }),
      });
      if (outcome.ok) {
        onClose();
        return;
      }
      setErrors(mapError(outcome.error));
    } finally {
      busyRef.current = false;
    }
  };
  const { draft, draftRef, busyRef, update } = useDraftState<Draft>(
    () => ({
      direction: "request",
      operation: "set",
      header: "",
      value: "",
    }),
    () => setErrors({}),
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busyRef.current) {
        onClose();
      }
      return;
    }
    handleEditorCommitKey(event, () => void commit());
  };

  return (
    <fieldset
      class="this-tab-composer inline-editor-well"
      onKeyDown={onKeyDown}
    >
      <legend class="silk">{copy.thisTab.composerTitle}</legend>

      <HeaderFields idBase={id} draft={draft} errors={errors} update={update} />

      <HeaderLineFields
        header={draft.header}
        value={draft.value}
        remove={draft.operation === "remove"}
        nameError={errors.name}
        valueError={errors.value}
        onHeaderInput={(header) =>
          update((current) => ({ ...current, header }))
        }
        onValueInput={(value) => update((current) => ({ ...current, value }))}
      />

      {errors.add !== undefined && (
        <p class="editor-error editor-error-global" role="alert">
          {errors.add}
        </p>
      )}

      <div class="this-tab-composer-actions">
        <Button kind="quiet" onClick={onClose}>
          {copy.actions.cancel}
        </Button>
        <Button kind="primary" onClick={() => void commit()}>
          {copy.actions.addOverride}
        </Button>
      </div>
    </fieldset>
  );
}

function mapError(error: SessionMutationError): Errors {
  // A session override can only fail header validation or the session cap; the
  // dynamic store's rule/regex/byte caps never gate this write path.
  return error.kind === "session-override-limit-exceeded"
    ? { add: copy.errors.sessionCap }
    : headerErrorToFieldError(error);
}

/** The rule draft a promoted temporary row seeds the editor with. */
export function overrideToRuleDraft(
  override: TabOverride,
  host: string,
): RuleDraft {
  return {
    direction: override.direction,
    operation: override.operation,
    header: override.header,
    ...(override.operation === "remove" || override.value === undefined
      ? {}
      : { value: override.value }),
    scope: { type: "domains", domains: [host] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
  };
}

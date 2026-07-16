import type { ComponentChildren, RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { subresourceScopedRule } from "../../core/grants";
import type { Profile, Rule } from "../../core/model";
import { useAnnounce } from "../a11y/LiveRegion";
import { copy, sentenceText } from "../copy";
import { isSecretHeader, ruleValueSummary } from "../secret";
import { CloseGlyph } from "./glyphs";
import {
  closePopover,
  handleMenuNavigation,
  openPositionedPopover,
} from "./popover";
import { RuleFace } from "./RuleFace";
import { scopeSummary, typesSummary } from "./ruleSummary";
import { sentence } from "./sentence";
import { Toggle } from "./Toggle";
import "./RuleRow.css";

interface RuleRowActions {
  onToggle: (enabled: boolean) => void;
  onGrant?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onDuplicate?: (() => void) | undefined;
  onMoveToProfile?: ((profileId: string) => void) | undefined;
  onRegenerate?: (() => void) | undefined;
  onUndoDelete?: (() => void) | undefined;
  onUpdateValue?: ((value: string) => Promise<boolean>) | undefined;
}

interface RuleRowProps extends RuleRowActions {
  rule: Rule;
  /** Hosts this rule needs but has no grant for; non-empty renders the loud state. */
  missingHosts?: readonly string[] | undefined;
  /** RE2-invalid scope (from import): switch soft-disabled, note focusable. */
  invalid?: boolean | undefined;
  /** Shadowed by an earlier enabled rule on the same header (passive note). */
  overridden?: boolean | undefined;
  /** False when the containing profile is off. */
  active?: boolean | undefined;
  /** Options-only bulk-selection control. Omit on popup rows. */
  selection?:
    | {
        checked: boolean;
        label: string;
        onChange: (checked: boolean) => void;
      }
    | undefined;
  /** "Undo last delete" stays in this menu until the next mutation. */
  undoAvailable?: boolean | undefined;
  /** Profiles this rule could move to (everything but its own). */
  moveTargets?: readonly Pick<Profile, "id" | "name">[] | undefined;
  posinset?: number | undefined;
  setsize?: number | undefined;
  tabIndex?: number | undefined;
  onFocus?: (() => void) | undefined;
  onRowCommand?:
    | ((event: KeyboardEvent, openMenu: () => void) => void)
    | undefined;
  rowRef?: ((element: HTMLLIElement | null) => void) | undefined;
}

/**
 * One rule. Grid [switch][direction][content][overflow]; the left edge is the
 * state rail, and blocked rows pair their caution rail with words and a Grant
 * action so the toggle never implies healthy operation on its own.
 */
export function RuleRow(props: RuleRowProps) {
  const { rule, invalid, missingHosts, selection } = props;
  const noteRef = useRef<HTMLSpanElement>(null);
  const valueInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingValue, setEditingValue] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const [savingValue, setSavingValue] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const beginValueEdit = () => {
    if (rule.value === undefined || props.onUpdateValue === undefined) return;
    setDraftValue(isSecretHeader(rule.header) ? "" : rule.value);
    setEditingValue(true);
    setMenuOpen(false);
  };
  const menuActions = toMenuActions(props, beginValueEdit);
  const active = props.active !== false;

  const needsAccess =
    active && rule.enabled && !invalid && (missingHosts?.length ?? 0) > 0;
  const state = invalid
    ? "invalid"
    : needsAccess
      ? "blocked"
      : rule.enabled && active
        ? "running"
        : rule.enabled
          ? "inactive"
          : "off";

  const value = ruleValueSummary(rule);
  const description = [
    value === undefined ? undefined : `${rule.header}: ${value}`,
    needsAccess ? "needs access" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

  useLayoutEffect(() => {
    if (!editingValue) return;
    valueInputRef.current?.focus();
    valueInputRef.current?.select();
  }, [editingValue]);

  const commitValue = async () => {
    if (savingValue || props.onUpdateValue === undefined) return;
    setSavingValue(true);
    const saved = await props.onUpdateValue(draftValue);
    setSavingValue(false);
    if (saved) setEditingValue(false);
  };

  return (
    <li
      class={`rule-row ${state}${selection === undefined ? "" : " has-selection"}`}
      data-rule-id={rule.id}
      tabIndex={props.tabIndex}
      aria-posinset={props.posinset}
      aria-setsize={props.setsize}
      aria-description={description === "" ? undefined : description}
      ref={(element) => props.rowRef?.(element)}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          props.onFocus?.();
        }
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onRowCommand?.(event, () => setMenuOpen(true));
        }
      }}
      onClick={() => {
        if (!editingValue) props.onEdit?.();
      }}
    >
      {selection !== undefined && (
        <input
          class="rule-select"
          type="checkbox"
          checked={selection.checked}
          aria-label={selection.label}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => selection.onChange(event.currentTarget.checked)}
        />
      )}
      <Toggle
        checked={rule.enabled}
        label={copy.rules.switchLabel(rule.header, rule.enabled)}
        ariaDisabled={invalid}
        tone={needsAccess ? "blocked" : undefined}
        {...(props.tabIndex === undefined ? {} : { tabIndex: -1 })}
        onChange={(enabled) => {
          // An invalid rule cannot be enabled; activation points at the reason.
          if (invalid) {
            noteRef.current?.focus();
          } else {
            props.onToggle(enabled);
          }
        }}
      />
      {editingValue ? (
        <div class="rule-lines inline-value-editor">
          <div class="rule-line1 inline-value-line">
            <span class="rule-name">{rule.header}</span>
            <span class="colon">:</span>
            <input
              ref={valueInputRef}
              class="inline-value-input mono"
              type={isSecretHeader(rule.header) ? "password" : "text"}
              value={draftValue}
              placeholder={copy.rules.pasteNewValue}
              aria-label={copy.editor.labels.value}
              disabled={savingValue}
              onInput={(event) => setDraftValue(event.currentTarget.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitValue();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setEditingValue(false);
                }
              }}
            />
            <button
              type="button"
              class="inline-value-action inline-value-save"
              aria-label={copy.actions.saveChanges}
              disabled={savingValue}
              onClick={(event) => {
                event.stopPropagation();
                void commitValue();
              }}
            >
              <CheckGlyph />
            </button>
            <button
              type="button"
              class="inline-value-action"
              aria-label={copy.actions.cancel}
              disabled={savingValue}
              onClick={(event) => {
                event.stopPropagation();
                setEditingValue(false);
              }}
            >
              <CloseGlyph />
            </button>
          </div>
          <p class="rule-line2">{copy.rules.editValueHint}</p>
        </div>
      ) : (
        <RuleFace
          rule={rule}
          secondLine={lineTwo(props, noteRef)}
          secondLineTitle={lineTwoTitle(props)}
          onEditValue={
            rule.value === undefined || props.onUpdateValue === undefined
              ? undefined
              : beginValueEdit
          }
        />
      )}
      {menuActions !== undefined && (
        <button
          type="button"
          class="icon-btn rule-menu-btn"
          aria-label={copy.rules.menuLabel(rule.header)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          ref={menuButtonRef}
          tabIndex={props.tabIndex === undefined ? undefined : -1}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
        >
          ⋯
        </button>
      )}
      {menuOpen && menuActions !== undefined && (
        <RowMenu
          {...menuActions}
          rule={rule}
          menuButton={menuButtonRef}
          onClose={(returnFocus) => {
            setMenuOpen(false);
            if (returnFocus) {
              menuButtonRef.current?.focus();
            }
          }}
        />
      )}
    </li>
  );
}

function lineTwo(
  props: RuleRowProps,
  noteRef: RefObject<HTMLSpanElement>,
): ComponentChildren {
  const { rule, invalid, missingHosts, overridden } = props;
  if (invalid) {
    return (
      <span class="rule-status" tabIndex={-1} ref={noteRef}>
        <CautionTriangle /> {copy.rules.invalidRegex}
      </span>
    );
  }
  const missing = missingHosts ?? [];
  const [firstMissing] = missing;
  if (props.active !== false && firstMissing !== undefined) {
    return (
      <>
        <span class="rule-status">
          <CautionTriangle />{" "}
          {sentence(copy.rules.needsAccess(firstMissing, missing.length - 1))}
        </span>
        <button
          type="button"
          class="rule-grant"
          tabIndex={props.tabIndex === undefined ? undefined : -1}
          onClick={(event) => {
            event.stopPropagation();
            props.onGrant?.();
          }}
        >
          {copy.actions.grant}
        </button>
      </>
    );
  }

  const scope = scopeSummary(rule);
  const types = typesSummary(rule);
  return (
    <>
      {sentence(scope)}
      {types !== undefined && <> · {types}</>}
      {rule.comment !== undefined && <> · {rule.comment}</>}
      {overridden === true && <> · {copy.rules.overridden}</>}
      {standingInitiatorNote(rule) && <> · {copy.rules.initiatorNote}</>}
    </>
  );
}

function lineTwoTitle(props: RuleRowProps): string {
  if (props.invalid === true) {
    return copy.rules.invalidRegex;
  }
  const missing = props.missingHosts ?? [];
  const firstMissing = missing[0];
  if (firstMissing !== undefined) {
    return sentenceText(
      copy.rules.needsAccess(firstMissing, missing.length - 1),
    );
  }
  const scope = sentenceText(scopeSummary(props.rule));
  const types = typesSummary(props.rule);
  return [scope, types, props.rule.comment].filter(Boolean).join(" · ");
}

/**
 * The honest split: the standing note is for a rule whose requests are
 * genuinely started by *other* pages — one that reaches subresources but
 * not top-level navigation. A normal direct-navigation rule
 * (all types, so main_frame included) stays quiet rather than carrying a caveat
 * that reads as a standing alarm. Named initiators are a known dimension (loud
 * when missing), and an all-sites scope grants every initiator with it.
 */
function standingInitiatorNote(rule: Rule): boolean {
  return (
    rule.initiators.length === 0 &&
    rule.scope.type !== "all" &&
    subresourceScopedRule(rule)
  );
}

function CautionTriangle() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 0.5 9.7 9H0.3Z" fill="var(--caution-lamp)" />
    </svg>
  );
}

interface RowMenuProps {
  rule: Rule;
  undoAvailable: boolean;
  moveTargets: readonly Pick<Profile, "id" | "name">[];
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveToProfile: (profileId: string) => void;
  onRegenerate: () => void;
  onUndoDelete: () => void;
  onEditValue?: (() => void) | undefined;
  menuButton: RefObject<HTMLButtonElement>;
  /** returnFocus: restore focus to the ⋯ trigger (Esc/activation, not click-away). */
  onClose: (returnFocus: boolean) => void;
}

function toMenuActions(
  props: RuleRowProps,
  onEditValue: () => void,
): Omit<RowMenuProps, "rule" | "menuButton" | "onClose"> | undefined {
  if (
    props.onEdit === undefined ||
    props.onDelete === undefined ||
    props.onDuplicate === undefined ||
    props.onMoveToProfile === undefined ||
    props.onRegenerate === undefined ||
    props.onUndoDelete === undefined
  ) {
    return undefined;
  }
  return {
    undoAvailable: props.undoAvailable ?? false,
    moveTargets: props.moveTargets ?? [],
    onEdit: props.onEdit,
    onDelete: props.onDelete,
    onDuplicate: props.onDuplicate,
    onMoveToProfile: props.onMoveToProfile,
    onRegenerate: props.onRegenerate,
    onUndoDelete: props.onUndoDelete,
    onEditValue:
      props.rule.value === undefined || props.onUpdateValue === undefined
        ? undefined
        : onEditValue,
  };
}

interface MenuItem {
  label: string;
  destructive?: boolean;
  act: () => "close" | "descend";
}

function RowMenu(props: RowMenuProps) {
  const { rule, onClose } = props;
  const announce = useAnnounce();
  const [view, setView] = useState<"root" | "move">("root");
  const listRef = useRef<HTMLDivElement>(null);

  // Deliberate full-fidelity readout of a (possibly middle-truncated) value: the
  // click is the user gesture the clipboard write needs; a "Value copied"
  // announcement closes the loop for assistive tech.
  const copyValue = () => {
    if (rule.value === undefined) return;
    void navigator.clipboard?.writeText(rule.value);
    announce(copy.rules.valueCopied);
  };

  const items: MenuItem[] =
    view === "move"
      ? props.moveTargets.map((profile) => ({
          label: profile.name,
          act: () => {
            props.onMoveToProfile(profile.id);
            return "close";
          },
        }))
      : rootItems(props, () => setView("move"), copyValue);

  // Focus enters the menu on open and on the move-targets drill-in.
  useLayoutEffect(() => {
    const menu = listRef.current;
    const trigger = props.menuButton.current;
    if (menu === null || trigger === null) {
      return;
    }
    openPositionedPopover(menu, trigger, "end");
    menu.querySelector("button")?.focus();
    return () => closePopover(menu);
  }, [view]);

  return (
    <div
      class="menu-pop rule-menu"
      popover="manual"
      role="menu"
      aria-label={copy.rules.menuLabel(rule.header)}
      ref={listRef}
      onKeyDown={(event) => {
        // The open menu owns the keyboard; nothing leaks to the list or popup.
        if (listRef.current !== null) {
          handleMenuNavigation(event, listRef.current, () => onClose(true));
        }
      }}
      onFocusOut={(event) => {
        const into = event.relatedTarget;
        const stays =
          into instanceof Node &&
          (listRef.current?.contains(into) === true ||
            // The trigger's own click toggles the menu; closing here too
            // would make that click reopen it.
            into === props.menuButton.current);
        if (!stays) {
          onClose(false);
        }
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          class={
            item.destructive === true ? "menu-item destructive" : "menu-item"
          }
          onClick={() => {
            if (item.act() === "close") {
              onClose(true);
            }
          }}
        >
          {item.label}
          {view === "root" && item.label === copy.menu.moveToProfile && (
            <span aria-hidden="true"> ▸</span>
          )}
        </button>
      ))}
    </div>
  );
}

function rootItems(
  props: RowMenuProps,
  descend: () => void,
  copyValue: () => void,
): MenuItem[] {
  const close = (act: () => void) => () => {
    act();
    return "close" as const;
  };
  return [
    ...(props.rule.value !== undefined && props.onEditValue !== undefined
      ? [{ label: copy.menu.editValue, act: close(props.onEditValue) }]
      : []),
    { label: copy.menu.edit, act: close(props.onEdit) },
    ...(props.rule.value !== undefined
      ? [{ label: copy.menu.copyValue, act: close(copyValue) }]
      : []),
    { label: copy.menu.duplicate, act: close(props.onDuplicate) },
    ...(props.moveTargets.length > 0
      ? [
          {
            label: copy.menu.moveToProfile,
            act: () => {
              descend();
              return "descend" as const;
            },
          },
        ]
      : []),
    ...(props.rule.generated !== undefined
      ? [{ label: copy.menu.regenerateValue, act: close(props.onRegenerate) }]
      : []),
    ...(props.undoAvailable
      ? [{ label: copy.menu.undoLastDelete, act: close(props.onUndoDelete) }]
      : []),
    { label: copy.menu.delete, destructive: true, act: close(props.onDelete) },
  ];
}

function CheckGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
      <path
        d="m2.5 7 3 3 5-6.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
    </svg>
  );
}

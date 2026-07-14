import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { subresourceScopedRule } from "../../core/grants";
import type { Profile, Rule } from "../../core/model";
import { useAnnounce } from "../a11y/LiveRegion";
import { copy } from "../copy";
import { CheckGlyph } from "./glyphs";
import { RuleFace } from "./RuleFace";
import { scopeSummary, typesSummary } from "./ruleSummary";
import { sentence } from "./sentence";
import { Toggle } from "./Toggle";
import "./RuleRow.css";

interface RuleRowActions {
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveToProfile: (profileId: string) => void;
  onRegenerate: () => void;
  onUndoDelete: () => void;
}

interface RuleRowProps extends RuleRowActions {
  rule: Rule;
  /** Hosts this rule needs but has no grant for; non-empty renders the loud state. */
  missingHosts?: readonly string[] | undefined;
  /** RE2-invalid scope (from import): switch soft-disabled, note focusable. */
  invalid?: boolean | undefined;
  /** Shadowed by an earlier enabled rule on the same header (passive note). */
  overridden?: boolean | undefined;
  /** Session-scoped This-tab row: dotted edge + Temporary line. */
  temporary?: { host: string } | undefined;
  /**
   * A changing token when this row's rule was just auto-saved: pulses the
   * transient "Saved" acknowledgement. Undefined the rest of the
   * time; a new value re-triggers the pulse on a subsequent edit.
   */
  savedNonce?: number | undefined;
  /** "Undo last delete" stays in this menu until the next mutation. */
  undoAvailable: boolean;
  /** Profiles this rule could move to (everything but its own). */
  moveTargets: readonly Pick<Profile, "id" | "name">[];
  posinset: number;
  setsize: number;
  tabIndex: number;
  onFocus: () => void;
  onRowCommand: (event: KeyboardEvent, openMenu: () => void) => void;
  rowRef?: ((element: HTMLLIElement | null) => void) | undefined;
}

/**
 * One rule. Grid [switch][direction][content][overflow]; the left edge is the
 * state channel: a nominal list keeps a perfectly clean edge, needs-access
 * breaks it with a dashed caution mark, temporary with a dotted mute one.
 */
export function RuleRow(props: RuleRowProps) {
  const { rule, invalid, missingHosts, temporary, savedNonce } = props;
  const noteRef = useRef<HTMLSpanElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // The auto-save acknowledgement: a transient "Saved" that fades
  // ~1.5s after a commit. Keyed on the nonce so a repeat edit re-pulses; the
  // affordance is decorative (aria-hidden) — closure for AT comes from focus
  // returning to the row, which re-announces the rule.
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (savedNonce === undefined) {
      return;
    }
    setShowSaved(true);
    const timer = setTimeout(() => setShowSaved(false), 1500);
    return () => clearTimeout(timer);
  }, [savedNonce]);

  const needsAccess = !invalid && (missingHosts?.length ?? 0) > 0;
  const state = invalid
    ? "invalid"
    : needsAccess
      ? "needs-access"
      : temporary !== undefined
        ? "temporary"
        : rule.enabled
          ? "enabled"
          : "disabled";

  const description = [
    rule.value === undefined ? undefined : `${rule.header}: ${rule.value}`,
    needsAccess ? "needs access" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

  return (
    <li
      class={`rule-row ${state}`}
      tabIndex={props.tabIndex}
      aria-posinset={props.posinset}
      aria-setsize={props.setsize}
      aria-description={description === "" ? undefined : description}
      ref={(element) => props.rowRef?.(element)}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          props.onFocus();
        }
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onRowCommand(event, () => setMenuOpen(true));
        }
      }}
    >
      <Toggle
        checked={rule.enabled}
        label={copy.rules.switchLabel(rule.header, rule.enabled)}
        ariaDisabled={invalid}
        tabIndex={-1}
        onChange={(enabled) => {
          // An invalid rule cannot be enabled; activation points at the reason.
          if (invalid) {
            noteRef.current?.focus();
          } else {
            props.onToggle(enabled);
          }
        }}
      />
      <RuleFace rule={rule} secondLine={lineTwo(props, noteRef)} />
      {showSaved && (
        <span class="rule-saved" aria-hidden="true">
          <CheckGlyph />
          {copy.rules.saved}
        </span>
      )}
      <button
        type="button"
        class="icon-btn rule-menu-btn"
        aria-label={copy.rules.menuLabel(rule.header)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        ref={menuButtonRef}
        tabIndex={-1}
        onClick={() => setMenuOpen((open) => !open)}
      >
        ⋯
      </button>
      {menuOpen && (
        <RowMenu
          {...props}
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
  const { rule, invalid, missingHosts, overridden, temporary } = props;
  if (invalid) {
    return (
      <span class="rule-status" tabIndex={-1} ref={noteRef}>
        <CautionTriangle /> {copy.rules.invalidRegex}
      </span>
    );
  }
  const missing = missingHosts ?? [];
  const [firstMissing] = missing;
  if (firstMissing !== undefined) {
    return (
      <span class="rule-status">
        <CautionTriangle />{" "}
        {sentence(copy.rules.needsAccess(firstMissing, missing.length - 1))}
      </span>
    );
  }

  const scope = scopeSummary(rule);
  const types = typesSummary(rule);
  return (
    <>
      {temporary !== undefined && (
        <>
          <span class="silk">{copy.rules.temporaryTag}</span>{" "}
          {sentence(copy.rules.temporary(temporary.host))}
          {" · "}
        </>
      )}
      {sentence(scope)}
      {types !== undefined && <> · {types}</>}
      {rule.comment !== undefined && <> · {rule.comment}</>}
      {overridden === true && <> · {copy.rules.overridden}</>}
      {standingInitiatorNote(rule) && <> · {copy.rules.initiatorNote}</>}
    </>
  );
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

interface RowMenuProps extends RuleRowActions {
  rule: Rule;
  undoAvailable: boolean;
  moveTargets: readonly Pick<Profile, "id" | "name">[];
  menuButton: RefObject<HTMLButtonElement>;
  /** returnFocus: restore focus to the ⋯ trigger (Esc/activation, not click-away). */
  onClose: (returnFocus: boolean) => void;
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
  useEffect(() => {
    listRef.current?.querySelector("button")?.focus();
  }, [view]);

  const moveFocus = (to: number | ((active: number) => number)) => {
    const buttons = [
      ...(listRef.current?.querySelectorAll("button") ?? []),
    ] as HTMLButtonElement[];
    const active = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const target = typeof to === "number" ? to : to(active);
    buttons[(target + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      class="menu-pop rule-menu"
      role="menu"
      aria-label={copy.rules.menuLabel(rule.header)}
      ref={listRef}
      onKeyDown={(event) => {
        // The open menu owns the keyboard; nothing leaks to the list or popup.
        event.stopPropagation();
        switch (event.key) {
          case "ArrowDown":
            moveFocus((active) => active + 1);
            break;
          case "ArrowUp":
            moveFocus((active) => active - 1);
            break;
          case "Home":
            moveFocus(0);
            break;
          case "End":
            moveFocus(-1);
            break;
          case "Escape":
            onClose(true);
            break;
          default:
            return;
        }
        event.preventDefault();
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

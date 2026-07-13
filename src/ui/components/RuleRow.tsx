import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { coversSubresourceTypes } from "../../core/grants";
import type { Profile, Rule } from "../../core/model";
import { copy, type Sentence } from "../copy";
import { MiddleTruncate } from "./MiddleTruncate";
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
  const { rule, invalid, missingHosts, temporary } = props;
  const noteRef = useRef<HTMLSpanElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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
        onChange={(enabled) => {
          // An invalid rule cannot be enabled; activation points at the reason.
          if (invalid) {
            noteRef.current?.focus();
          } else {
            props.onToggle(enabled);
          }
        }}
      />
      <span class="rule-dir">
        <span role="img" aria-label={copy.rules.direction[rule.direction]}>
          {rule.direction === "request" ? "→" : "←"}
        </span>
        <span class="rule-op">{copy.rules.operation[rule.operation]}</span>
      </span>
      <div class="rule-lines">
        <p class="rule-line1">
          <span class="rule-name">{rule.header}</span>
          {rule.operation !== "remove" && rule.value !== undefined && (
            <>
              <span class="colon">: </span>
              <MiddleTruncate value={rule.value} class="rule-value" />
            </>
          )}
        </p>
        <p class="rule-line2">{lineTwo(props, noteRef)}</p>
      </div>
      <button
        type="button"
        class="icon-btn rule-menu-btn"
        aria-label={copy.rules.menuLabel(rule.header)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        ref={menuButtonRef}
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

function scopeSummary(rule: Rule): Sentence {
  switch (rule.scope.type) {
    case "domains": {
      const [first] = rule.scope.domains;
      return first === undefined
        ? []
        : copy.scopeSummary.domains(first, rule.scope.domains.length - 1);
    }
    case "pattern":
      return [copy.scopeSummary.pattern];
    case "regex":
      return [copy.scopeSummary.regex];
    case "all":
      return [copy.scopeSummary.allSites];
  }
}

function typesSummary(rule: Rule): string | undefined {
  if (rule.resourceTypes === "all") {
    return undefined;
  }
  const names = rule.resourceTypes.map(
    (group) => copy.resourceTypes.groups[group],
  );
  if (names.length === 1) {
    return copy.resourceTypes.only(names[0] as string);
  }
  return names.length === 2
    ? names.join(", ")
    : copy.resourceTypes.count(names.length);
}

/**
 * SPEC §3.3's honest split: when a rule reaches subresources and names no
 * initiator, headershim cannot know whether the calling page is granted, so
 * the row carries the standing note. Named initiators are a known dimension
 * (loud when missing), and an all-sites scope grants every initiator with it.
 */
function standingInitiatorNote(rule: Rule): boolean {
  return (
    rule.initiators.length === 0 &&
    rule.scope.type !== "all" &&
    coversSubresourceTypes(rule)
  );
}

/** Hostnames and counts render in the data face; the words stay UI face. */
function sentence(parts: Sentence): ComponentChildren {
  return parts.map((part) =>
    typeof part === "string" ? part : <span class="mono">{part.data}</span>,
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
  const [view, setView] = useState<"root" | "move">("root");
  const listRef = useRef<HTMLDivElement>(null);

  const items: MenuItem[] =
    view === "move"
      ? props.moveTargets.map((profile) => ({
          label: profile.name,
          act: () => {
            props.onMoveToProfile(profile.id);
            return "close";
          },
        }))
      : rootItems(props, () => setView("move"));

  // Focus enters the menu on open and on the move-targets drill-in.
  useEffect(() => {
    listRef.current?.querySelector("button")?.focus();
  }, [view]);

  const moveFocus = (delta: number) => {
    const buttons = [
      ...(listRef.current?.querySelectorAll("button") ?? []),
    ] as HTMLButtonElement[];
    const active = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = (active + delta + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div
      class="rule-menu"
      role="menu"
      aria-label={copy.rules.menuLabel(rule.header)}
      ref={listRef}
      onKeyDown={(event) => {
        // The open menu owns the keyboard; nothing leaks to the list or popup.
        event.stopPropagation();
        switch (event.key) {
          case "ArrowDown":
            moveFocus(1);
            break;
          case "ArrowUp":
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

function rootItems(props: RowMenuProps, descend: () => void): MenuItem[] {
  const close = (act: () => void) => () => {
    act();
    return "close" as const;
  };
  return [
    { label: copy.menu.edit, act: close(props.onEdit) },
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

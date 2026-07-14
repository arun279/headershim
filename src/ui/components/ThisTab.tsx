import { useId, useState } from "preact/hooks";
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
} from "../state/session-mutations";
import { HeaderFields } from "./HeaderFields";
import { sentence } from "./sentence";
import { Truncate } from "./Truncate";
import { useInlineCommit } from "./useInlineCommit";
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
  /** Promotes a temporary row into a real rule (pre-fills the editor). */
  onSaveAsRule: (override: TabOverride) => void;
  /** The standing honesty line's "Create a rule" action. */
  onCreateRule: () => void;
  /** Closes the composer without adding (Esc, or an empty focus-leave). */
  onCloseComposer: () => void;
}

/**
 * The This-tab section. Rows apply immediately with no permission
 * prompt — opening the popup is the activeTab consent gesture — and are marked
 * Temporary: they cover this tab's own origin only, end when the tab navigates
 * away or closes, and are suspended by global pause. Writes land in the session
 * store's metadata only; the background scheduler is the sole DNR writer. The
 * section stays hidden until it has a row or the composer is open.
 */
export function ThisTab(props: ThisTabProps) {
  const { tabId, host, overrides, composing } = props;
  if (overrides.length === 0 && !composing) {
    return null;
  }

  return (
    <section class="this-tab" aria-label={copy.thisTab.sectionLabel}>
      <p class="this-tab-head">
        <span class="silk">{copy.thisTab.sectionLabel}</span>
        {host !== undefined &&
          sentence(copy.thisTab.summary(host, overrides.length))}
      </p>

      <ul class="this-tab-rows">
        {overrides.map((override) => (
          <OverrideRow
            key={override.num}
            override={override}
            host={host ?? override.originHost}
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

      <p class="this-tab-note">
        {copy.thisTab.standingBefore}
        <button type="button" class="link-btn" onClick={props.onCreateRule}>
          {copy.thisTab.standingAction}
        </button>
        {copy.thisTab.standingAfter}
      </p>
    </section>
  );
}

function OverrideRow({
  override,
  host,
  onRemove,
  onSaveAsRule,
}: {
  override: TabOverride;
  host: string;
  onRemove: () => void;
  onSaveAsRule: () => void;
}) {
  return (
    <li class="this-tab-row">
      <span class="rule-dir">
        <span role="img" aria-label={copy.rules.direction[override.direction]}>
          {override.direction === "request" ? "→" : "←"}
        </span>
        <span class="rule-op">{copy.rules.operation[override.operation]}</span>
      </span>
      <div class="rule-lines">
        <p class="rule-line1">
          <Truncate value={override.header} class="rule-name" />
          {override.operation !== "remove" && override.value !== undefined && (
            <>
              <span class="colon">: </span>
              <Truncate
                mode="middle"
                value={override.value}
                class="rule-value"
              />
            </>
          )}
        </p>
        <p class="rule-line2">
          <span class="silk">{copy.rules.temporaryTag}</span>{" "}
          {sentence(copy.rules.temporary(host))}
        </p>
        <button
          type="button"
          class="link-btn save-as-rule"
          onClick={onSaveAsRule}
        >
          {copy.thisTab.saveAsRule}
        </button>
      </div>
      <button
        type="button"
        class="icon-btn this-tab-remove"
        aria-label={copy.thisTab.remove(override.header)}
        onClick={(event) => {
          focusOnRemoval(event.currentTarget);
          onRemove();
        }}
      >
        ✕
      </button>
    </li>
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
 * The inline composer for a new This-tab override. Same no-ceremony commit
 * model as the rule editor: Enter or focus-leave commits when the required
 * fields hold up, Esc reverts, and there is no Add button. Header validation
 * runs in the session write path; its errors and the session cap render inline.
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
  const { draft, draftRef, busyRef, rootRef, update, onKeyDown, onFocusOut } =
    useInlineCommit<Draft>(
      () => ({
        direction: "request",
        operation: "set",
        header: "",
        value: "",
      }),
      { commit, onClose, clearErrors: () => setErrors({}) },
    );

  return (
    <fieldset
      class="this-tab-composer inline-editor-well"
      ref={rootRef}
      onKeyDown={onKeyDown}
      onFocusOut={onFocusOut}
    >
      <legend class="silk">{copy.thisTab.composerTitle}</legend>

      <HeaderFields idBase={id} draft={draft} errors={errors} update={update} />

      {draft.operation !== "remove" && (
        <div class="editor-field">
          <label class="editor-label" for={`${id}-value`}>
            {copy.editor.labels.value}
          </label>
          <div class="editor-control">
            <input
              id={`${id}-value`}
              class="field mono"
              type="text"
              value={draft.value}
              onInput={(event) => {
                const value = event.currentTarget.value;
                update((current) => ({ ...current, value }));
              }}
            />
            {errors.value !== undefined && (
              <p class="editor-error" role="alert">
                {errors.value}
              </p>
            )}
          </div>
        </div>
      )}

      {errors.add !== undefined && (
        <p class="editor-error editor-error-global" role="alert">
          {errors.add}
        </p>
      )}
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

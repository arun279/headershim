import { useId, useRef, useState } from "preact/hooks";
import type {
  Direction,
  HeaderOp,
  ResourceGroup,
  Rule,
  RuleDraft,
  Scope,
} from "../../core/model";
import type { Result } from "../../core/result";
import { copy } from "../copy";
import type { MutationError } from "../state/mutations";
import { HeaderNameInput } from "./HeaderNameInput";
import { type ScopeDraft, ScopeEditor } from "./ScopeEditor";
import { ValueField } from "./ValueField";
import "./RuleEditor.css";

interface RuleEditorProps {
  /** Absent for a new rule. */
  rule?: Rule | undefined;
  /** Domain of the tab the popup opened on; pre-fills a new Domains scope. */
  prefillDomain?: string | undefined;
  onSave: (draft: RuleDraft) => Promise<Result<Rule, MutationError>>;
  /** Collapse: after a successful commit, or reverting via Esc. */
  onClose: () => void;
}

interface Draft {
  direction: Direction;
  operation: HeaderOp;
  header: string;
  value: string;
  generated: Rule["generated"] | undefined;
  scope: ScopeDraft;
  resourceTypes: ResourceGroup[] | "all";
  comment: string;
}

interface FieldErrors {
  name?: string;
  operation?: string;
  value?: string;
  scope?: string;
  types?: string;
  editor?: string;
}

/**
 * The inline editor. No save ceremony: Enter or focus-leave commits when the
 * required fields hold up, Esc reverts, and there is no Apply button anywhere.
 * Every blocking save rule renders its exact copy inline under the offending
 * field with the input preserved; an untouched editor abandons quietly when
 * focus leaves it.
 */
export function RuleEditor(props: RuleEditorProps) {
  const id = useId();
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const [draft, setDraftState] = useState(() =>
    initialDraft(props.rule, props.prefillDomain),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  // Handlers that fire mid-gesture (chip blur, then the editor's focus-leave
  // commit in the same event turn) must see each other's writes; state alone
  // only lands on the next render.
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);

  const update = (transform: (draft: Draft) => Draft) => {
    dirtyRef.current = true;
    draftRef.current = transform(draftRef.current);
    setDraftState(draftRef.current);
    setErrors({});
  };

  const commit = async () => {
    if (busyRef.current) {
      return;
    }
    const current = draftRef.current;
    const empties = emptyErrors(current);
    if (empties !== undefined) {
      setErrors(empties);
      return;
    }
    busyRef.current = true;
    try {
      const outcome = await props.onSave(toRuleDraft(current, props.rule));
      if (outcome.ok) {
        props.onClose();
        return;
      }
      const mapped = mapError(outcome.error, current.scope.type);
      if (mapped === "close") {
        props.onClose();
      } else {
        setErrors(mapped);
      }
    } finally {
      busyRef.current = false;
    }
  };

  const generate = (kind: "uuid" | "timestamp") => {
    const at = new Date().toISOString();
    update((current) => ({
      ...current,
      value: kind === "uuid" ? crypto.randomUUID() : at,
      generated: { kind, at },
    }));
  };

  const title =
    props.rule === undefined ? copy.editor.newRule : copy.editor.editRule;

  return (
    <fieldset
      class="rule-editor"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.defaultPrevented) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          // A commit in flight can't be unwound by closing; Esc waits it out
          // (success closes the editor itself, failure re-enables it).
          if (!busyRef.current) {
            props.onClose();
          }
          return;
        }
        const target =
          event.target instanceof HTMLElement ? event.target : null;
        if (event.key === "Enter") {
          // Enter on a button activates it; everywhere else it commits.
          if (target?.tagName !== "BUTTON") {
            event.preventDefault();
            void commit();
          }
          return;
        }
        // The open editor owns its keys: single-letter popup commands must
        // not fire from its buttons (segments, disclosure, chips, Insert).
        if (target?.tagName === "BUTTON" && /^[a-zA-Z0-9]$/.test(event.key)) {
          event.preventDefault();
        }
      }}
      onFocusOut={(event) => {
        const next = event.relatedTarget;
        if (
          !(next instanceof Node) ||
          rootRef.current?.contains(next) === true
        ) {
          return;
        }
        if (dirtyRef.current) {
          void commit();
        } else {
          props.onClose();
        }
      }}
    >
      <legend class="silk editor-title">{title}</legend>

      <div class="editor-field">
        <span class="editor-label" id={`${id}-dir`}>
          {copy.editor.labels.direction}
        </span>
        <div
          class="editor-control editor-radios"
          role="radiogroup"
          aria-labelledby={`${id}-dir`}
        >
          {(["request", "response"] as const).map((direction) => (
            <label class="editor-radio" key={direction}>
              <input
                type="radio"
                name={`${id}-dir`}
                checked={draft.direction === direction}
                onChange={() =>
                  update((current) => ({ ...current, direction }))
                }
              />
              {copy.editor.direction[direction]}
            </label>
          ))}
        </div>
      </div>

      <div class="editor-field">
        <label class="editor-label" for={`${id}-op`}>
          {copy.editor.labels.operation}
        </label>
        <div class="editor-control">
          <select
            id={`${id}-op`}
            class="field editor-select"
            value={draft.operation}
            onChange={(event) => {
              const { value } = event.currentTarget;
              if (value === "set" || value === "append" || value === "remove") {
                update((current) => ({ ...current, operation: value }));
              }
            }}
          >
            {(["set", "append", "remove"] as const).map((operation) => (
              <option value={operation} key={operation}>
                {copy.editor.operation[operation]}
              </option>
            ))}
          </select>
          {errors.operation !== undefined && (
            <p class="editor-error" role="alert">
              {errors.operation}
            </p>
          )}
        </div>
      </div>

      <HeaderNameInput
        value={draft.header}
        operation={draft.operation}
        error={errors.name}
        autoFocus
        onInput={(header) => update((current) => ({ ...current, header }))}
      />

      {draft.operation !== "remove" && (
        <ValueField
          value={draft.value}
          generated={draft.generated}
          frozenAt={
            draft.generated !== undefined &&
            draft.generated.at === props.rule?.generated?.at
              ? formatFrozenAt(draft.generated.at)
              : undefined
          }
          error={errors.value}
          onInput={(value) =>
            update((current) => ({ ...current, value, generated: undefined }))
          }
          onGenerate={generate}
        />
      )}

      <ScopeEditor
        scope={draft.scope}
        resourceTypes={draft.resourceTypes}
        error={errors.scope}
        typesError={errors.types}
        onScope={(scope) => update((current) => ({ ...current, scope }))}
        onResourceTypes={(resourceTypes) =>
          update((current) => ({ ...current, resourceTypes }))
        }
      />

      <div class="editor-field">
        <label class="editor-label" for={`${id}-comment`}>
          {copy.editor.labels.comment}
        </label>
        <div class="editor-control">
          <input
            id={`${id}-comment`}
            class="field"
            type="text"
            value={draft.comment}
            onInput={(event) => {
              const comment = event.currentTarget.value;
              update((current) => ({ ...current, comment }));
            }}
          />
        </div>
      </div>

      {errors.editor !== undefined && (
        <p class="editor-error editor-error-global" role="alert">
          {errors.editor}
        </p>
      )}
    </fieldset>
  );
}

function initialDraft(
  rule: Rule | undefined,
  prefillDomain: string | undefined,
): Draft {
  if (rule === undefined) {
    return {
      direction: "request",
      operation: "set",
      header: "",
      value: "",
      generated: undefined,
      scope: {
        type: "domains",
        domains: prefillDomain === undefined ? [] : [prefillDomain],
        pattern: "",
        regex: "",
      },
      resourceTypes: "all",
      comment: "",
    };
  }
  return {
    direction: rule.direction,
    operation: rule.operation,
    header: rule.header,
    value: rule.value ?? "",
    generated: rule.generated,
    scope: {
      type: rule.scope.type,
      domains: rule.scope.type === "domains" ? [...rule.scope.domains] : [],
      pattern: rule.scope.type === "pattern" ? rule.scope.pattern : "",
      regex: rule.scope.type === "regex" ? rule.scope.regex : "",
    },
    resourceTypes:
      rule.resourceTypes === "all" ? "all" : [...rule.resourceTypes],
    comment: rule.comment ?? "",
  };
}

/** Required-field gaps get their message before the store is even asked. */
function emptyErrors(draft: Draft): FieldErrors | undefined {
  const errors: FieldErrors = {};
  if (draft.header.trim() === "") {
    errors.name = copy.errors.headerNameRequired;
  }
  if (draft.operation !== "remove" && draft.value === "") {
    errors.value = copy.errors.valueRequired;
  }
  if (draft.scope.type === "domains" && draft.scope.domains.length === 0) {
    errors.scope = copy.errors.scopeEmpty.domains;
  } else if (
    draft.scope.type === "pattern" &&
    draft.scope.pattern.trim() === ""
  ) {
    errors.scope = copy.errors.scopeEmpty.pattern;
  } else if (draft.scope.type === "regex" && draft.scope.regex.trim() === "") {
    errors.scope = copy.errors.scopeEmpty.regex;
  }
  if (draft.resourceTypes !== "all" && draft.resourceTypes.length === 0) {
    errors.types = copy.errors.scopeEmpty.resourceTypes;
  }
  return Object.keys(errors).length === 0 ? undefined : errors;
}

function mapError(
  error: MutationError,
  scopeType: ScopeDraft["type"],
): FieldErrors | "close" {
  switch (error.kind) {
    case "name-required":
      return { name: copy.errors.headerNameRequired };
    case "name-invalid":
      return { name: copy.errors.headerNameInvalid };
    case "name-not-modifiable":
      return { name: copy.errors.headerNotModifiable };
    case "value-required":
      return { value: copy.errors.valueRequired };
    case "value-line-break":
      return { value: copy.errors.valueLineBreak };
    case "request-append-not-allowed":
      return { operation: copy.errors.appendDisallowed(error.header) };
    case "regex-invalid":
      // Chrome's validator distinguishes an oversized compilation from a
      // dialect error; the fix directions differ.
      return {
        scope:
          error.reason === "memoryLimitExceeded"
            ? copy.errors.regexOversize
            : copy.errors.regexInvalid,
      };
    case "scope-empty":
      return { scope: copy.errors.scopeEmpty[scopeType] };
    case "enabled-rule-limit-exceeded":
      return { editor: copy.errors.ruleCap };
    case "regex-rule-limit-exceeded":
      return { editor: copy.errors.regexRuleCap };
    case "doc-byte-limit-exceeded":
      return { editor: copy.errors.storageBudget };
    // The rule's home vanished under a concurrent edit; the re-rendered
    // list is the truth, so the editor bows out.
    case "session-override-limit-exceeded":
    case "profile-name-unavailable":
    case "not-found":
    case "store-unavailable":
      return "close";
  }
}

function toRuleDraft(draft: Draft, rule: Rule | undefined): RuleDraft {
  const comment = draft.comment.trim();
  return {
    direction: draft.direction,
    operation: draft.operation,
    header: draft.header,
    ...(draft.operation === "remove" ? {} : { value: draft.value }),
    scope: toScope(draft.scope, rule),
    resourceTypes: draft.resourceTypes,
    initiators: rule === undefined ? [] : [...rule.initiators],
    enabled: rule?.enabled ?? true,
    ...(comment === "" ? {} : { comment }),
    ...(draft.generated === undefined || draft.operation === "remove"
      ? {}
      : { generated: draft.generated }),
  };
}

function toScope(scope: ScopeDraft, rule: Rule | undefined): Scope {
  switch (scope.type) {
    case "domains":
      return { type: "domains", domains: [...scope.domains] };
    case "pattern":
      return {
        type: "pattern",
        pattern: scope.pattern,
        hosts: keptHosts(rule, "pattern"),
      };
    case "regex":
      return {
        type: "regex",
        regex: scope.regex,
        hosts: keptHosts(rule, "regex"),
      };
    case "all":
      return { type: "all" };
  }
}

/** Grant hosts collected for a pattern/regex scope survive edits of the same type. */
function keptHosts(
  rule: Rule | undefined,
  type: "pattern" | "regex",
): string[] {
  return rule !== undefined && rule.scope.type === type
    ? [...rule.scope.hosts]
    : [];
}

/** "2026-07-12T14:03:27.000Z" → "2026-07-12 14:03 UTC" (the designed reading). */
function formatFrozenAt(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

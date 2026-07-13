import { useId, useRef, useState } from "preact/hooks";
import {
  coversSubresourceTypes,
  type GrantSnapshot,
  missingGrants,
  originGranted,
} from "../../core/grants";
import type {
  Direction,
  HeaderOp,
  ResourceGroup,
  Rule,
  RuleDraft,
  Scope,
} from "../../core/model";
import type { Result } from "../../core/result";
import { originPatternForDomain } from "../../core/scope";
import { copy } from "../copy";
import type { MutationError } from "../state/mutations";
import {
  GrantPanel,
  type GrantSelection,
  type InitiatorControl,
} from "./GrantPanel";
import { HeaderNameInput } from "./HeaderNameInput";
import { type ScopeDraft, ScopeEditor } from "./ScopeEditor";
import { ValueField } from "./ValueField";
import "./RuleEditor.css";

interface RuleEditorProps {
  /** Absent for a new rule. */
  rule?: Rule | undefined;
  /** Domain of the tab the popup opened on; pre-fills a new Domains scope. */
  prefillDomain?: string | undefined;
  /** Live grant snapshot, so the grant moment (§3.1) fires only when needed. */
  grants: GrantSnapshot;
  /** Origin of the tab the popup opened on: the inferred initiator (§3.3). */
  tabDomain?: string | undefined;
  onSave: (
    ruleId: string | undefined,
    draft: RuleDraft,
  ) => Promise<Result<Rule, MutationError>>;
  /** Fires the in-gesture permission prompt; resolves to Chrome's decision. */
  onRequestGrant: (origins: string[]) => Promise<boolean>;
  /** A grant landed: the now-active sites, for the "Active on …" toast. */
  onGranted?: (sites: readonly string[]) => void;
  /** Collapse: after a successful commit, or reverting via Esc. */
  onClose: () => void;
}

interface GrantStep {
  rule: Rule;
  scopeType: Scope["type"];
  targets: string[];
  editableTargets: boolean;
  targetPrefill: string[];
  initiator: InitiatorControl;
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
  const [grantStep, setGrantStep] = useState<GrantStep | undefined>(undefined);
  // Handlers that fire mid-gesture (chip blur, then the editor's focus-leave
  // commit in the same event turn) must see each other's writes; state alone
  // only lands on the next render.
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  // The saved rule's id survives a new-rule commit so the grant step can persist
  // its collected sites onto that same rule rather than creating a second one.
  const savedIdRef = useRef(props.rule?.id);
  const grantOpenRef = useRef(false);
  grantOpenRef.current = grantStep !== undefined;

  const update = (transform: (draft: Draft) => Draft) => {
    dirtyRef.current = true;
    draftRef.current = transform(draftRef.current);
    setDraftState(draftRef.current);
    setErrors({});
  };

  const commit = async (grantImmediately = false) => {
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
      const outcome = await props.onSave(
        savedIdRef.current,
        toRuleDraft(current, props.rule),
      );
      if (!outcome.ok) {
        const mapped = mapError(outcome.error, current.scope.type);
        if (mapped === "close") {
          props.onClose();
        } else {
          setErrors(mapped);
        }
        return;
      }
      const saved = outcome.value;
      savedIdRef.current = saved.id;
      const step = planGrant(saved, props.grants, props.tabDomain);
      if (step === undefined) {
        props.onClose();
        return;
      }
      setGrantStep(step);
      if (grantImmediately) {
        // Ctrl/Cmd+Enter: prompt in the same gesture, with the panel's defaults.
        allow(step, defaultSelection(step));
      }
    } finally {
      busyRef.current = false;
    }
  };

  // The permission prompt is created synchronously here so it stays inside the
  // click/keydown gesture; the store write and the prompt's outcome are awaited
  // afterwards. Granting a host permission itself never recompiles — the
  // permissions.onChanged event drives only the badge (background lifecycle).
  const allow = (step: GrantStep, selection: GrantSelection) => {
    const origins = [
      ...new Set(
        [...selection.targetHosts, ...selection.initiators].map(
          originPatternForDomain,
        ),
      ),
    ];
    const granted =
      origins.length === 0
        ? Promise.resolve(true)
        : props.onRequestGrant(origins);
    void finishGrant(step.rule, selection, granted);
  };

  const finishGrant = async (
    rule: Rule,
    selection: GrantSelection,
    granted: Promise<boolean>,
  ) => {
    const persisted = withGrantScope(rule, selection);
    if (persisted !== undefined) {
      // Best-effort: the grant itself has already landed, and the loud surfaces
      // read the live permission snapshot, not this write. A rare failure here
      // (byte budget, a concurrent edit) leaves the rule running but its granted
      // sites unrecorded, so a later revoke can't relight it — no worse than the
      // grant never having been offered, and nothing the closing popup can undo.
      await props.onSave(rule.id, persisted);
    }
    const sites = [
      ...new Set([...selection.targetHosts, ...selection.initiators]),
    ];
    if ((await granted) && sites.length > 0) {
      props.onGranted?.(sites);
    }
    props.onClose();
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
          // Enter on a button activates it; everywhere else it commits. The open
          // grant panel owns its own Ctrl/Cmd+Enter (it grants with the sites as
          // edited), so this only reaches the field editor before that step.
          if (target?.tagName !== "BUTTON") {
            event.preventDefault();
            void commit(event.metaKey || event.ctrlKey);
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
        // Focus leaving during the grant step abandons it: the rule is already
        // saved and loud, and the annunciator's Grant access re-offers the prompt.
        if (grantOpenRef.current) {
          props.onClose();
        } else if (dirtyRef.current) {
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

      {grantStep !== undefined && (
        <GrantPanel
          scopeType={grantStep.scopeType}
          targetHosts={grantStep.targets}
          editableTargets={grantStep.editableTargets}
          targetPrefill={grantStep.targetPrefill}
          initiator={grantStep.initiator}
          onAllow={(selection) => allow(grantStep, selection)}
          onNotNow={props.onClose}
          onAllSites={props.onClose}
        />
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

/**
 * Whether a just-committed rule still needs a grant the popup can prompt for,
 * and the shape of the panel that collects it. All-sites scopes route through
 * the buried options flow (§3.4), never a popup prompt; a fully-granted rule
 * needs no panel at all.
 */
function planGrant(
  rule: Rule,
  grants: GrantSnapshot,
  tabDomain: string | undefined,
): GrantStep | undefined {
  if (grants.allSites || rule.scope.type === "all") {
    return undefined;
  }
  const covers = coversSubresourceTypes(rule);
  const { scope } = rule;

  if (scope.type === "pattern" || scope.type === "regex") {
    const initiator: InitiatorControl = covers
      ? {
          kind: "chips",
          prefill: tabDomain !== undefined ? [tabDomain] : [...rule.initiators],
        }
      : { kind: "none" };
    // A configured pattern rule whose named hosts are all granted asks nothing
    // — unless the inferred initiator page is a still-ungranted subresource gap.
    if (
      scope.hosts.length > 0 &&
      missingGrants(rule, grants).length === 0 &&
      !initiatorNeedsGrant(initiator, grants)
    ) {
      return undefined;
    }
    return {
      rule,
      scopeType: scope.type,
      targets: [],
      editableTargets: true,
      targetPrefill: tabDomain !== undefined ? [tabDomain] : [...scope.hosts],
      initiator,
    };
  }

  const targets = [...scope.domains];
  const initiator = domainInitiator(rule, tabDomain, covers, targets);
  // The target domains can already be granted while the inferred initiator page
  // isn't: a cross-host subresource rule still needs that page granted to run,
  // and the rule's own initiators list can't reveal a page it hasn't recorded.
  if (
    missingGrants(rule, grants).length === 0 &&
    !initiatorNeedsGrant(initiator, grants)
  ) {
    return undefined;
  }
  return {
    rule,
    scopeType: "domains",
    targets,
    editableTargets: false,
    targetPrefill: [],
    initiator,
  };
}

/** An inferred initiator worth a panel: one whose host isn't granted yet. */
function initiatorNeedsGrant(
  initiator: InitiatorControl,
  grants: GrantSnapshot,
): boolean {
  switch (initiator.kind) {
    case "checkbox":
      return !originGranted(initiator.host, grants);
    case "chips":
      return initiator.prefill.some((host) => !originGranted(host, grants));
    case "none":
      return false;
  }
}

/**
 * §3.3's honest split for a Domains rule reaching subresources: pre-check the
 * tab's own origin when it differs from the target (the inferred initiator);
 * offer an explicit optional input when no page context could be captured;
 * ask nothing when the rule stays on navigations or the tab is the target.
 */
function domainInitiator(
  rule: Rule,
  tabDomain: string | undefined,
  covers: boolean,
  targets: readonly string[],
): InitiatorControl {
  if (!covers) {
    return { kind: "none" };
  }
  if (tabDomain === undefined) {
    return { kind: "chips", prefill: [...rule.initiators] };
  }
  if (!targets.includes(tabDomain)) {
    return {
      kind: "checkbox",
      host: tabDomain,
      target: targets[0] ?? tabDomain,
    };
  }
  return { kind: "none" };
}

function defaultSelection(step: GrantStep): GrantSelection {
  return {
    targetHosts: step.editableTargets
      ? [...step.targetPrefill]
      : [...step.targets],
    initiators:
      step.initiator.kind === "checkbox"
        ? [step.initiator.host]
        : step.initiator.kind === "chips"
          ? [...step.initiator.prefill]
          : [],
  };
}

/**
 * The rule draft that records what the grant panel collected — target hosts on
 * a pattern/regex scope, initiators on the rule — or undefined when the
 * selection adds nothing new. Target hosts drive grant computation alone;
 * initiators also narrow the match to those pages (initiatorDomains), so a
 * newly named initiator recompiles the rule while a new target host does not.
 */
function withGrantScope(
  rule: Rule,
  selection: GrantSelection,
): RuleDraft | undefined {
  const addedInitiators = selection.initiators.filter(
    (host) => !rule.initiators.includes(host),
  );
  const { scope } = rule;
  const addedHosts =
    scope.type === "pattern" || scope.type === "regex"
      ? selection.targetHosts.filter((host) => !scope.hosts.includes(host))
      : [];
  if (addedInitiators.length === 0 && addedHosts.length === 0) {
    return undefined;
  }
  const { id: _id, num: _num, ...draft } = rule;
  return {
    ...draft,
    scope:
      scope.type === "pattern" || scope.type === "regex"
        ? { ...scope, hosts: [...scope.hosts, ...addedHosts] }
        : scope,
    initiators: [...rule.initiators, ...addedInitiators],
  };
}

/** "2026-07-12T14:03:27.000Z" → "2026-07-12 14:03 UTC" (the designed reading). */
function formatFrozenAt(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

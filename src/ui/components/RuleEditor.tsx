import { useEffect, useId, useRef, useState } from "preact/hooks";
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
import { copy } from "../copy";
import {
  headerErrorToFieldError,
  headerValueEmptyErrors,
} from "../state/header-errors";
import type { MutationError } from "../state/mutations";
import { AdvisorySlot } from "./AdvisorySlot";
import { Button } from "./Button";
import { handleEditorCommitKey } from "./editorKeys";
import {
  GrantPanel,
  type GrantSelection,
  type InitiatorControl,
} from "./GrantPanel";
import { HeaderFields } from "./HeaderFields";
import { type ScopeDraft, ScopeEditor } from "./ScopeEditor";
import { Sheet } from "./Sheet";
import { useDraftState } from "./useDraftState";
import { ValueField } from "./ValueField";
import "./RuleEditor.css";

interface RuleEditorProps {
  profileName: string;
  /** Absent for a new rule. */
  rule?: Rule | undefined;
  /** Domain of the tab the popup opened on; pre-fills a new Domains scope. */
  prefillDomain?: string | undefined;
  /**
   * A full draft to seed a new rule from — the This-tab "Save as rule…" path
   * hands over the whole override. Ignored when editing a rule.
   */
  prefill?: RuleDraft | undefined;
  /** Live grant snapshot, so the grant moment fires only when needed. */
  grants: GrantSnapshot;
  /** Origin of the tab the popup opened on: the inferred initiator. */
  tabDomain?: string | undefined;
  onSave: (
    ruleId: string | undefined,
    draft: RuleDraft,
  ) => Promise<Result<Rule, MutationError>>;
  /** Fires the in-gesture permission prompt; resolves to Chrome's decision. */
  onRequestGrant: (origins: string[]) => Promise<boolean>;
  /** A grant landed: the now-active sites, for the "Active on …" toast. */
  onGranted?: (sites: readonly string[]) => void;
  onCommitted?: (kind: "create" | "edit") => void;
  /** The saved rule needs a grant step; clears messaging outside the sheet. */
  onGrantStep?: () => void;
  onDiscardRule: (ruleId: string) => Promise<void>;
  /** Collapse: after a successful commit, or reverting via Esc. */
  onClose: () => void;
  /** Options hosts the same editor inline instead of as a modal popup mode. */
  modal?: boolean | undefined;
  /** A parent-owned close request, such as choosing another options profile. */
  closeRequest?: number | undefined;
  /** The requested close was cancelled in the dirty-draft confirmation. */
  onCloseRequestCancelled?: (() => void) | undefined;
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

/** Full-popup rule editor with explicit save, guarded discard, and grant steps. */
export function RuleEditor(props: RuleEditorProps) {
  const id = useId();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [grantStep, setGrantStep] = useState<GrantStep | undefined>(undefined);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const previousCloseRequest = useRef(props.closeRequest);
  // The saved rule's id survives a new-rule commit so the grant step can persist
  // its collected sites onto that same rule rather than creating a second one.
  const savedIdRef = useRef(props.rule?.id);
  const { draft, draftRef, dirtyRef, busyRef, update } = useDraftState<Draft>(
    () => initialDraft(props.rule, props.prefillDomain, props.prefill),
    () => setErrors({}),
  );

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
    setBusy(true);
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
        props.onCommitted?.(props.rule === undefined ? "create" : "edit");
        props.onClose();
        return;
      }
      props.onGrantStep?.();
      setGrantStep(step);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const allow = (
    step: GrantStep,
    selection: GrantSelection,
    granted: Promise<boolean>,
  ) => {
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

  const requestClose = () => {
    if (busyRef.current) {
      return;
    }
    if (grantStep !== undefined || !dirtyRef.current) {
      props.onClose();
      return;
    }
    setConfirmDiscard(true);
  };

  const keepEditing = () => {
    setConfirmDiscard(false);
    props.onCloseRequestCancelled?.();
    queueMicrotask(() => initialFocusRef.current?.focus());
  };

  useEffect(() => {
    if (props.closeRequest === previousCloseRequest.current) {
      return;
    }
    previousCloseRequest.current = props.closeRequest;
    requestClose();
  }, [props.closeRequest]);

  useEffect(() => {
    if (confirmDiscard) {
      keepEditingRef.current?.focus();
    }
  }, [confirmDiscard]);

  const discardSavedRule = () => {
    if (grantStep === undefined || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    void props
      .onDiscardRule(grantStep.rule.id)
      .then(props.onClose)
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (confirmDiscard) {
        keepEditing();
      } else {
        requestClose();
      }
      return;
    }
    if (grantStep !== undefined) {
      return;
    }
    if (handleEditorCommitKey(event, () => void commit())) {
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (
      event.key === "Enter" &&
      target?.classList.contains("editor-commit-field") === true
    ) {
      event.preventDefault();
      void commit();
      return;
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

  const mode = props.rule === undefined ? "new" : "edit";
  const title = copy.editor.heading(mode, props.profileName);
  const saveLabel =
    mode === "new" ? copy.actions.createRule : copy.actions.saveChanges;

  return (
    <Sheet
      label={title}
      class="editor-sheet"
      modal={props.modal ?? true}
      initialFocus={initialFocusRef}
      onKeyDown={onKeyDown}
      header={
        <>
          <h1 class="editor-title">
            <span aria-hidden="true">‹</span> {title}
          </h1>
          <Button kind="ghost" label={copy.editor.close} onClick={requestClose}>
            <span aria-hidden="true">✕</span>
          </Button>
        </>
      }
      pinned={
        grantStep === undefined ? (
          <>
            <AdvisorySlot header={draft.header} />
            <div class="editor-actions">
              {confirmDiscard ? (
                <>
                  <strong class="discard-title">
                    {copy.editor.discardConfirm.title}
                  </strong>
                  <button
                    type="button"
                    class="editor-cancel"
                    ref={keepEditingRef}
                    onClick={keepEditing}
                  >
                    {copy.editor.discardConfirm.keepEditing}
                  </button>
                  <Button kind="quiet" onClick={props.onClose}>
                    {copy.editor.discardConfirm.discard}
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    class="editor-cancel"
                    onClick={requestClose}
                  >
                    {copy.actions.cancel}
                  </button>
                  <Button
                    kind="primary"
                    disabled={busy}
                    onClick={() => void commit()}
                  >
                    {saveLabel}
                  </Button>
                </>
              )}
            </div>
          </>
        ) : undefined
      }
    >
      <div class="rule-editor">
        {grantStep === undefined ? (
          <>
            <HeaderFields
              idBase={id}
              draft={draft}
              errors={errors}
              nameInputRef={(element) => {
                initialFocusRef.current = element;
              }}
              update={update}
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
                  update((current) => ({
                    ...current,
                    value,
                    generated: undefined,
                  }))
                }
                onGenerate={generate}
              />
            )}

            <ScopeEditor
              scope={draft.scope}
              resourceTypes={draft.resourceTypes}
              error={errors.scope}
              typesError={errors.types}
              defaultResourceTypesOpen={
                props.rule !== undefined && props.rule.resourceTypes !== "all"
              }
              suggestedDomain={props.prefillDomain}
              onScope={(scope) => update((current) => ({ ...current, scope }))}
              onResourceTypes={(resourceTypes) =>
                update((current) => ({ ...current, resourceTypes }))
              }
              onCommit={() => void commit()}
            />

            <CommentDisclosure
              id={`${id}-comment`}
              value={draft.comment}
              onInput={(comment) =>
                update((current) => ({ ...current, comment }))
              }
            />

            {errors.editor !== undefined && (
              <p class="editor-error editor-error-global" role="alert">
                {errors.editor}
              </p>
            )}
          </>
        ) : (
          <GrantPanel
            scopeType={grantStep.scopeType}
            targetHosts={grantStep.targets}
            editableTargets={grantStep.editableTargets}
            targetPrefill={grantStep.targetPrefill}
            initiator={grantStep.initiator}
            created={props.rule === undefined}
            onRequestGrant={props.onRequestGrant}
            onAllow={(selection, granted) =>
              allow(grantStep, selection, granted)
            }
            onGrantLater={props.onClose}
            onDiscardRule={discardSavedRule}
            onAllSites={props.onClose}
          />
        )}
      </div>
    </Sheet>
  );
}

function CommentDisclosure({
  id,
  value,
  onInput,
}: {
  id: string;
  value: string;
  onInput: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = value.trim();
  return (
    <div class="editor-option">
      <button
        type="button"
        class="disclosure"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        title={summary === "" ? undefined : summary}
        onClick={() => setOpen((current) => !current)}
      >
        {copy.editor.labels.comment}
        {summary === "" ? "" : ` · ${summary}`}{" "}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={`${id}-panel`}>
          <label class="sr-only" for={id}>
            {copy.editor.labels.comment}
          </label>
          <input
            id={id}
            class="field editor-commit-field"
            type="text"
            value={value}
            onInput={(event) => onInput(event.currentTarget.value)}
          />
        </div>
      )}
    </div>
  );
}

function initialDraft(
  rule: Rule | undefined,
  prefillDomain: string | undefined,
  prefill: RuleDraft | undefined,
): Draft {
  const source = rule ?? prefill;
  if (source === undefined) {
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
    direction: source.direction,
    operation: source.operation,
    header: source.header,
    value: source.value ?? "",
    generated: source.generated,
    scope: {
      type: source.scope.type,
      domains: source.scope.type === "domains" ? [...source.scope.domains] : [],
      pattern: source.scope.type === "pattern" ? source.scope.pattern : "",
      regex: source.scope.type === "regex" ? source.scope.regex : "",
    },
    resourceTypes:
      source.resourceTypes === "all" ? "all" : [...source.resourceTypes],
    comment: source.comment ?? "",
  };
}

/** Required-field gaps get their message before the store is even asked. */
function emptyErrors(draft: Draft): FieldErrors | undefined {
  const errors: FieldErrors = { ...headerValueEmptyErrors(draft) };
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
    case "name-invalid":
    case "name-not-modifiable":
    case "value-required":
    case "value-line-break":
    case "request-append-not-allowed":
      return headerErrorToFieldError(error);
    case "regex-invalid":
      // Chrome's validator distinguishes an oversized compilation from a
      // dialect error; the fix directions differ.
      return {
        scope:
          error.reason === "memoryLimitExceeded"
            ? copy.errors.regexOversize
            : copy.errors.regexInvalid,
      };
    case "pattern-invalid":
      return { scope: copy.errors.patternInvalid };
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
 * the buried options flow, never a popup prompt; a fully-granted rule
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
 * The honest split for a Domains rule reaching subresources: pre-check the
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

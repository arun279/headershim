import { useEffect, useId, useRef, useState } from "preact/hooks";
import {
  ALL_SITES_ORIGIN,
  type GrantSnapshot,
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
import {
  headerErrorToFieldError,
  headerValueEmptyErrors,
} from "../state/header-errors";
import type { MutationError } from "../state/mutations";
import { AdvisorySlot } from "./AdvisorySlot";
import { Button } from "./Button";
import { handleEditorCommitKey } from "./editorKeys";
import { CloseGlyph } from "./glyphs";
import { HeaderFields } from "./HeaderFields";
import { HeaderLineFields } from "./HeaderLineFields";
import { type ScopeDraft, ScopeEditor } from "./ScopeEditor";
import { Sheet } from "./Sheet";
import { useDraftState } from "./useDraftState";
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
  /** Fires the permission prompt after a successful save. */
  onRequestGrant: (origins: string[]) => Promise<boolean>;
  /** A grant landed: the sites named by the result message. */
  onGranted?: (sites: readonly string[]) => void;
  /** The rule was saved, but the permission prompt was declined. */
  onGrantDeclined?: (host: string) => void;
  onCommitted?: (kind: "create" | "edit") => void;
  /** Collapse: after a successful commit, or reverting via Esc. */
  onClose: () => void;
  /** Options hosts the same editor inline instead of as a modal popup mode. */
  modal?: boolean | undefined;
  /** A parent-owned close request, such as choosing another options profile. */
  closeRequest?: number | undefined;
  /** The requested close was cancelled in the dirty-draft confirmation. */
  onCloseRequestCancelled?: (() => void) | undefined;
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

interface CommitGrant {
  draft: RuleDraft;
  host: string;
  origins: string[];
  sites: string[];
}

/** Full-popup rule editor with explicit save and guarded discard. */
export function RuleEditor(props: RuleEditorProps) {
  const id = useId();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const previousCloseRequest = useRef(props.closeRequest);
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
    const ruleDraft = toRuleDraft(current, props.rule);
    const grant = planCommitGrant(ruleDraft, props.grants, props.tabDomain);
    busyRef.current = true;
    setBusy(true);
    try {
      const outcome = await props.onSave(
        props.rule?.id,
        grant?.draft ?? ruleDraft,
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
      let granted: boolean | undefined;
      if (grant !== undefined) {
        try {
          granted = await props.onRequestGrant(grant.origins);
        } catch {
          granted = false;
        }
      }
      props.onCommitted?.(props.rule === undefined ? "create" : "edit");
      if (grant !== undefined) {
        if (granted === true) {
          props.onGranted?.(grant.sites);
        } else {
          props.onGrantDeclined?.(grant.host);
        }
      }
      props.onClose();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const requestClose = () => {
    if (busyRef.current) {
      return;
    }
    if (!dirtyRef.current) {
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
    if (handleEditorCommitKey(event, () => void commit())) {
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
  const commitGrant = planCommitGrant(
    toRuleDraft(draft, props.rule),
    props.grants,
    props.tabDomain,
  );
  const saveLabel =
    commitGrant === undefined
      ? mode === "new"
        ? copy.actions.createRule
        : copy.actions.saveChanges
      : mode === "new"
        ? copy.actions.createRuleAndAllow(commitGrant.host)
        : copy.actions.saveChangesAndAllow(commitGrant.host);

  return (
    <Sheet
      label={title}
      class="editor-sheet editor-sheet-with-footer"
      modal={props.modal ?? true}
      initialFocus={initialFocusRef}
      onKeyDown={onKeyDown}
      header={
        <>
          <Button kind="ghost" label={copy.editor.close} onClick={requestClose}>
            <CloseGlyph />
          </Button>
          <h1 class="editor-title">{title}</h1>
        </>
      }
      pinned={
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
      }
    >
      <div class="rule-editor">
        <HeaderFields
          idBase={id}
          draft={draft}
          errors={errors}
          update={update}
        />

        <HeaderLineFields
          header={draft.header}
          value={draft.value}
          remove={draft.operation === "remove"}
          generated={draft.generated}
          frozenAt={
            draft.generated !== undefined &&
            draft.generated.at === props.rule?.generated?.at
              ? formatFrozenAt(draft.generated.at)
              : undefined
          }
          generatedActions={false}
          nameError={errors.name}
          valueError={errors.value}
          nameInputRef={(element) => {
            initialFocusRef.current = element;
          }}
          onHeaderInput={(header) =>
            update((current) => ({ ...current, header }))
          }
          onValueInput={(value) =>
            update((current) => ({
              ...current,
              value,
              generated: undefined,
            }))
          }
          onGenerate={generate}
        />

        <ScopeEditor
          scope={draft.scope}
          resourceTypes={draft.resourceTypes}
          error={errors.scope}
          typesError={errors.types}
          defaultResourceTypesOpen={
            props.rule !== undefined && props.rule.resourceTypes !== "all"
          }
          onScope={(scope) => update((current) => ({ ...current, scope }))}
          onResourceTypes={(resourceTypes) =>
            update((current) => ({ ...current, resourceTypes }))
          }
        />

        {draft.operation !== "remove" && (
          <GeneratedValueDisclosure
            id={`${id}-generated`}
            generated={draft.generated}
            frozenAt={
              draft.generated !== undefined &&
              draft.generated.at === props.rule?.generated?.at
                ? formatFrozenAt(draft.generated.at)
                : undefined
            }
            onGenerate={generate}
          />
        )}

        <CommentDisclosure
          id={`${id}-comment`}
          value={draft.comment}
          onInput={(comment) => update((current) => ({ ...current, comment }))}
        />

        {errors.editor !== undefined && (
          <p class="editor-error editor-error-global" role="alert">
            {errors.editor}
          </p>
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
        <span>
          {copy.editor.labels.comment}
          {summary === "" ? "" : ` · ${summary}`}
        </span>
        <span
          class={open ? "disclosure-chevron open" : "disclosure-chevron"}
          aria-hidden="true"
        >
          ›
        </span>
      </button>
      {open && (
        <div id={`${id}-panel`}>
          <label class="sr-only" for={id}>
            {copy.editor.labels.comment}
          </label>
          <input
            id={id}
            class="field"
            type="text"
            value={value}
            onInput={(event) => onInput(event.currentTarget.value)}
          />
        </div>
      )}
    </div>
  );
}

function GeneratedValueDisclosure({
  id,
  generated,
  frozenAt,
  onGenerate,
}: {
  id: string;
  generated: Rule["generated"] | undefined;
  frozenAt: string | undefined;
  onGenerate: (kind: "uuid" | "timestamp") => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div class="editor-option">
      <button
        type="button"
        class="disclosure"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          {copy.editor.labels.generatedValue}
          {generated === undefined
            ? ""
            : ` · ${copy.editor.generatedKind[generated.kind]}`}
        </span>
        <span
          class={open ? "disclosure-chevron open" : "disclosure-chevron"}
          aria-hidden="true"
        >
          ›
        </span>
      </button>
      {open && (
        <div class="generated-value-panel" id={`${id}-panel`}>
          <div class="generated-value-actions">
            <Button kind="quiet" onClick={() => onGenerate("uuid")}>
              {copy.editor.insertUuid}
            </Button>
            <Button kind="quiet" onClick={() => onGenerate("timestamp")}>
              {copy.editor.insertTimestamp}
            </Button>
          </div>
          {generated !== undefined && (
            <p class="editor-micro">
              {frozenAt === undefined
                ? copy.generatedValue.note
                : copy.generatedValue.frozen(frozenAt)}
            </p>
          )}
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

/** Builds the permission request and the rule metadata committed with it. */
function planCommitGrant(
  draft: RuleDraft,
  grants: GrantSnapshot,
  tabDomain: string | undefined,
): CommitGrant | undefined {
  if (grants.allSites) {
    return undefined;
  }
  if (draft.scope.type === "all") {
    return {
      draft,
      host: copy.scopeSummary.allSites,
      origins: [ALL_SITES_ORIGIN],
      sites: [copy.scopeSummary.allSites],
    };
  }
  const scope = withInferredGrantHost(draft.scope);
  const targets = targetHosts(scope);
  if (targets.length === 0) {
    return undefined;
  }
  const reachesSubresources =
    draft.resourceTypes === "all" ||
    draft.resourceTypes.some(
      (group) => group !== "pages" && group !== "subframes",
    );
  const inferredInitiator =
    reachesSubresources &&
    tabDomain !== undefined &&
    !targets.includes(tabDomain)
      ? tabDomain
      : undefined;
  const initiators = unique([
    ...draft.initiators,
    ...(inferredInitiator === undefined ? [] : [inferredInitiator]),
  ]);
  const sites = unique([
    ...targets,
    ...(reachesSubresources ? initiators : []),
  ]);
  const missing = sites.filter((site) => !originGranted(site, grants));
  if (missing.length === 0) {
    return undefined;
  }
  const firstTarget = targets.find((target) => missing.includes(target));
  return {
    draft: { ...draft, scope, initiators },
    host: firstTarget ?? (missing[0] as string),
    origins: missing.map(originPatternForDomain),
    sites: missing,
  };
}

function withInferredGrantHost(scope: Scope): Scope {
  switch (scope.type) {
    case "domains":
    case "all":
      return scope;
    case "pattern": {
      if (scope.hosts.length > 0) return scope;
      const host = patternHost(scope.pattern);
      return host === undefined ? scope : { ...scope, hosts: [host] };
    }
    case "regex": {
      if (scope.hosts.length > 0) return scope;
      const host = regexHost(scope.regex);
      return host === undefined ? scope : { ...scope, hosts: [host] };
    }
  }
}

function targetHosts(scope: Scope): string[] {
  switch (scope.type) {
    case "domains":
      return [...scope.domains];
    case "pattern":
    case "regex":
      return [...scope.hosts];
    case "all":
      return [];
  }
}

function patternHost(pattern: string): string | undefined {
  const match =
    /^\|\|([a-z0-9.-]+)/i.exec(pattern.trim()) ??
    /^\|?https?:\/\/([a-z0-9.-]+)/i.exec(pattern.trim());
  return normalizedHost(match?.[1]);
}

function regexHost(regex: string): string | undefined {
  const withoutAnchor = regex.trim().replace(/^\^/, "");
  const match = /^(?:https\?|https|http):\/\/([a-z0-9\\.-]+)/i.exec(
    withoutAnchor,
  );
  return normalizedHost(match?.[1]?.replaceAll("\\.", "."));
}

function normalizedHost(host: string | undefined): string | undefined {
  const normalized = host?.toLowerCase().replace(/^\*\./, "");
  return normalized !== undefined &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(normalized)
    ? normalized
    : undefined;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** "2026-07-12T14:03:27.000Z" → "2026-07-12 14:03 UTC" (the designed reading). */
function formatFrozenAt(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

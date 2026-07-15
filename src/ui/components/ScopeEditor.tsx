import { useId, useState } from "preact/hooks";
import type { ResourceGroup, Scope } from "../../core/model";
import { copy } from "../copy";
import { ChipField } from "./ChipField";
import { sentence } from "./sentence";
import "./ScopeEditor.css";

/** Per-type values kept side by side so switching segments never loses input. */
export interface ScopeDraft {
  type: Scope["type"];
  domains: string[];
  pattern: string;
  regex: string;
}

interface ScopeEditorProps {
  scope: ScopeDraft;
  resourceTypes: ResourceGroup[] | "all";
  /** Blocking commit error for the active scope field (e.g. empty scope). */
  error?: string | undefined;
  typesError?: string | undefined;
  defaultResourceTypesOpen?: boolean | undefined;
  suggestedDomain?: string | undefined;
  onScope: (scope: ScopeDraft) => void;
  onResourceTypes: (types: ResourceGroup[] | "all") => void;
  onCommit?: (() => void) | undefined;
}

const SEGMENTS = ["domains", "pattern", "regex"] as const;

const GROUPS: readonly ResourceGroup[] = [
  "pages",
  "subframes",
  "xhr",
  "scripts",
  "stylesheets",
  "images",
  "fonts",
  "media",
  "websockets",
  "other",
];

/**
 * Scope = match type + resource types. The segmented control carries radio
 * semantics (arrows move and select); "All sites" is deliberately subordinate —
 * a text link, not a fourth segment. The resource-type disclosure names the
 * anti-footgun default out loud: top-level pages are included until unchecked.
 */
export function ScopeEditor(props: ScopeEditorProps) {
  const id = useId();
  const { scope } = props;

  return (
    <>
      <div class="editor-field">
        <span class="editor-label" id={`${id}-label`}>
          {copy.editor.labels.scope}
        </span>
        <div class="editor-control">
          <SegmentedType
            labelId={`${id}-label`}
            type={scope.type}
            onType={(type) => props.onScope({ ...scope, type })}
          />
          {scope.type === "domains" && (
            <>
              <ChipField
                id={`${id}-domains`}
                inputLabel={copy.editor.domainInputLabel}
                placeholder={copy.editor.addDomain}
                values={scope.domains}
                variant="domain"
                invalid={props.error !== undefined}
                removeLabel={copy.editor.removeDomain}
                onChange={(domains) => props.onScope({ ...scope, domains })}
                onEnter={props.onCommit}
              />
              {props.suggestedDomain !== undefined &&
                scope.domains.includes(props.suggestedDomain) && (
                  <p class="editor-micro">{copy.editor.domainSuggestion}</p>
                )}
              <p class="editor-micro">{copy.editor.domainsHelper}</p>
              <p class="editor-micro editor-request-target">
                {copy.editor.requestTarget}
              </p>
            </>
          )}
          {scope.type === "pattern" && (
            <>
              <input
                class="field mono editor-commit-field"
                type="text"
                aria-label={copy.editor.scopeType.pattern}
                aria-invalid={props.error !== undefined ? true : undefined}
                value={scope.pattern}
                onInput={(event) =>
                  props.onScope({
                    ...scope,
                    pattern: event.currentTarget.value,
                  })
                }
              />
              <p class="editor-micro">{sentence(copy.editor.patternHint)}</p>
            </>
          )}
          {scope.type === "regex" && (
            <input
              class="field mono editor-commit-field"
              type="text"
              aria-label={copy.editor.scopeType.regex}
              aria-invalid={props.error !== undefined ? true : undefined}
              value={scope.regex}
              onInput={(event) =>
                props.onScope({ ...scope, regex: event.currentTarget.value })
              }
            />
          )}
          {(scope.type === "pattern" || scope.type === "regex") && (
            <p class="editor-micro">{copy.editor.grantNote}</p>
          )}
          {props.error !== undefined && (
            <p class="editor-error" role="alert">
              {props.error}
            </p>
          )}
        </div>
      </div>
      <ResourceTypes
        resourceTypes={props.resourceTypes}
        error={props.typesError}
        defaultOpen={props.defaultResourceTypesOpen === true}
        onResourceTypes={props.onResourceTypes}
      />
    </>
  );
}

function SegmentedType({
  labelId,
  type,
  onType,
}: {
  labelId: string;
  type: ScopeDraft["type"];
  onType: (type: ScopeDraft["type"]) => void;
}) {
  const id = useId();

  // Native radios carry the whole radio-group contract — arrows move and
  // select, one tab stop — so the segment paint is just a label skin.
  return (
    <>
      <div class="segments" role="radiogroup" aria-labelledby={labelId}>
        {SEGMENTS.map((segment) => (
          <label
            key={segment}
            class={type === segment ? "segment checked" : "segment"}
          >
            <input
              class="sr-only"
              type="radio"
              name={`${id}-scope-type`}
              checked={type === segment}
              onChange={() => onType(segment)}
            />
            {copy.editor.scopeType[segment]}
          </label>
        ))}
      </div>
      <button
        type="button"
        class="link-btn all-sites"
        aria-pressed={type === "all"}
        onClick={() => onType("all")}
      >
        {copy.editor.allSites}
      </button>
    </>
  );
}

function ResourceTypes({
  resourceTypes,
  error,
  defaultOpen,
  onResourceTypes,
}: {
  resourceTypes: ResourceGroup[] | "all";
  error?: string | undefined;
  defaultOpen: boolean;
  onResourceTypes: (types: ResourceGroup[] | "all") => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const selected = resourceTypes === "all" ? GROUPS : resourceTypes;

  const toggle = (group: ResourceGroup) => {
    const next = new Set(selected);
    if (next.has(group)) {
      next.delete(group);
    } else {
      next.add(group);
    }
    onResourceTypes(
      next.size === GROUPS.length
        ? "all"
        : GROUPS.filter((candidate) => next.has(candidate)),
    );
  };

  return (
    <div class="editor-option">
      <div class="editor-control">
        <button
          type="button"
          class="disclosure"
          aria-expanded={open}
          aria-controls={open ? `${id}-panel` : undefined}
          onClick={() => setOpen((current) => !current)}
        >
          {copy.editor.labels.resourceTypes} · {typesSummary(resourceTypes)}{" "}
          <span aria-hidden="true">▾</span>
        </button>
        {selected.includes("pages") && (
          <p class="editor-micro">{copy.editor.includesPages}</p>
        )}
        {open && (
          <fieldset
            class="rt-grid"
            id={`${id}-panel`}
            aria-label={copy.editor.labels.resourceTypes}
          >
            {GROUPS.map((group) => (
              <label class="rt-item" key={group}>
                <input
                  type="checkbox"
                  checked={selected.includes(group)}
                  onChange={() => toggle(group)}
                />
                {copy.resourceTypes.groups[group]}
              </label>
            ))}
          </fieldset>
        )}
        {error !== undefined && (
          <p class="editor-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function typesSummary(resourceTypes: ResourceGroup[] | "all"): string {
  if (resourceTypes === "all") {
    return copy.editor.allTypes;
  }
  const names = resourceTypes.map((group) => copy.resourceTypes.groups[group]);
  return names.length > 0 && names.length <= 2
    ? names.join(", ")
    : copy.resourceTypes.count(names.length);
}

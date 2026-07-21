import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import type { ResourceGroup, Scope } from "../../core/model";
import { copy } from "../copy";
import { ChipField } from "./ChipField";
import { Segmented } from "./Segmented";
import { sentence } from "./sentence";
import "./ScopeEditor.css";

/** Per-type values kept side by side so switching segments never loses input. */
export interface ScopeDraft {
  type: Scope["type"];
  domains: string[];
  pattern: string;
  regex: string;
  /** Hosts a pattern/regex rule is granted on; empty means all sites. */
  hosts: string[];
}

interface ScopeEditorProps {
  scope: ScopeDraft;
  resourceTypes: ResourceGroup[] | "all";
  /** Blocking commit error for the active scope field (e.g. empty scope). */
  error?: string | undefined;
  typesError?: string | undefined;
  defaultResourceTypesOpen?: boolean | undefined;
  onScope: (scope: ScopeDraft) => void;
  onResourceTypes: (types: ResourceGroup[] | "all") => void;
}

const SEGMENTS = ["domains", "pattern", "regex", "all"] as const;

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
 * semantics (arrows move and select); All sites is the fourth peer scope. The
 * resource-type disclosure names the
 * anti-footgun default out loud: top-level pages are included until unchecked.
 */
export function ScopeEditor(props: ScopeEditorProps) {
  const id = useId();
  const { scope } = props;
  const crossPageSubresources =
    props.resourceTypes !== "all" &&
    !props.resourceTypes.includes("pages") &&
    props.resourceTypes.some((group) => group !== "subframes");

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
              />
              <p class="editor-micro">
                {crossPageSubresources
                  ? copy.editor.requestTarget
                  : copy.editor.domainsHelper}
              </p>
            </>
          )}
          {scope.type === "pattern" && (
            <UrlScopeField
              id={id}
              label={copy.editor.scopeType.pattern}
              hint={sentence(copy.editor.patternHint)}
              invalid={props.error !== undefined}
              value={scope.pattern}
              hosts={scope.hosts}
              onValue={(pattern) => props.onScope({ ...scope, pattern })}
              onHosts={(hosts) => props.onScope({ ...scope, hosts })}
            />
          )}
          {scope.type === "regex" && (
            <UrlScopeField
              id={id}
              label={copy.editor.scopeType.regex}
              hint={copy.editor.regexHint}
              invalid={props.error !== undefined}
              value={scope.regex}
              hosts={scope.hosts}
              onValue={(regex) => props.onScope({ ...scope, regex })}
              onHosts={(hosts) => props.onScope({ ...scope, hosts })}
            />
          )}
          {scope.type === "all" && (
            <p class="editor-micro">{copy.editor.allSitesHelper}</p>
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

/**
 * The pattern and regex scopes share one shape: a mono URL-matching field, its
 * syntax hint, and the grant-hosts escape hatch beneath. Only the label, hint,
 * and which field they write differ.
 */
function UrlScopeField({
  id,
  label,
  hint,
  invalid,
  value,
  hosts,
  onValue,
  onHosts,
}: {
  id: string;
  label: string;
  hint: ComponentChildren;
  invalid: boolean;
  value: string;
  hosts: string[];
  onValue: (value: string) => void;
  onHosts: (hosts: string[]) => void;
}) {
  return (
    <>
      <input
        class="field mono"
        type="text"
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        value={value}
        onInput={(event) => onValue(event.currentTarget.value)}
      />
      <p class="editor-micro">{hint}</p>
      <GrantHosts id={`${id}-hosts`} hosts={hosts} onChange={onHosts} />
    </>
  );
}

/**
 * The per-site escape hatch for a pattern/regex rule. A regex names no host
 * Chrome can scope a permission to, so leaving this empty is an honest all-sites
 * request; adding a host bounds the grant to it and keeps the rule per-site.
 */
function GrantHosts({
  id,
  hosts,
  onChange,
}: {
  id: string;
  hosts: string[];
  onChange: (hosts: string[]) => void;
}) {
  return (
    <>
      <ChipField
        id={id}
        label={copy.editor.grantHostsLabel}
        inputLabel={copy.editor.grantHostInputLabel}
        placeholder={copy.editor.addDomain}
        values={hosts}
        variant="grant"
        removeLabel={copy.editor.removeDomain}
        onChange={onChange}
      />
      <p class="editor-micro">
        {hosts.length === 0
          ? copy.editor.grantHostsAllSites
          : copy.editor.grantHostsBounded}
      </p>
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
    <Segmented
      semantics="radio"
      name={`${id}-scope-type`}
      labelledBy={labelId}
      value={type}
      options={SEGMENTS.map((segment) => ({
        value: segment,
        label:
          segment === "all"
            ? copy.editor.allSites
            : copy.editor.scopeType[segment],
      }))}
      onChange={onType}
    />
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
          <span
            class={open ? "disclosure-chevron open" : "disclosure-chevron"}
            aria-hidden="true"
          >
            ›
          </span>
        </button>
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

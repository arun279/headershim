import { useId, useState } from "preact/hooks";
import type { ResourceGroup, Scope } from "../../core/model";
import { focusOnRemoval } from "../a11y/focus";
import { copy } from "../copy";
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
  onScope: (scope: ScopeDraft) => void;
  onResourceTypes: (types: ResourceGroup[] | "all") => void;
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
          {scope.type === "domains" && <DomainChips {...props} />}
          {scope.type === "pattern" && (
            <>
              <input
                class="field mono"
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
              class="field mono"
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

function DomainChips(props: ScopeEditorProps) {
  const [pending, setPending] = useState("");
  const { scope } = props;

  const commitPending = (raw: string) => {
    const domain = raw.trim().toLowerCase();
    setPending("");
    if (domain !== "" && !scope.domains.includes(domain)) {
      props.onScope({ ...scope, domains: [...scope.domains, domain] });
    }
  };

  const removeChip = (domain: string) => {
    props.onScope({
      ...scope,
      domains: scope.domains.filter((candidate) => candidate !== domain),
    });
  };

  return (
    <>
      <div class="domain-chips">
        {scope.domains.map((domain) => (
          <span class="domain-chip" key={domain}>
            <span class="mono">{domain}</span>
            <button
              type="button"
              class="domain-chip-x"
              aria-label={copy.editor.removeDomain(domain)}
              onClick={(event) => {
                focusOnRemoval(event.currentTarget);
                removeChip(domain);
              }}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          class="domain-chip-input mono"
          type="text"
          aria-label={copy.editor.domainInputLabel}
          aria-invalid={props.error !== undefined ? true : undefined}
          placeholder={copy.editor.addDomain}
          value={pending}
          onInput={(event) => setPending(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              if (pending.trim() !== "") {
                commitPending(pending);
                // Ctrl/Cmd+Enter also commits the rule: the fresh chip is
                // already in the draft, so the event may keep bubbling.
                if (!(event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                }
              } else if (event.key === ",") {
                event.preventDefault();
              }
            } else if (
              event.key === "Backspace" &&
              pending === "" &&
              scope.domains.length > 0
            ) {
              removeChip(scope.domains[scope.domains.length - 1] as string);
            }
          }}
          onBlur={() => commitPending(pending)}
        />
      </div>
      <p class="editor-micro">{copy.editor.domainsHelper}</p>
    </>
  );
}

function ResourceTypes({
  resourceTypes,
  error,
  onResourceTypes,
}: {
  resourceTypes: ResourceGroup[] | "all";
  error?: string | undefined;
  onResourceTypes: (types: ResourceGroup[] | "all") => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
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
    <div class="editor-field">
      <span class="editor-label" id={`${id}-label`}>
        {copy.editor.labels.resourceTypes}
      </span>
      <div class="editor-control">
        <button
          type="button"
          class="disclosure"
          aria-expanded={open}
          aria-controls={open ? `${id}-panel` : undefined}
          onClick={() => setOpen((current) => !current)}
        >
          {typesSummary(resourceTypes)} <span aria-hidden="true">▾</span>
        </button>
        {selected.includes("pages") && (
          <p class="editor-micro">{copy.editor.includesPages}</p>
        )}
        {open && (
          <fieldset
            class="rt-grid"
            id={`${id}-panel`}
            aria-labelledby={`${id}-label`}
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

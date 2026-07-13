import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Scope } from "../../core/model";
import { focusOnRemoval } from "../a11y/focus";
import { copy } from "../copy";
import { Button } from "./Button";
import "./GrantPanel.css";

export interface GrantSelection {
  readonly targetHosts: string[];
  readonly initiators: string[];
}

export type InitiatorControl =
  // Tab origin ≠ target and the rule reaches subresources: one pre-checked line.
  | {
      readonly kind: "checkbox";
      readonly host: string;
      readonly target: string;
    }
  // No page-under-test context: an explicit, optional chip input.
  | { readonly kind: "chips"; readonly prefill: readonly string[] }
  | { readonly kind: "none" };

export interface GrantPanelProps {
  scopeType: Scope["type"];
  /** Fixed target hosts named in the sentence (Domains scope). */
  targetHosts: readonly string[];
  /** Pattern/regex scopes collect their concrete request-URL hosts as chips. */
  editableTargets: boolean;
  targetPrefill: readonly string[];
  initiator: InitiatorControl;
  /** Fired in the click gesture so the caller can request permissions in-gesture. */
  onAllow: (selection: GrantSelection) => void;
  onNotNow: () => void;
  /** Pattern/regex escape hatch to the buried all-sites flow (§3.4). */
  onAllSites: () => void;
}

/**
 * The grant moment (SPEC §3.1–3.3), inside the editor footer. It never grants
 * anything itself: it collects the sites Chrome needs named, then hands the
 * selection back so `permissions.request` runs in the same user gesture. A
 * decline leaves the rule saved and loud; only the returned selection is ever
 * persisted, so grants and rule state stay decoupled.
 */
export function GrantPanel(props: GrantPanelProps) {
  const id = useId();
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const [targets, setTargets] = useState<string[]>(() => [
    ...props.targetPrefill,
  ]);
  const [initiatorChecked, setInitiatorChecked] = useState(true);
  const [initiatorChips, setInitiatorChips] = useState<string[]>(() =>
    props.initiator.kind === "chips" ? [...props.initiator.prefill] : [],
  );

  const selection = (): GrantSelection => ({
    targetHosts: props.editableTargets ? targets : [...props.targetHosts],
    initiators: initiatorHosts(),
  });

  const initiatorHosts = (): string[] => {
    switch (props.initiator.kind) {
      case "checkbox":
        return initiatorChecked ? [props.initiator.host] : [];
      case "chips":
        return initiatorChips;
      case "none":
        return [];
    }
  };

  const current = selection();
  const siteCount = new Set([...current.targetHosts, ...current.initiators])
    .size;
  const pattern = props.scopeType === "pattern" || props.scopeType === "regex";

  // The panel appears without its own live region; moving focus into it on open
  // is how a keyboard or screen-reader user learns a grant is being asked for.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, []);

  return (
    <fieldset
      class="grant-panel"
      ref={rootRef}
      aria-labelledby={`${id}-intro`}
      data-variant={pattern ? "pattern" : "domains"}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.defaultPrevented) {
          // A chip field consumes its own Enter; leave button Enter native too.
          return;
        }
        const target = event.target;
        if (target instanceof HTMLElement && target.tagName === "BUTTON") {
          return;
        }
        // The open panel owns Enter so the editor above never re-commits under it.
        event.stopPropagation();
        event.preventDefault();
        if ((event.ctrlKey || event.metaKey) && siteCount > 0) {
          props.onAllow(selection());
        }
      }}
    >
      {pattern ? (
        <>
          <p class="grant-line" id={`${id}-intro`}>
            {copy.grantPanel.patternIntro}
          </p>
          <ChipField
            id={`${id}-targets`}
            label={copy.grantPanel.targetsQuestion}
            inputLabel={copy.grantPanel.targetInputLabel}
            hosts={targets}
            onChange={setTargets}
          />
          {props.initiator.kind !== "none" && (
            <ChipField
              id={`${id}-initiators`}
              label={copy.grantPanel.initiatorsQuestion}
              inputLabel={copy.grantPanel.initiatorInputLabel}
              hosts={initiatorChips}
              onChange={setInitiatorChips}
            />
          )}
          <button
            type="button"
            class="link-btn grant-all"
            onClick={props.onAllSites}
          >
            {copy.grantPanel.allSitesLink}
          </button>
          <p class="grant-effect">{copy.grantPanel.patternEffect}</p>
        </>
      ) : (
        <>
          <p class="grant-line" id={`${id}-intro`}>
            {props.targetHosts.length === 1 ? (
              copy.grantPanel.single(props.targetHosts[0] as string)
            ) : (
              <>
                {copy.grantPanel.multiple(props.targetHosts.length)}
                <span class="grant-hosts">
                  {props.targetHosts.map((host) => (
                    <span class="mono" key={host}>
                      {host}
                    </span>
                  ))}
                </span>
              </>
            )}
          </p>
          {props.initiator.kind === "checkbox" && (
            <label class="grant-initiator">
              <input
                type="checkbox"
                checked={initiatorChecked}
                onChange={(event) =>
                  setInitiatorChecked(event.currentTarget.checked)
                }
              />
              <span>
                {initiatorSentence(
                  props.initiator.host,
                  props.initiator.target,
                )}
              </span>
            </label>
          )}
          {props.initiator.kind === "chips" && (
            <ChipField
              id={`${id}-initiators`}
              label={copy.grantPanel.noContextInitiators}
              inputLabel={copy.grantPanel.initiatorInputLabel}
              hosts={initiatorChips}
              onChange={setInitiatorChips}
            />
          )}
        </>
      )}

      <div class="grant-actions">
        <Button
          kind="primary"
          onClick={() => props.onAllow(selection())}
          disabled={siteCount === 0}
        >
          {siteCount === 1
            ? copy.actions.allowOn(onlySite(current))
            : copy.actions.allowOn(`${siteCount} sites`)}
        </Button>
        <Button kind="quiet" onClick={props.onNotNow}>
          {copy.actions.notNow}
        </Button>
      </div>
    </fieldset>
  );
}

/** Bold the initiator host inside the pre-checked line, mono for both hosts. */
function initiatorSentence(host: string, target: string) {
  const text = copy.grantPanel.initiator(host, target);
  const parts = splitAround(text, [host, target]);
  return parts.map((part) =>
    part.match ? <span class="mono">{part.text}</span> : part.text,
  );
}

function onlySite(selection: GrantSelection): string {
  return [
    ...new Set([...selection.targetHosts, ...selection.initiators]),
  ][0] as string;
}

interface ChipFieldProps {
  id: string;
  label: string;
  inputLabel: string;
  hosts: string[];
  onChange: (hosts: string[]) => void;
}

function ChipField({ id, label, inputLabel, hosts, onChange }: ChipFieldProps) {
  const [pending, setPending] = useState("");

  const commit = (raw: string) => {
    const host = raw.trim().toLowerCase();
    setPending("");
    if (host !== "" && !hosts.includes(host)) {
      onChange([...hosts, host]);
    }
  };
  const remove = (host: string) =>
    onChange(hosts.filter((candidate) => candidate !== host));

  return (
    <div class="grant-field">
      <span class="grant-field-label" id={`${id}-label`}>
        {label}
      </span>
      <div class="grant-chips">
        {hosts.map((host) => (
          <span class="grant-chip" key={host}>
            <span class="mono">{host}</span>
            <button
              type="button"
              class="grant-chip-x"
              aria-label={copy.grantPanel.removeSite(host)}
              onClick={(event) => {
                focusOnRemoval(event.currentTarget);
                remove(host);
              }}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          class="grant-chip-input mono"
          type="text"
          aria-label={inputLabel}
          aria-describedby={`${id}-label`}
          placeholder={copy.grantPanel.addSite}
          value={pending}
          onInput={(event) => setPending(event.currentTarget.value)}
          onKeyDown={(event) => {
            const last = hosts.at(-1);
            if (event.key === "Backspace" && pending === "" && last) {
              remove(last);
              return;
            }
            if (event.key !== "Enter" && event.key !== ",") {
              return;
            }
            // A typed host commits as a chip and is consumed here; the panel's
            // Ctrl/Cmd+Enter grant is a separate, deliberate second press.
            if (pending.trim() !== "" || event.key === ",") {
              event.preventDefault();
            }
            commit(pending);
          }}
          onBlur={() => commit(pending)}
        />
      </div>
    </div>
  );
}

function splitAround(
  text: string,
  needles: readonly string[],
): { text: string; match: boolean }[] {
  const pattern = needles
    .map((needle) => needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return text
    .split(new RegExp(`(${pattern})`))
    .filter((piece) => piece !== "")
    .map((piece) => ({ text: piece, match: needles.includes(piece) }));
}

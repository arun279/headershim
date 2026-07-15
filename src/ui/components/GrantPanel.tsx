import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Scope } from "../../core/model";
import { originPatternForDomain } from "../../core/scope";
import { copy } from "../copy";
import { Button } from "./Button";
import { ChipField } from "./ChipField";
import { TRUNCATION_LIMITS, Truncate } from "./Truncate";
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
  created: boolean;
  /** Called before any async boundary in the Allow button's click handler. */
  onRequestGrant: (origins: string[]) => Promise<boolean>;
  onAllow: (selection: GrantSelection, granted: Promise<boolean>) => void;
  onGrantLater: () => void;
  onDiscardRule: () => void;
  /** Pattern/regex escape hatch to the buried all-sites flow. */
  onAllSites: () => void;
}

/**
 * The grant moment, inside the editor footer. It never grants
 * anything itself: it collects the sites Chrome needs named, then hands the
 * selection back so `permissions.request` runs in the same user gesture. A
 * decline leaves the rule saved and loud; only the returned selection is ever
 * persisted, so grants and rule state stay decoupled.
 */
export function GrantPanel(props: GrantPanelProps) {
  const id = useId();
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const allowRef = useRef<HTMLSpanElement>(null);
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
  const origins = [
    ...new Set(
      [...current.targetHosts, ...current.initiators].map(
        originPatternForDomain,
      ),
    ),
  ];
  const siteCount = new Set([...current.targetHosts, ...current.initiators])
    .size;
  const pattern = props.scopeType === "pattern" || props.scopeType === "regex";

  // The grant is a distinct step. Focus lands on Allow, the action accelerated
  // saves lead to but never activate on the user's behalf.
  useEffect(() => {
    allowRef.current?.querySelector("button")?.focus();
  }, []);

  return (
    <fieldset
      class="grant-panel"
      ref={rootRef}
      aria-labelledby={`${id}-intro`}
      data-variant={pattern ? "pattern" : "domains"}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          event.target !== allowRef.current?.querySelector("button")
        ) {
          event.stopPropagation();
        }
      }}
    >
      <p class="grant-lead">
        <span aria-hidden="true">✓</span>{" "}
        {props.created
          ? copy.grantPanel.createdLead
          : copy.grantPanel.savedLead}
      </p>
      <h2 class="grant-heading" id={`${id}-intro`}>
        {copy.grantPanel.heading}
      </h2>
      {pattern ? (
        <>
          <p class="grant-line">{copy.grantPanel.patternIntro}</p>
          <ChipField
            id={`${id}-targets`}
            label={copy.grantPanel.targetsQuestion}
            inputLabel={copy.grantPanel.targetInputLabel}
            placeholder={copy.grantPanel.addSite}
            values={targets}
            variant="grant"
            removeLabel={copy.grantPanel.removeSite}
            onChange={setTargets}
          />
          {props.initiator.kind !== "none" && (
            <ChipField
              id={`${id}-initiators`}
              label={copy.grantPanel.initiatorsQuestion}
              inputLabel={copy.grantPanel.initiatorInputLabel}
              placeholder={copy.grantPanel.addSite}
              values={initiatorChips}
              variant="grant"
              removeLabel={copy.grantPanel.removeSite}
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
          <p class="grant-line">
            {props.targetHosts.length === 1 ? (
              copy.grantPanel.single(props.targetHosts[0] as string)
            ) : (
              <>
                {copy.grantPanel.multiple(props.targetHosts.length)}
                <span class="grant-hosts">
                  {props.targetHosts.map((host) => (
                    <Truncate
                      key={host}
                      mode="end"
                      value={host}
                      maxChars={TRUNCATION_LIMITS.domain}
                      class="mono"
                    />
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
              placeholder={copy.grantPanel.addSite}
              values={initiatorChips}
              variant="grant"
              removeLabel={copy.grantPanel.removeSite}
              onChange={setInitiatorChips}
            />
          )}
        </>
      )}

      <div class="grant-actions">
        <Button kind="quiet" onClick={props.onDiscardRule}>
          {copy.actions.discardRule}
        </Button>
        <Button kind="quiet" onClick={props.onGrantLater}>
          {copy.actions.grantLater}
        </Button>
        <span class="grant-allow" ref={allowRef}>
          <Button
            kind="primary"
            onClick={() => {
              const granted = props.onRequestGrant(origins);
              props.onAllow(current, granted);
            }}
            disabled={siteCount === 0}
          >
            {siteCount === 1
              ? copy.actions.allowOn(onlySite(current))
              : copy.actions.allowOn(`${siteCount} sites`)}
          </Button>
        </span>
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

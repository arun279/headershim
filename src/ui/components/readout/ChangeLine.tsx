import { useEffect, useRef, useState } from "preact/hooks";
import { copy } from "../../copy";
import {
  caveatNote,
  controlTone,
  displayTone,
  grantAction,
  outcomeReason,
  verb,
} from "../../dispositionCopy";
import type { TabChange } from "../../state/readout";
import { Toggle } from "../Toggle";
import { HeaderValue, Truncate } from "../Truncate";
import { OpGlyph } from "./glyphs";

interface ChangeLineProps {
  change: TabChange;
  onToggle: (next: boolean) => void;
  onGrant: () => void;
  onEditValue: (value: string) => Promise<boolean>;
  onRemove?: () => void;
}

/**
 * One change, in the one grammar: a severity spine (teal live, amber a grant
 * away, managed, or not applied yet, red refused, grey-dashed at rest), the
 * operation glyph, and the wire bytes. A running line adds no reason unless
 * only Chrome can settle its match; the other things that speak are an
 * exception, said once, and a reach past this tab, because the switch on the row
 * is the rule's switch and turning it off here turns it off there.
 */
export function ChangeLine({
  change,
  onToggle,
  onGrant,
  onEditValue,
  onRemove,
}: ChangeLineProps) {
  const [editing, setEditing] = useState(false);
  const canEdit = change.operation !== "remove" && change.value !== undefined;
  const lineVerb = verb(change.outcome, change.operation, change.paused);
  const reason =
    change.outcome.kind === "runs-if-matched"
      ? undefined
      : outcomeReason(change.outcome, change.source === "override");
  const caveat = caveatNote(change.caveats, change.header, change.operation);
  const grant = grantAction(change.outcome);
  const tone = displayTone(change.outcome, change.caveats);
  const toggleTone = controlTone(change.outcome, change.paused);
  const reach =
    change.widerReach === undefined
      ? undefined
      : change.widerReach === "broad"
        ? copy.readout.widerReach.broad
        : copy.readout.widerReach.sites(change.widerReach);
  const toggleLabel =
    change.source === "override"
      ? copy.readout.overrideToggle(change.header, change.enabled)
      : copy.rules.switchLabel(change.header, change.enabled);

  return (
    <div
      class={`change-line ${tone}${toggleTone === "paused" ? " paused" : ""}`}
      data-key={change.key}
    >
      <span class="spine" aria-hidden="true" />
      <span class="op">
        <OpGlyph operation={change.operation} />
      </span>
      <div class="line-body">
        <p class="say">
          <span class="verb">{lineVerb}</span>{" "}
          <Truncate mode="end" value={change.header} class="k" />
          {change.display !== undefined && (
            <>
              {" "}
              <span class="to" aria-hidden="true">
                {copy.readout.to}
              </span>{" "}
              {editing && canEdit ? (
                <ValueEdit
                  header={change.header}
                  secret={change.secret}
                  initial={change.value ?? ""}
                  onCommit={async (value) => {
                    if (await onEditValue(value)) setEditing(false);
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : canEdit ? (
                <button
                  type="button"
                  class="v-edit"
                  aria-label={copy.readout.editValue(change.header)}
                  onClick={() => setEditing(true)}
                >
                  <HeaderValue
                    value={change.display}
                    secret={change.secret}
                    class="v"
                  />
                </button>
              ) : (
                <HeaderValue
                  value={change.display}
                  secret={change.secret}
                  class="v"
                />
              )}
            </>
          )}
        </p>
        {editing && <p class="edit-hint">{copy.rules.editValueHint}</p>}
        {reason !== undefined && (
          <p class={`why ${reason.tone}`}>
            <span class="dot" aria-hidden="true" />
            {reason.label}
          </p>
        )}
        {caveat !== undefined && (
          <p class="why amber">
            <span class="dot" aria-hidden="true" />
            {caveat}
          </p>
        )}
        {reach !== undefined && (
          <p class="why rest">
            <span class="dot" aria-hidden="true" />
            {reach}
          </p>
        )}
      </div>
      <div class="line-control">
        {onRemove !== undefined && (
          <button
            type="button"
            class="line-remove"
            aria-label={copy.readout.removeOverride(change.header)}
            onClick={onRemove}
          >
            <RemoveGlyph />
          </button>
        )}
        {grant !== undefined ? (
          <button type="button" class="grant" onClick={onGrant}>
            {grant.label}
          </button>
        ) : (
          <Toggle
            checked={change.enabled}
            label={toggleLabel}
            tone={toggleTone}
            onChange={onToggle}
          />
        )}
      </div>
    </div>
  );
}

function ValueEdit({
  header,
  secret,
  initial,
  onCommit,
  onCancel,
}: {
  header: string;
  secret: boolean;
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  // A secret opens empty and masked so its current bytes are never echoed to a
  // shoulder-surfer; a plain value opens prefilled for a quick tweak.
  const [value, setValue] = useState(secret ? "" : initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <input
      ref={input}
      class="v-input mono"
      type={secret ? "password" : "text"}
      value={value}
      spellcheck={false}
      autocomplete="off"
      aria-label={copy.readout.editValue(header)}
      onInput={(event) => setValue(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (!secret || value !== "") onCommit(value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCancel}
    />
  );
}

function RemoveGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      aria-hidden="true"
    >
      <path d="m4 4 8 8m0-8-8 8" />
    </svg>
  );
}

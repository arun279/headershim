import { useState } from "preact/hooks";
import { copy } from "../../copy";
import { grantLabel } from "../../grantLabel";
import type { TabChange } from "../../state/readout";
import { Toggle } from "../Toggle";
import { HeaderValue, Truncate } from "../Truncate";
import { toneForStatus } from "../toggleTone";
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
 * away, managed, or not applied yet, red refused, faint where only Chrome can
 * settle the match, grey-dashed at rest), the operation glyph, and the wire
 * bytes. A live line adds no reason; the two things that do speak are an
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
  // Pause changes the sentence, not only the colour it is set in: a held line
  // says what it would do rather than claiming to be doing it.
  const verb =
    change.status === "paused"
      ? copy.readout.heldVerb[change.operation]
      : copy.readout.verb[change.operation];
  const reach =
    change.widerReach === undefined
      ? undefined
      : change.widerReach === "broad"
        ? copy.readout.widerReach.broad
        : copy.readout.widerReach.sites(change.widerReach);
  const toggleLabel =
    change.source === "override"
      ? copy.readout.overrideToggle(change.header, change.enabled)
      : copy.readout.ruleToggle(change.header, change.enabled, reach);

  return (
    <div class={`change-line ${change.status}`} data-key={change.key}>
      <span class="spine" aria-hidden="true" />
      <span class="op">
        <OpGlyph operation={change.operation} />
      </span>
      <div class="line-body">
        {editing && canEdit ? (
          <ValueEdit
            header={change.header}
            secret={change.secret}
            initial={change.value ?? ""}
            onCommit={async (value) => {
              const outcome = await onEditValue(value);
              if (outcome !== false) setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <p class="say">
            <span class="verb">{verb}</span>{" "}
            <Truncate mode="end" value={change.header} class="k" />
            {change.display !== undefined && (
              <>
                {" "}
                <span class="to" aria-hidden="true">
                  {copy.readout.to}
                </span>{" "}
                {canEdit ? (
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
        )}
        {change.status === "overridden" &&
          change.overriddenBy !== undefined && (
            <p class="why rest">
              <span class="dot" aria-hidden="true" />
              {copy.readout.overriddenBy(change.overriddenBy)}
            </p>
          )}
        {change.status === "refused" && change.refused !== undefined && (
          <p class="why stop">
            <span class="dot" aria-hidden="true" />
            {copy.readout.refusedReason[change.refused]}
          </p>
        )}
        {change.status === "managed" && (
          <p class="why amber">
            <span class="dot" aria-hidden="true" />
            {copy.readout.managedReason}
          </p>
        )}
        {change.status === "out-of-sync" && (
          <p class="why amber">
            <span class="dot" aria-hidden="true" />
            {copy.readout.outOfSyncReason}
          </p>
        )}
        {change.status === "unconfirmed" && (
          <p class="why rest">
            <span class="dot" aria-hidden="true" />
            {copy.readout.unconfirmedReason}
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
        {change.status === "needs-access" ? (
          <button type="button" class="grant" onClick={onGrant}>
            {grantLabel(change.missing)}
          </button>
        ) : (
          <>
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
            <Toggle
              checked={change.enabled}
              label={toggleLabel}
              tone={toneForStatus(change.status)}
              onChange={onToggle}
            />
          </>
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
  return (
    <input
      class="v-input mono"
      type={secret ? "password" : "text"}
      value={value}
      spellcheck={false}
      autocomplete="off"
      aria-label={copy.readout.editValue(header)}
      autofocus
      onInput={(event) => setValue(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(value);
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

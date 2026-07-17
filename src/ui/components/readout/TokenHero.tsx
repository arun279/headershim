import { useState } from "preact/hooks";
import { copy } from "../../copy";
import type { TabChange } from "../../state/readout";
import { maskToken, tokenFreshness } from "../../token";
import { sentence } from "../sentence";
import { TRUNCATION_LIMITS, Truncate } from "../Truncate";
import { ClockGlyph, KeyGlyph } from "./glyphs";

interface TokenHeroProps {
  change: TabChange;
  host: string | undefined;
  now: number;
  onSwap: (value: string) => Promise<boolean>;
  onGrant: () => void;
}

/**
 * The one living thing: the credential you are sending. It shows a real
 * countdown only when it can read one (a JWT that carries its own exp) and
 * states nothing more for an opaque token than that it has no expiry. Swap
 * opens an inline masked field that is never echoed back on the resting card.
 */
export function TokenHero({
  change,
  host,
  now,
  onSwap,
  onGrant,
}: TokenHeroProps) {
  const [swapping, setSwapping] = useState(false);
  const value = change.value ?? "";
  const masked = maskToken(value);
  const fresh = tokenFreshness(value, now);
  const needsAccess = change.status === "needs-access";
  const atRest = change.status === "off" || change.status === "paused";

  return (
    <section
      class={`token${needsAccess ? " needs" : ""}${atRest ? " at-rest" : ""}`}
      aria-label={change.header}
    >
      <div class="tk-top">
        <span class="tk-key" aria-hidden="true">
          <KeyGlyph />
        </span>
        <div class="tk-main">
          <div class="tk-label">
            <Truncate
              mode="end"
              value={copy.token.valueLabel(change.header)}
              maxChars={TRUNCATION_LIMITS.header}
            />
          </div>
          {swapping ? (
            <div class="tk-swaptarget">
              {host !== undefined && sentence(copy.token.swapOn(host))}
            </div>
          ) : (
            <div class="tk-val mono">
              {masked.scheme !== undefined && (
                <span class="pre">{masked.scheme}</span>
              )}
              <span class="dots" aria-hidden="true">
                ••••••••
              </span>
              {masked.hasTail && <span class="last">{masked.last4}</span>}
            </div>
          )}
        </div>
        {!swapping &&
          (needsAccess ? (
            <button type="button" class="grant tk-action" onClick={onGrant}>
              {copy.readout.grant}
            </button>
          ) : (
            <button
              type="button"
              class="swap tk-action"
              onClick={() => setSwapping(true)}
            >
              {copy.token.swap}
            </button>
          ))}
      </div>

      {swapping ? (
        <SwapField
          header={change.header}
          source={change.source}
          onReplace={async (next) => {
            const outcome = await onSwap(next);
            if (outcome !== false) setSwapping(false);
          }}
          onCancel={() => setSwapping(false)}
        />
      ) : (
        <div class="fresh">
          {fresh.kind === "countdown" ? (
            <>
              {fresh.fraction !== undefined && (
                <div class="fresh-track" aria-hidden="true">
                  <div
                    class={`fresh-fill${fresh.warn ? " warn" : ""}`}
                    style={{ width: `${Math.round(fresh.fraction * 100)}%` }}
                  />
                </div>
              )}
              <div class="fresh-lab">
                <span class="tag mono">{copy.token.jwtTag}</span>
                <span class={`lead${fresh.warn ? " warn" : ""}`}>
                  {copy.token.expiresIn(fresh.remainingMs)}
                </span>
                {fresh.warn && <span class="rt">{copy.token.warnNote}</span>}
              </div>
            </>
          ) : (
            <div class="age">
              <ClockGlyph />
              <span class="lead">{copy.token.opaque}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SwapField({
  header,
  source,
  onReplace,
  onCancel,
}: {
  header: string;
  source: TabChange["source"];
  onReplace: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div class="swapfield">
      <div class="lab">
        <span>{copy.token.pasteLabel}</span>
        <span class="r">{copy.token.pasteReplaces[source]}</span>
      </div>
      <input
        class="mono"
        type="password"
        value={value}
        spellcheck={false}
        autocomplete="off"
        aria-label={copy.token.pasteAria}
        autofocus
        onInput={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onReplace(value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div class="actions">
        <button type="button" class="btnp" onClick={() => onReplace(value)}>
          {copy.token.replace} <span class="kbd mono">↵</span>
        </button>
        <button type="button" class="btng" onClick={onCancel}>
          {copy.token.cancel}
        </button>
      </div>
      <span class="sr-only">{copy.token.valueLabel(header)}</span>
    </div>
  );
}

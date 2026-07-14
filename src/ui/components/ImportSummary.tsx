import { useId } from "preact/hooks";
import type { ImportPlan } from "../../core/codec/headershim";
import type { ModHeaderImportWarning } from "../../core/codec/modheader";
import {
  headerSensitivity,
  normalizeHeaderName,
  setCookieAttributesStripped,
} from "../../core/headers";
import type { RuleDraft } from "../../core/model";
import { copy } from "../copy";
import { importWarningCopy } from "../state/import-warning-copy";
import { Button } from "./Button";
import { RuleFace } from "./RuleFace";
import { scopeSummaryFor, sensitiveAdvisoryText } from "./ruleSummary";
import { sentence } from "./sentence";
import "./ImportSummary.css";

interface ImportSummaryProps {
  readonly plan: ImportPlan<ModHeaderImportWarning>;
  readonly applyError?: string | undefined;
  readonly onConvert: (warningIndex: number) => void;
  readonly onImport: () => void;
  readonly onCancel: () => void;
}

/**
 * The pre-apply review screen: counts, every imported rule with what it actually
 * does (so a credential or a stripped security header can't hide behind a bare
 * count), the itemized mapping warnings, and the one-click frozen-value
 * conversion — shown before anything is written. Confirming here is the only path
 * that applies.
 */
export function ImportSummary({
  plan,
  applyError,
  onConvert,
  onImport,
  onCancel,
}: ImportSummaryProps) {
  const headingId = useId();
  const text = copy.options.importExport;
  const ruleCount = plan.profiles.reduce(
    (total, profile) => total + profile.rules.length,
    0,
  );

  return (
    <section class="import-summary" aria-labelledby={headingId}>
      <h3 class="silk" id={headingId}>
        {text.summaryHeading}
      </h3>
      <p class="import-counts">
        {sentence(text.counts(plan.profiles.length, ruleCount))}
      </p>

      {ruleCount > 0 && (
        <>
          <p class="import-payload-heading silk">{text.payloadHeading}</p>
          <ul class="import-rules">
            {plan.profiles.flatMap((profile) =>
              profile.rules.map((rule, index) => (
                <RuleItem
                  key={`${profile.name}:${index}:${rule.header}`}
                  rule={rule}
                />
              )),
            )}
          </ul>
        </>
      )}

      {plan.warnings.length > 0 && (
        <>
          <p class="import-attention">
            {text.needAttention(plan.warnings.length)}
          </p>
          <ul class="import-warnings">
            {plan.warnings.map((warning, index) => {
              const { name, detail } = importWarningCopy(warning);
              const offer =
                warning.kind === "dynamic-token"
                  ? warning.conversionOffer
                  : undefined;
              return (
                <li
                  key={`${warning.kind}:${name}:${index}`}
                  class="import-warning"
                >
                  <span class="import-warning-lamp" aria-hidden="true" />
                  <div class="import-warning-body">
                    <p>
                      <span class="import-warning-name mono">{name}</span>
                      {" — "}
                      {sentence(detail)}
                    </p>
                    {offer !== undefined && (
                      <Button kind="quiet" onClick={() => onConvert(index)}>
                        {text.convert}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {applyError !== undefined && (
        <p class="import-error" role="alert">
          {applyError}
        </p>
      )}

      <div class="import-actions">
        <Button kind="quiet" onClick={onCancel}>
          {copy.actions.cancel}
        </Button>
        <Button kind="primary" onClick={onImport}>
          {text.import}
        </Button>
      </div>
    </section>
  );
}

/** One imported rule: its face, its scope, and — when sensitive — a caution. */
function RuleItem({ rule }: { rule: RuleDraft }) {
  const sensitive = headerSensitivity(rule);
  return (
    <li
      class={sensitive === undefined ? "import-rule" : "import-rule sensitive"}
    >
      {sensitive !== undefined && (
        <span class="import-warning-lamp" aria-hidden="true" />
      )}
      <div class="import-rule-body">
        <div class="import-rule-face">
          <RuleFace
            rule={rule}
            secondLine={sentence(scopeSummaryFor(rule.scope))}
          />
        </div>
        {sensitive !== undefined && (
          <p class="import-rule-caution">
            {sensitiveAdvisoryText(sensitive, rule.scope.type === "all")}
            {cookieAttributeNote(rule)}
          </p>
        )}
      </div>
    </li>
  );
}

function cookieAttributeNote(rule: RuleDraft): string {
  return normalizeHeaderName(rule.header) === "set-cookie" &&
    setCookieAttributesStripped(rule.value)
    ? ` ${copy.advisories.setCookieAttributes}`
    : "";
}

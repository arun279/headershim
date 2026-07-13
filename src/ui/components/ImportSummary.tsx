import { useId } from "preact/hooks";
import type { ImportPlan } from "../../core/codec/headershim";
import type { ModHeaderImportWarning } from "../../core/codec/modheader";
import { copy } from "../copy";
import { importWarningCopy } from "../state/import-warning-copy";
import { Button } from "./Button";
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
 * The pre-apply review screen: counts, every itemized mapping warning naming
 * its rule, and the one-click frozen-value conversion — shown before anything
 * is written. Confirming here is the only path that applies.
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

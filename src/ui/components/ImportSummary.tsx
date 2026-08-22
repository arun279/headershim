import { useId } from "preact/hooks";
import type { ImportPlan } from "../../core/codec/headershim";
import type { ImportPlanWarning } from "../../core/codec/modheader";
import { copy } from "../copy";
import { copy as optionsCopy } from "../copy.options";
import { importWarningCopy } from "../state/import-warning-copy";
import { Button } from "./Button";
import { sentence } from "./sentence";
import "./ImportSummary.css";

interface ImportSummaryProps {
  readonly plan: ImportPlan<ImportPlanWarning>;
  readonly fileName: string;
  readonly applyError?: string | undefined;
  readonly onConvert: (warningIndex: number) => void;
  readonly onImport: () => void;
  readonly onCancel: () => void;
}

/**
 * The pre-apply review screen: the picked file, the profiles the import will
 * create named as they will land, every itemized mapping warning naming its
 * rule, and the one-click frozen-value conversion — shown before anything is
 * written. Confirming here is the only path that applies.
 */
export function ImportSummary({
  plan,
  fileName,
  applyError,
  onConvert,
  onImport,
  onCancel,
}: ImportSummaryProps) {
  const headingId = useId();
  const text = optionsCopy.options.importExport;

  return (
    <section class="import-summary" aria-labelledby={headingId}>
      <h3 class="silk" id={headingId}>
        {text.summaryHeading}
      </h3>
      <p class="import-source mono">{fileName}</p>
      <p>{text.addsLead}</p>
      <ul class="import-profiles">
        {plan.profiles.map((profile) => (
          <li key={profile.name} class="import-profile mono">
            {profile.name}
          </li>
        ))}
      </ul>

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
                      {": "}
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

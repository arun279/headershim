import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { detectImportFormat } from "../../../src/core/codec/detect";
import {
  exportHeadershim,
  type ImportError,
  type ImportPlan,
  importHeadershim,
} from "../../../src/core/codec/headershim";
import type { ModHeaderImportWarning } from "../../../src/core/codec/modheader";
import { MAX_IMPORT_BYTES } from "../../../src/core/limits";
import type { RuleDraft, StateDoc } from "../../../src/core/model";
import { err, ok, type Result } from "../../../src/core/result";
import { isRegexSupported } from "../../../src/platform/dnr";
import { useAnnounce } from "../../../src/ui/a11y/LiveRegion";
import { Button } from "../../../src/ui/components/Button";
import { ImportSummary } from "../../../src/ui/components/ImportSummary";
import { copy } from "../../../src/ui/copy";
import { blockedCommitCopy } from "../../../src/ui/state/commit-copy";
import type { Mutations } from "../../../src/ui/state/mutations";
import "./ImportExport.css";

type Plan = ImportPlan<ModHeaderImportWarning>;

/**
 * Import & export. A picked file is detected, decoded, and shown as a pre-apply
 * summary; nothing is written until Import is confirmed, and every
 * parse/format/version/budget failure renders its error copy and changes
 * nothing. Export writes the golden-stable envelope for everything or one
 * profile.
 */
export function ImportExportPage({
  doc,
  mutations,
}: {
  doc: StateDoc;
  mutations: Mutations;
}) {
  const announce = useAnnounce();
  const fileInput = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<Plan | undefined>(undefined);
  const [importError, setImportError] = useState<string | undefined>(undefined);
  const [applyError, setApplyError] = useState<string | undefined>(undefined);
  const [exportId, setExportId] = useState(doc.profiles[0]?.id ?? "");
  const text = copy.options.importExport;

  const clear = () => {
    setPlan(undefined);
    setImportError(undefined);
    setApplyError(undefined);
    if (fileInput.current !== null) {
      fileInput.current.value = "";
    }
  };

  const onFile = async (event: JSX.TargetedEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file === undefined) {
      return;
    }
    clear();
    // Bound the read before it happens: `accept` is a UI hint only, so a
    // several-hundred-MB file would otherwise freeze this tab on read + parse.
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(copy.errors.importTooLarge(importLimitMb()));
      return;
    }
    const built = await buildPlan(await file.text(), doc);
    if (built.ok) {
      setPlan(built.value);
    } else {
      setImportError(importErrorCopy(built.error));
    }
  };

  const onImport = () => {
    if (plan === undefined) {
      return;
    }
    const count = plan.profiles.length;
    void mutations.applyImport(plan).then((outcome) => {
      if (outcome.ok) {
        clear();
        announce(text.imported(count));
      } else {
        setApplyError(blockedCommitCopy(outcome.error));
      }
    });
  };

  const exportProfile = () => {
    const profile = doc.profiles.find((candidate) => candidate.id === exportId);
    if (profile !== undefined) {
      download(
        text.profileFilename(slug(profile.name)),
        exportHeadershim(profile),
      );
    }
  };

  return (
    <section class="page" aria-labelledby="import-export-title">
      <h1 class="page-title" id="import-export-title">
        {text.title}
      </h1>

      <div class="ie-block">
        <h2 class="silk ie-block-label">{text.importHeading}</h2>
        <div class="ie-picker">
          <Button kind="quiet" onClick={() => fileInput.current?.click()}>
            {text.choose}
          </Button>
          <p class="ie-hint">{text.instruction}</p>
          <input
            ref={fileInput}
            type="file"
            class="sr-only"
            tabIndex={-1}
            accept="application/json,.json"
            aria-label={text.fileInputLabel}
            onChange={(event) => void onFile(event)}
          />
        </div>

        {importError !== undefined && (
          <p class="ie-error" role="alert">
            {importError}
          </p>
        )}

        {plan !== undefined && (
          <ImportSummary
            plan={plan}
            applyError={applyError}
            onConvert={(index) => setPlan(convert(plan, index))}
            onImport={onImport}
            onCancel={clear}
          />
        )}
      </div>

      <div class="ie-block">
        <h2 class="silk ie-block-label">{text.exportHeading}</h2>
        <div class="ie-export-row">
          <Button
            kind="quiet"
            onClick={() =>
              download(text.everythingFilename, exportHeadershim(doc))
            }
          >
            {text.exportEverything}
          </Button>
          <label class="ie-export-choice">
            <span class="sr-only">{text.exportChoiceLabel}</span>
            <select
              class="ie-select"
              value={exportId}
              onChange={(event) => setExportId(event.currentTarget.value)}
            >
              {doc.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <Button kind="quiet" onClick={exportProfile}>
            {text.exportOne}
          </Button>
        </div>
        <p class="ie-hint">{text.secretsReminder}</p>
      </div>
    </section>
  );
}

async function buildPlan(
  raw: string,
  doc: StateDoc,
): Promise<Result<Plan, ImportError>> {
  // Parse exactly once here and hand the parsed value to the codecs; they used to
  // re-parse the same string, doubling the transient parse-tree cost on import.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({ kind: "parse-failure" });
  }

  switch (detectImportFormat(parsed)) {
    case "headershim": {
      const result = importHeadershim(parsed, doc.profiles);
      return result.ok
        ? ok({ profiles: result.value.profiles, warnings: [] })
        : result;
    }
    case "modheader": {
      // The ModHeader decoder is the page's only heavy dependency and is needed
      // only when a ModHeader file is actually picked, so it loads on demand.
      const { importModHeader } = await import(
        "../../../src/core/codec/modheader"
      );
      return importModHeader(parsed, doc.profiles, isRegexSupported);
    }
    case "unknown":
      return err({ kind: "unrecognized-format" });
  }
}

// The import byte cap in whole megabytes, for the too-large error copy.
function importLimitMb(): number {
  return Math.floor(MAX_IMPORT_BYTES / (1024 * 1024));
}

function importErrorCopy(error: ImportError): string {
  switch (error.kind) {
    case "parse-failure":
      return copy.errors.importParse;
    case "newer-version":
      return copy.errors.importNewer(
        error.foundVersion,
        error.supportedVersion,
      );
    case "unrecognized-format":
    case "invalid-export":
      return copy.errors.importUnrecognized;
  }
}

/**
 * Freezes the convertible request-time tokens ({{uuid}}, {{timestamp}}) in the
 * rule a warning names, then clears those tokens from the warning — dropping it
 * once nothing convertible remains. A value that is exactly one token is marked
 * generated so the editor's regenerate affordance stays available.
 */
function convert(plan: Plan, warningIndex: number): Plan {
  const warning = plan.warnings[warningIndex];
  if (
    warning?.kind !== "dynamic-token" ||
    warning.conversionOffer === undefined
  ) {
    return plan;
  }
  const convertible = new Set<string>(warning.conversionOffer.tokens);

  let frozen = false;
  const profiles = plan.profiles.map((profile) => ({
    ...profile,
    rules: profile.rules.map((rule) => {
      if (
        frozen ||
        draftName(rule) !== warning.ruleName ||
        rule.value === undefined
      ) {
        return rule;
      }
      if (
        ![...convertible].some((token) => rule.value?.includes(`{{${token}}}`))
      ) {
        return rule;
      }
      frozen = true;
      return freezeTokens(rule, convertible);
    }),
  }));

  const remaining = warning.tokens.filter((token) => !convertible.has(token));
  const warnings =
    remaining.length === 0
      ? plan.warnings.filter((_, index) => index !== warningIndex)
      : plan.warnings.map((entry, index) =>
          index === warningIndex
            ? {
                kind: "dynamic-token" as const,
                ruleName: warning.ruleName,
                tokens: remaining,
              }
            : entry,
        );

  return { profiles, warnings };
}

function freezeTokens(
  rule: RuleDraft,
  convertible: ReadonlySet<string>,
): RuleDraft {
  const at = new Date().toISOString();
  const pure =
    rule.value === "{{uuid}}" && convertible.has("uuid")
      ? "uuid"
      : rule.value === "{{timestamp}}" && convertible.has("timestamp")
        ? "timestamp"
        : undefined;

  let value = rule.value ?? "";
  for (const token of ["uuid", "timestamp"] as const) {
    if (convertible.has(token)) {
      const frozen = token === "uuid" ? crypto.randomUUID() : at;
      value = value.split(`{{${token}}}`).join(frozen);
    }
  }

  return {
    ...rule,
    value,
    ...(pure === undefined ? {} : { generated: { kind: pure, at } }),
  };
}

// The mapping's rule name, reconstructed from the draft: its comment, else the
// header (matching how the ModHeader decoder names each mapped rule).
function draftName(rule: RuleDraft): string {
  return rule.comment?.trim() || rule.header;
}

function download(filename: string, contents: string): void {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "profile"
  );
}

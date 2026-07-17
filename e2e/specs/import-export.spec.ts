import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Worker } from "@playwright/test";
import {
  createHeadershimEnvelope,
  type HeadershimEnvelope,
} from "../../src/core/codec/headershim";
import {
  type ImportPlanWarning,
  importModHeader,
  type RegexValidator,
} from "../../src/core/codec/modheader";
import {
  createProfile,
  createRule,
  type RuleDraft,
  type StateDoc,
} from "../../src/core/model";
import { err, ok } from "../../src/core/result";
import { createV1Seed } from "../../src/core/schema";
import { copy, type Sentence } from "../../src/ui/copy";
import { importWarningCopy } from "../../src/ui/state/import-warning-copy";
import { expect, seedState, test } from "../fixtures";

const strings = copy.options.importExport;
const ALL_WARNINGS_FIXTURE = fileURLToPath(
  new URL("../fixtures/modheader-all-warnings.json", import.meta.url),
);

// A two-profile document whose names never collide with the wiped seed's
// "Default", exercising both directions, a disabled rule, and a distinct badge
// per profile so the round-trip has structure to preserve.
function roundTripDoc(): StateDoc {
  let doc = createV1Seed();
  const build = (draft: RuleDraft) => {
    const [rule, next] = createRule(doc, draft);
    doc = next;
    return rule;
  };
  const request = (over: Partial<RuleDraft>): RuleDraft => ({
    direction: "request",
    operation: "set",
    header: "x-env",
    value: "staging",
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: ["xhr"],
    initiators: [],
    enabled: true,
    ...over,
  });

  const staging = build(request({ header: "x-env", value: "staging" }));
  const disabled = build(
    request({ header: "x-debug", value: "on", enabled: false }),
  );
  const local = build({
    direction: "response",
    operation: "remove",
    header: "server",
    scope: { type: "domains", domains: ["localhost"] },
    resourceTypes: ["xhr"],
    initiators: [],
    enabled: true,
  });

  const stagingProfile = {
    ...createProfile({
      name: "Staging",
      badgeText: "ST",
      color: "blue",
    }),
    rules: [staging, disabled],
  };
  const localProfile = {
    ...createProfile({
      name: "Local",
      badgeText: "LO",
      color: "teal",
    }),
    rules: [local],
  };
  return {
    ...doc,
    profiles: [stagingProfile, localProfile],
    activeProfileId: stagingProfile.id,
  };
}

type ExportedProfile = HeadershimEnvelope["profiles"][number];

async function readDoc(serviceWorker: Worker): Promise<StateDoc> {
  return serviceWorker.evaluate(async () => {
    const { state } = await chrome.storage.local.get("state");
    return state as StateDoc;
  });
}

// The exported form with ids and the export timestamp normalized away, keyed by
// profile name — the round-trip's invariant is over these, not the reallocated
// ids or the moment of export.
function exportedByName(doc: StateDoc): Map<string, ExportedProfile> {
  const epoch = new Date(0);
  return new Map(
    createHeadershimEnvelope(doc, epoch).profiles.map((profile) => [
      profile.name,
      profile,
    ]),
  );
}

test("an export round-trips through the options UI to an equivalent state, off", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const original = roundTripDoc();
  await seedState(serviceWorker, original);

  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/options.html#import-export`,
  );

  const scratch = await mkdtemp(path.join(tmpdir(), "headershim-roundtrip-"));
  const exportFile = path.join(scratch, "export.json");
  try {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: strings.exportEverything }).click(),
    ]);
    await download.saveAs(exportFile);

    // Wipe: the store returns to a fresh seed (the empty "Default" profile).
    // Reload so the import runs against the wiped document — an open page still
    // holding the seed would treat Staging/Local as collisions and suffix them.
    await seedState(serviceWorker, createV1Seed());
    await page.reload();
    await expect(page.locator(".ie-select option")).toHaveText(["Default"]);

    await page.locator('input[type="file"]').setInputFiles(exportFile);

    const summary = page.locator(".import-summary");
    await expect(summary).toBeVisible();
    await expect(summary.locator(".import-counts")).toContainText("2");
    await expect(summary.locator(".import-counts")).toContainText("3");

    await summary
      .getByRole("button", { name: strings.import, exact: true })
      .click();
    await expect(summary).toBeHidden();

    const imported = await readDoc(serviceWorker);
    // The wipe's Default survives; the two imported profiles arrive alongside.
    expect(imported.profiles.map((profile) => profile.name)).toEqual([
      "Default",
      "Staging",
      "Local",
    ]);
    expect(imported.activeProfileId).toBe(imported.profiles[0]?.id);
    expect(imported.profiles.every((profile) => !("enabled" in profile))).toBe(
      true,
    );

    const before = exportedByName(original);
    const after = exportedByName(imported);
    for (const name of ["Staging", "Local"]) {
      const expected = before.get(name);
      if (expected === undefined) {
        throw new Error(`original is missing ${name}`);
      }
      // Rules, their enabled flags, scopes, operations, badge, and color are
      // identical; importing does not change the active profile.
      expect(after.get(name)).toEqual(expected);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

// The thirteen ModHeader warning kinds the fixture is built to produce; four of
// them (tab/tab-group/window/time) deliberately share one copy string, so rows
// are matched on their distinct name plus detail, not the detail alone.
const WARNING_KINDS: readonly ImportPlanWarning["kind"][] = [
  "credential",
  "security-response",
  "request-append-degraded",
  "dynamic-token",
  "cookie-semantics-degraded",
  "set-cookie-semantics-degraded",
  "csp-semantics-degraded",
  "invalid-regex",
  "exclude-url-filter-dropped",
  "initiator-domain-filter-dropped",
  "tab-filter-dropped",
  "tab-group-filter-dropped",
  "window-filter-dropped",
  "time-filter-dropped",
  "url-replacement-dropped",
];

function sentenceText(parts: Sentence): string {
  return parts
    .map((part) => (typeof part === "string" ? part : part.data))
    .join("");
}

test("a ModHeader import surfaces every warning class on the summary", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedState(serviceWorker, createV1Seed());

  // Reproduce the decode the page performs (the real UI uses Chrome's
  // isRegexSupported; RE2 rejects the same lookahead), so the expected rows are
  // computed from the same codec + copy the UI renders — one per warning kind.
  const raw = await readFile(ALL_WARNINGS_FIXTURE, "utf8");
  const rejectLookaround: RegexValidator = async (pattern) =>
    /\(\?[=!<]/.test(pattern) ? err(undefined) : ok(undefined);
  const decoded = await importModHeader(JSON.parse(raw), [], rejectLookaround);
  if (!decoded.ok) {
    throw new Error(`fixture failed to decode: ${decoded.error.kind}`);
  }
  const { warnings: decodedWarnings } = decoded.value;
  expect(decodedWarnings.map((warning) => warning.kind).sort()).toEqual(
    [...WARNING_KINDS].sort(),
  );

  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/options.html#import-export`,
  );
  await page.locator('input[type="file"]').setInputFiles(ALL_WARNINGS_FIXTURE);

  await expect(page.locator(".import-warnings")).toBeVisible();
  await expect(page.locator(".import-warning")).toHaveCount(
    decodedWarnings.length,
  );

  const body = page.locator(".import-warning-body");
  for (const warning of decodedWarnings) {
    const { name, detail } = importWarningCopy(warning);
    await expect(
      body.filter({ hasText: name }).filter({ hasText: sentenceText(detail) }),
    ).toHaveCount(1);
  }
});

import { compileDynamic } from "../../src/core/compile";
import { createRule, type StateDoc } from "../../src/core/model";
import { createV1Seed } from "../../src/core/schema";
import {
  activeTabId,
  expect,
  getDynamicRules,
  getMatchedRuleIds,
  grantActiveTabViaCommand,
  readEcho,
  seedState,
  test,
} from "./fixtures";

// The gate: behaviours only ever confirmed against an unpacked extension, re-run
// against a policy-installed packed CRX before Verify is built on them. A
// divergence here re-opens their designs; see e2e/README.md.

const HEADER = "x-headershim-packed";
const VALUE = "verified";

function ruleDoc(domain: string): StateDoc {
  const seed = createV1Seed();
  const [rule, doc] = createRule(seed, {
    direction: "request",
    operation: "set",
    header: HEADER,
    value: VALUE,
    scope: { type: "domains", domains: [domain] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
  });
  const [profile] = doc.profiles;
  if (profile === undefined) {
    throw new Error("seed document is missing its Default profile");
  }
  return { ...doc, profiles: [{ ...profile, rules: [rule] }] };
}

test.describe("packed-build gate", () => {
  // The CRX force-installs and enables under the machine policy, but its lazy MV3
  // service worker is not surfaced to Playwright on this runner, so the worker
  // handle these specs drive is unobtainable here. This auxiliary packed harness
  // is not part of pnpm e2e; see e2e/README.md.
  test.skip(
    true,
    "Force-installed MV3 service worker is not reachable from Playwright in this environment; the unpacked host-access project owns automated on-wire coverage.",
  );

  test("policy-installed CRX modifies a header on the wire", async ({
    context,
    serviceWorker,
    echoServers,
  }) => {
    const doc = ruleDoc("localhost");
    const desired = compileDynamic(doc);
    await seedState(serviceWorker, doc);
    await expect
      .poll(() => getDynamicRules(serviceWorker).then((rules) => rules.length))
      .toBe(desired.length);

    const page = await context.newPage();
    await page.goto(`${echoServers.h1Url}/`);
    expect((await readEcho(page))[HEADER]).toBe(VALUE);
  });

  test("getMatchedRules returns matches under an activeTab gesture", async ({
    context,
    serviceWorker,
    echoServers,
  }) => {
    const doc = ruleDoc("localhost");
    const desired = compileDynamic(doc);
    await seedState(serviceWorker, doc);
    await expect
      .poll(() => getDynamicRules(serviceWorker).then((rules) => rules.length))
      .toBe(desired.length);

    const page = await context.newPage();
    await page.goto(`${echoServers.h1Url}/`);
    await grantActiveTabViaCommand(page);

    const tabId = await activeTabId(serviceWorker);
    const matched = await getMatchedRuleIds(serviceWorker, tabId);
    expect(matched).toContain(desired[0]?.id);
  });
});

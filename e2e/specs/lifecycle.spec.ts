import { compileDynamic } from "../../src/core/compile";
import { createRule, type StateDoc } from "../../src/core/model";
import { planReconcile } from "../../src/core/reconcile";
import { createV1Seed } from "../../src/core/schema";
import {
  expect,
  getDynamicRules,
  grantAllSitesViaDetails,
  readEcho,
  seedState,
  test,
} from "../fixtures";

const HEADER = "x-headershim-e2e";
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

test("seeded rule reconciles into DNR and reads back normalized-equal", async ({
  serviceWorker,
}) => {
  const doc = ruleDoc("localhost");
  const desired = compileDynamic(doc);

  await seedState(serviceWorker, doc);
  await expect
    .poll(() => getDynamicRules(serviceWorker).then((rules) => rules.length))
    .toBe(desired.length);

  // Echo-shape gate: the rules Chrome hands back must normalize-equal the
  // compiled set, so planReconcile converges — a mismatch here would be a
  // reconcile rewrite loop and would invalidate the normalize/echo assumption
  // the rest of the core is built on.
  const readback = await getDynamicRules(serviceWorker);
  expect(planReconcile(desired, readback)).toBeNull();

  // Drive an observable reconcile round-trip: pausing clears the dynamic rules
  // and unpausing must restore a set that normalize-equals the first readback.
  // The intermediate empty state proves a fresh reconcile actually ran, unlike
  // re-seeding a byte-identical document (which storage.onChanged may swallow).
  await seedState(serviceWorker, {
    ...doc,
    settings: { ...doc.settings, paused: true },
  });
  await expect
    .poll(() => getDynamicRules(serviceWorker).then((rules) => rules.length))
    .toBe(0);

  await seedState(serviceWorker, doc);
  await expect
    .poll(() => getDynamicRules(serviceWorker).then((rules) => rules.length))
    .toBe(desired.length);
  const settled = await getDynamicRules(serviceWorker);
  expect(planReconcile(desired, settled)).toBeNull();
  expect(settled).toEqual(readback);
});

test("h2 echo server negotiates HTTP/2", async ({ context, echoServers }) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h2Url}/`);
  const protocol = await page.evaluate(() => {
    const [navigation] = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[];
    return navigation?.nextHopProtocol;
  });
  expect(protocol).toBe("h2");
});

test("granted rule modifies the header on the wire", async ({
  context,
  serviceWorker,
  extensionId,
  echoServers,
}) => {
  const doc = ruleDoc("localhost");
  await seedState(serviceWorker, doc);
  const desired = compileDynamic(doc);
  await expect
    .poll(() => getDynamicRules(serviceWorker).then((rules) => rules.length))
    .toBe(desired.length);

  const granted = await grantAllSitesViaDetails(
    context,
    extensionId,
    serviceWorker,
  );
  test.skip(
    !granted,
    "Chrome exposes no automatable grant for the optional wildcard host permission in headless mode for this manifest posture; the on-wire modification is gated on the managed-policy grant path (see e2e/README.md).",
  );

  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/`);
  expect((await readEcho(page))[HEADER]).toBe(VALUE);
});

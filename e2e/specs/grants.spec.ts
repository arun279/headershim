import { siteAccessCopy } from "../../src/ui/copy";
import {
  NARROW_H1_PORT,
  NARROW_H2_PORT,
  NARROWED_ORIGIN,
} from "../echo-ports.mjs";
import {
  expect,
  fetchEcho,
  getBadgeText,
  getDynamicRules,
  readEcho,
  seedState,
  seedStateAndWait,
  stateWithRules,
  test,
} from "../fixtures";

const HEADER = "x-headershim-grant-edge";
const VALUE = "active-after-grant";

function dualGrantDoc() {
  const doc = stateWithRules([
    {
      direction: "request",
      operation: "set",
      header: HEADER,
      value: VALUE,
      scope: { type: "domains", domains: ["127.0.0.1"] },
      resourceTypes: ["xhr"],
      initiators: ["localhost"],
      enabled: true,
    },
  ]);
  // A distinct badge lets the poll below see the seed land: the fresh profile
  // seeds as "DE", so a flip to "GR" is unambiguous proof the background read
  // this doc.
  return {
    ...doc,
    profiles: doc.profiles.map((profile) => ({
      ...profile,
      name: "Grants",
      badgeText: "GR",
    })),
  };
}

test("an enabled rule with no grant is compiled out of the ruleset entirely", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
  await seedState(serviceWorker, dualGrantDoc());
  // The seeded profile's badge is the proof that the background woke, read this
  // seed and repainted the toolbar; only after it lands does an empty ruleset
  // mean the rule was dropped rather than not yet processed.
  await expect.poll(() => getBadgeText(serviceWorker)).toBe("GR");
  // Absent, not merely inert. An installed rule would be one action invocation
  // away from applying: activeTab is a host grant, and
  // declarativeNetRequestWithHostAccess honours it for whatever is installed.
  expect(await getDynamicRules(serviceWorker)).toEqual([]);

  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/grant-source`);
  const beforeGrant = await fetchEcho(
    page,
    `${echoServers.h1CrossUrl}/echo.json?permission=before`,
  );
  expect(beforeGrant.status).toBe(200);
  expect(beforeGrant.requestHeaders).not.toHaveProperty(HEADER);
  expect(await getDynamicRules(serviceWorker)).toEqual([]);
});

test("a browser-stored narrowed grant reaches DNR and acts only on its granted scheme", {
  tag: "@narrow-host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  expect(echoServers.h1Url).toBe(`http://localhost:${NARROW_H1_PORT}`);
  expect(echoServers.h2Url).toBe(`https://localhost:${NARROW_H2_PORT}`);
  expect(
    await serviceWorker.evaluate(async () => {
      const permissions = await chrome.permissions.getAll();
      return permissions.origins ?? [];
    }),
  ).toEqual([NARROWED_ORIGIN]);

  const doc = stateWithRules([
    {
      direction: "request",
      operation: "set",
      header: "x-headershim-probe",
      value: "applied",
      scope: { type: "domains", domains: ["localhost"] },
      resourceTypes: ["pages"],
      initiators: [],
      enabled: true,
    },
  ]);
  await seedState(serviceWorker, doc);
  await expect
    .poll(async () => (await getDynamicRules(serviceWorker))[0]?.condition)
    .toMatchObject({
      requestDomains: ["localhost"],
      urlFilter: `|http://localhost:${NARROW_H1_PORT}/`,
    });

  const granted = await context.newPage();
  await granted.goto(echoServers.h1Url);
  expect((await readEcho(granted))["x-headershim-probe"]).toBe("applied");

  const otherScheme = await context.newPage();
  await otherScheme.goto(echoServers.h2Url);
  expect((await readEcho(otherScheme))["x-headershim-probe"]).toBeUndefined();
});

test("response-header rules apply to HTTP-cached responses", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  const header = "x-headershim-cache";
  const cacheDoc = (value: string) =>
    stateWithRules([
      {
        direction: "response",
        operation: "set",
        header,
        value,
        scope: { type: "domains", domains: ["127.0.0.1"] },
        resourceTypes: ["xhr"],
        initiators: [],
        enabled: true,
      },
    ]);
  await seedStateAndWait(serviceWorker, cacheDoc("fresh-rule"));
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/cache-source`);
  const key = crypto.randomUUID();
  const cacheUrl = `${echoServers.h1CrossUrl}/cache.json?key=${key}`;
  const fresh = await fetchEcho(page, cacheUrl);
  expect(fresh.status).toBe(200);
  expect(fresh.responseHeaders[header]).toBe("fresh-rule");
  expect(fresh.requestCount).toBe(1);

  // A different installed value distinguishes applying the current rule to
  // the cached response from merely caching the first modified header.
  await seedStateAndWait(serviceWorker, cacheDoc("cached-rule"));
  const cached = await fetchEcho(page, cacheUrl);
  const stats = await fetchEcho(
    page,
    `${echoServers.h1CrossUrl}/cache-stats.json?key=${key}`,
    { cache: "reload" },
  );
  expect(cached.status).toBe(200);
  // Both the cached body and an uncached server-side counter prove that the
  // second /cache.json fetch did not reach the echo server.
  expect(cached.requestCount).toBe(1);
  expect(stats.requestCount).toBe(1);
  expect(cached.responseHeaders[header]).toBe("cached-rule");
});

// The popup's calm needs-access state — an ungranted rule rendered amber in the
// head (`.lamp.warn` + `.substatus .amber`) with its row owning the sole Grant
// action (`.change-line.needs-access .grant`) — is not reproducible end to end.
// The redesigned popup is tab-scoped: it renders a rule only for the host the
// active tab reports, and it can enter needs-access only when that host is
// readable AND ungranted. No e2e build supplies both. The shipped build has no
// host_permissions, so Chromium redacts tabs.query().url (a probe reads null
// even with the site frontmost) and the popup shows its no-host state with no
// rows. The host-access build exposes the tab URL but grants *://*/* — a
// required, non-revocable permission — so every rule reads live, never
// needs-access. That combination is only reachable in production, where
// clicking the action grants activeTab on an ungranted site.
//
// The state itself is real, works, and is asserted against the exact redesigned
// DOM by unit and integration tests: src/test/popup.test.tsx ("shows an
// ungranted rule amber with a Grant that clears every surface") asserts
// .change-line.needs-access, .substatus .amber, .lamp.warn, and the presence of
// the row's Grant button; src/ui/state/readout.test.ts covers the needs-access
// projection and its missing origins; src/test/grant-flow.integration.test.tsx
// drives the grant/decline/revoke transitions and asserts the surfaces relight
// (through permissions.request/remove, since jsdom cannot answer Chrome's native
// prompt). Needs-access is per-site by nature, so it lives on those rows and not
// on the global toolbar badge.

// Site-access UI half: the Site access page is a projection of the
// browser's live permissions plus the rules' required origins. The shipped
// artifact starts with no optional host grants, so every enabled rule's origin
// sits under needed-but-not-granted, the granted group is empty, and the broad
// grant offer stands. The page must match that reality exactly.
test("the site-access page mirrors the browser's granted and needed origins", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedState(
    serviceWorker,
    stateWithRules([
      {
        direction: "request",
        operation: "set",
        header: "x-a",
        value: "1",
        scope: { type: "domains", domains: ["example.com"] },
        resourceTypes: ["xhr"],
        initiators: [],
        enabled: true,
      },
      {
        direction: "request",
        operation: "set",
        header: "x-b",
        value: "1",
        scope: { type: "domains", domains: ["api.example.com"] },
        resourceTypes: ["xhr"],
        initiators: [],
        enabled: true,
      },
    ]),
  );

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#site-access`);

  const text = siteAccessCopy;
  await expect(
    page.getByRole("heading", { name: text.title, level: 1 }),
  ).toBeVisible();

  const needed = page.getByRole("list", { name: text.neededHeading });
  await expect(needed.locator(".sa-domain")).toHaveText([
    "api.example.com",
    "example.com",
  ]);

  // No grant is obtainable here, so the granted group is absent and the broad
  // grant is offered (not the revoke-all card) — the post-revoke reality.
  await expect(
    page.getByRole("heading", { name: text.grantedHeading, exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".sa-all-sites")).toBeVisible();
  await expect(page.locator(".sa-all-on")).toHaveCount(0);

  // The broad grant is gated by its disclosure. While collapsed, only the
  // consequence and review trigger exist; the permission action is absent
  // from both the DOM and keyboard order.
  const allSites = text.allSites;
  const disclosure = page.getByRole("button", {
    name: allSites.disclosure,
  });
  const allowAll = page.getByRole("button", {
    name: allSites.button,
    exact: true,
  });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(allowAll).toHaveCount(0);

  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".sa-all-warning")).toHaveText(allSites.warning);
  await expect(allowAll).toBeVisible();
  expect(
    await page.locator(".sa-all-details").evaluate((details) => {
      const warning = details.querySelector(".sa-all-warning");
      const button = details.querySelector("button");
      return (
        warning !== null &&
        button !== null &&
        Boolean(
          warning.compareDocumentPosition(button) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        )
      );
    }),
  ).toBe(true);

  // The page is a faithful mirror: its granted rows equal the browser's live
  // origins (both empty), so nothing is claimed that permissions.getAll denies.
  const live = await serviceWorker.evaluate(async () => {
    const all = await chrome.permissions.getAll();
    return (all.origins ?? []).filter((origin) => origin !== "*://*/*");
  });
  expect(live).toEqual([]);
});

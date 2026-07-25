import {
  expect,
  seedState,
  seedStateAndWait,
  stateWithRules,
  test,
} from "../fixtures";

// Three correctness questions the unit runner cannot see, because each turns on
// the real CSS cascade: a base card recipe beating its row modifier by bundle
// emit order, a running rule's spine borrowing the at-rest grey, and a popup
// change row painting a whole-row hover highlight it has no click to justify.
// Only a real browser resolves them, so this drives the real surfaces and reads
// the resolved layout, colour, and hover. Each fails only if its specific defect
// returns.

test("@host-access the all-sites card lays out as a row, not a centred column", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#site-access`);
  const card = page.locator(".sa-all-on");
  await expect(card).toBeVisible();
  expect(await card.evaluate((el) => getComputedStyle(el).flexDirection)).toBe(
    "row",
  );
});

test("@host-access a per-request rule wears the running spine, not the at-rest grey", async ({
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
        header: "x-live",
        value: "on",
        scope: { type: "domains", domains: ["example.com"] },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
      {
        direction: "request",
        operation: "set",
        header: "x-per-request",
        value: "on",
        scope: {
          type: "regex",
          regex: "example\\.com",
          hosts: ["example.com"],
        },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
    ]),
  );

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#rules`);
  await expect(page.locator(".fleet-row.unconfirmed")).toBeVisible();

  const spineOf = (state: string) =>
    page
      .locator(`.fleet-row.${state} .spine`)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);

  // A rule Chrome settles per request is running, not at rest: its spine wears
  // the live hue, never the grey the file used to share with the at-rest rows.
  expect(await spineOf("unconfirmed")).toBe(await spineOf("live"));
});

// A popup change row carries only the controls it truly has: a value-edit
// button, a toggle, and a grant or a remove. The row itself opens nothing, so a
// full-width hover highlight would advertise a row click it never answers. This
// drives the populated popup over a granted host and reads the hovered row's
// background: it stays transparent, and turns a colour only if the whole-row
// hover returns.
test("@host-access a populated popup change row shows no whole-row hover highlight", async ({
  context,
  echoServers,
  extensionId,
  serviceWorker,
}) => {
  const host = new URL(echoServers.h1Url).hostname;
  await seedStateAndWait(
    serviceWorker,
    stateWithRules([
      {
        direction: "request",
        operation: "set",
        header: "x-hover",
        value: "on",
        scope: { type: "domains", domains: [host] },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
    ]),
  );

  const web = await context.newPage();
  await web.goto(`${echoServers.h1Url}/hover`);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  // newPage steals focus to the popup, so its first mount reads no host;
  // fronting the web tab and reloading re-mounts it over the echo host.
  await web.bringToFront();
  await popup.reload();

  const row = popup.locator(".change-line").first();
  await expect(row).toBeVisible();
  await row.hover();
  expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgba(0, 0, 0, 0)",
  );
});

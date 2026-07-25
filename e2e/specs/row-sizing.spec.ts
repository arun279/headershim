import { createV1Seed } from "../../src/core/schema";
import { copy } from "../../src/ui/copy";
import { expect, seedState, stateWithRules, test } from "../fixtures";

// The wire-byte row (verb, header, arrow, value) is one shared rule across the
// popup change line and the options rule row: the header names the change and
// the value is its payload, so under width pressure the value gives way first
// and the header — the row's identifier — keeps its room. Each still keeps a
// floor, so neither collapses to nothing and leaves the arrow over empty space,
// and the profile badge is a fixed glyph that never shrinks. Only layout proves
// it, so these drive the real row in a real browser at a width tight enough to
// force the choice.

// A header longer than the whole row can hold has nowhere to go, so it clips
// rather than shoving the value off the end: the value keeps its floor and the
// badge keeps its square.
test("a header too long for the row keeps the value and the badge", async ({
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
        header: "x-forwarded-authorization-context-identifier",
        value: "on",
        scope: { type: "domains", domains: ["example.com"] },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
    ]),
  );

  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto(`chrome-extension://${extensionId}/options.html#rules`);

  const row = page.locator(".fleet-row").first();
  await expect(row).toBeVisible();

  // The header is longer than the row, so it is the part that gives way and clips.
  const headerClipped = await row
    .locator(".say .k")
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(headerClipped).toBe(true);

  // The value keeps its floor and stays whole, rather than losing every pixel
  // first and leaving the arrow pointing at empty space.
  const value = row.locator(".say .v");
  const valueBox = await value.boundingBox();
  expect(valueBox?.width ?? 0).toBeGreaterThan(20);
  const valueClipped = await value.evaluate(
    (el) => el.scrollWidth > el.clientWidth,
  );
  expect(valueClipped).toBe(false);

  // The badge is a fixed glyph and holds its 15px square in the same tight row.
  const badgeBox = await row.locator(".say .badge-glyph").boundingBox();
  expect(badgeBox?.width ?? 0).toBeGreaterThanOrEqual(14);
});

// The everyday case the priority is for: a header that fits beside a long value
// stays whole, and the value is the part that clips, so a row is never reduced
// to a stub of the name you scan it by. The width is a moderate squeeze, not the
// row's floor: there is room for one of the two to keep its content, and the
// value is what yields it. It fails if the value reclaims priority and squeezes
// the header back down toward its floor.
test("a long value gives way to the header that names the row", async ({
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
        header: "x-request-id",
        value: "0123456789abcdef0123456789abcdef0123456789abcdef",
        scope: { type: "domains", domains: ["example.com"] },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
    ]),
  );

  const page = await context.newPage();
  await page.setViewportSize({ width: 440, height: 720 });
  await page.goto(`chrome-extension://${extensionId}/options.html#rules`);

  const row = page.locator(".fleet-row").first();
  await expect(row).toBeVisible();

  // The header keeps (near enough) all of its content; it is not clipped down to
  // the stub the value used to squeeze it into.
  const headerRatio = await row
    .locator(".say .k")
    .evaluate((el) => el.clientWidth / el.scrollWidth);
  expect(headerRatio).toBeGreaterThan(0.85);

  // The value is the part that gives way, while keeping its own floor.
  const value = row.locator(".say .v");
  const valueClipped = await value.evaluate(
    (el) => el.scrollWidth > el.clientWidth,
  );
  expect(valueClipped).toBe(true);
  const valueBox = await value.boundingBox();
  expect(valueBox?.width ?? 0).toBeGreaterThan(20);
});

// Every row in the Active-changes tape is its own grid, and each resolves to the
// same track widths, so the op glyph lines up row to row. The status word at the
// end of each row is content the glyph and row color already carry, so it gives
// way before the header, which is the row's only identifier. Only layout proves
// it, so this drives the real tape at a tight width with a short-status row above
// a long-status one. It fails if a future edit lets one row's status set every
// row's width (the header collapsing behind a long label two rows down) or knocks
// the op glyphs out of line.
test("a long status gives way to the header and the ops stay aligned", async ({
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
        header: "x-forwarded-authorization-context-identifier",
        value: "on",
        scope: { type: "domains", domains: ["example.com"] },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
      {
        direction: "request",
        operation: "set",
        header: "transfer-encoding",
        value: "chunked",
        scope: { type: "domains", domains: ["example.com"] },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
    ]),
  );

  const page = await context.newPage();
  await page.setViewportSize({ width: 420, height: 720 });
  await page.goto(`chrome-extension://${extensionId}/options.html#traffic`);

  const rows = page.locator(".tape-row");
  await expect(rows).toHaveCount(2);

  // Every row resolves the same track widths, so the op glyph starts at one x.
  const opXs = await rows
    .locator(".tape-op")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
  expect(Math.max(...opXs) - Math.min(...opXs)).toBeLessThan(0.5);

  // The header on the short-status row keeps real width; the long status one row
  // down does not reserve its width here and squeeze the identifier to nothing.
  const shortStatusRow = rows.filter({ has: page.locator(".grant") });
  const header = shortStatusRow.locator(".tape-header");
  const headerBox = await header.boundingBox();
  expect(headerBox?.width ?? 0).toBeGreaterThan(55);
});

// The frame's two width jobs, which pull against each other, proven together at
// one wide window: the content column fills it so the rule list is not stranded
// beside a raw-background void, while the editor that shares that column is a
// form and holds a readable measure of its own instead of stretching a single
// field a metre wide. The popup's narrow window can show neither. It fails if a
// page-level width cap returns (the column stops short of the frame) or if the
// editor leans on one again for its measure (the header field sprawls).
test("a wide window fills the rules column and still bounds the editor", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedState(serviceWorker, createV1Seed());

  const page = await context.newPage();
  await page.setViewportSize({ width: 1512, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/options.html#rules`);

  // The column paints to the frame edge beside the rail; a re-introduced fixed
  // cap would leave it short of the main region.
  await expect(page.locator(".wb-page")).toBeVisible();
  const [columnWidth, mainWidth] = await page.evaluate(() => [
    document.querySelector(".wb-page")?.getBoundingClientRect().width ?? 0,
    document.querySelector(".wb-main")?.getBoundingClientRect().width ?? 0,
  ]);
  expect(mainWidth - columnWidth).toBeLessThan(24);

  await page
    .getByRole("button", { name: copy.options.allRules.newRule })
    .click();

  const editor = page.getByRole("dialog", {
    name: copy.editor.heading("new", "Default"),
  });
  await expect(editor).toBeVisible();

  const nameBox = await editor
    .getByRole("combobox", { name: copy.editor.labels.headerName })
    .boundingBox();
  expect(nameBox?.width ?? 0).toBeLessThan(640);
});

// The reading and manage pages do the opposite width job from the rule list: on
// the same wide window they hold a measure and centre in the column, so a card
// is a reading column and not a full-bleed panel with its controls stranded at
// the far edge. It fails if the page-level measure is dropped (the column fills
// the frame again) or if the page hugs one side instead of centring.
test("a wide window centres the reading pages on a measure", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedState(serviceWorker, createV1Seed());

  const page = await context.newPage();
  await page.setViewportSize({ width: 1512, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/options.html#settings`);

  await expect(page.locator(".wb-page")).toBeVisible();
  const column = await page.locator(".wb-page").boundingBox();
  const main = await page.locator(".wb-main").boundingBox();
  if (column === null || main === null) {
    throw new Error(
      "the page column and its main region must both be laid out",
    );
  }
  const leftGap = column.x - main.x;
  const rightGap = main.x + main.width - (column.x + column.width);
  // Substantial slack on both sides proves a bounded measure, not a filled
  // frame; the two gaps matching proves it is centred rather than left-hugging.
  expect(leftGap).toBeGreaterThan(100);
  expect(Math.abs(leftGap - rightGap)).toBeLessThan(1);
});

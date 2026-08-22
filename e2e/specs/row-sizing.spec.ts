import { createV1Seed } from "../../src/core/schema";
import { copy as editorCopy } from "../../src/ui/copy.editor";
import { copy as optionsCopy } from "../../src/ui/copy.options";
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

// Every row in the Active-changes tape is its own grid and no track varies with
// row content, so the op glyph lines up row to row however differently two rows
// read. Within a row the status keeps its width and the header is the part that
// yields, down to the floor its own stylesheet declares, which is the whole of
// what keeps the row's only identifier readable. Only layout proves any of it,
// so this drives the real tape at the narrowest width the options page is held
// to, with one wide-status row and one narrow-status one. It fails if a row
// loses its op glyph or the glyphs go out of line, if the floor stops holding a
// readable run of the name, if something other than the header's floor is what
// holds the tight row, or if the wide status starts taking width from the other
// row.
test("a long status takes the header's room down to a legible floor, and the ops stay aligned", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedState(
    serviceWorker,
    stateWithRules([
      // Chrome appends to a fixed list of request headers and no others, so this
      // rule is refused, which prints a wide status word. The other rule is a
      // grant away, which prints a narrow one, and sorts above it. Its header is
      // long enough to sit above its own floor with real room to spare, so the
      // comparison below is not two floors reading as equal by accident.
      // Deliberately caveat-free (unlike connection or transfer-encoding): the
      // two-item meta cluster (caveat word beside the Grant pill) is driven in
      // a real browser by header-matrix.spec.ts's "an ungranted rule keeps its
      // transport caveat beside its Grant action", so this fixture stays about
      // the one thing it measures — the header's floor under a wide sibling
      // status.
      {
        direction: "request",
        operation: "append",
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
        header: "x-env-selector-name",
        value: "staging",
        scope: { type: "domains", domains: ["example.com"] },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
    ]),
  );

  const page = await context.newPage();
  // The narrowest width the options page is held to anywhere in this suite, and
  // tight enough that the wide-status row wants more room than it has. Give that
  // row slack and its header stops short of its floor, and no rendered width can
  // tell a floor that is doing its job from one that has been taken away.
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto(`chrome-extension://${extensionId}/options.html#traffic`);

  const rows = page.locator(".tape-row");
  await expect(rows).toHaveCount(2);

  // Exactly one row states the wide status, which is what picks the two rows
  // apart below. The narrow status on the other row is seeded, not checked.
  const longStatusRow = rows.filter({
    hasText: optionsCopy.options.traffic.status.refused,
  });
  const shortStatusRow = rows.filter({
    hasNotText: optionsCopy.options.traffic.status.refused,
  });
  await expect(longStatusRow).toHaveCount(1);

  // Every row resolves the same track widths, so the op glyph starts at one x.
  // Counted first: a spread taken over no glyphs at all is -Infinity, which
  // clears the bound on its own.
  const ops = rows.locator(".tape-op");
  await expect(ops).toHaveCount(2);
  const opXs = await ops.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().x),
  );
  expect(Math.max(...opXs) - Math.min(...opXs)).toBeLessThan(0.5);

  // The floor each header declares, counted in characters of that header's own
  // font, so the bar follows the typography instead of a pixel read off one
  // build. Taken on every row, because the floor is what the browser then
  // enforces on that row's identifier. Six where the stylesheet declares eight,
  // so a considered change to the floor carries here and a collapse does not.
  // First, because a lowered floor also takes the pressure off the row below,
  // and this is the reading that says which of the two happened.
  const headers = rows.locator(".tape-header");
  await expect(headers).toHaveCount(2);
  const floors = await headers.evaluateAll((els) =>
    els.map((el) => {
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;width:1ch";
      el.append(probe);
      const ch = probe.getBoundingClientRect().width;
      probe.remove();
      return Number.parseFloat(getComputedStyle(el).minWidth) / ch;
    }),
  );
  expect(
    Math.min(...floors),
    "the identifier's declared floor no longer holds a readable run of the name",
  ).toBeGreaterThanOrEqual(6);

  const pressured = await longStatusRow.evaluate((row) => {
    const header = row.querySelector(".tape-header") as HTMLElement;
    const stamp = row.querySelector(".tape-stamp") as HTMLElement;
    return {
      headerWidth: header.getBoundingClientRect().width,
      floor: Number.parseFloat(getComputedStyle(header).minWidth),
      overrun: stamp.scrollWidth - stamp.clientWidth,
    };
  });

  // The premise, on its own so that losing it reads as losing it: this row wants
  // more width than it has, which is the only condition under which a floor
  // decides anything. The floor reading above passed, so if this fails the floor
  // is intact and the row has come by slack: retighten the width or the fixture.
  expect(
    pressured.overrun,
    "this test's setup has expired: the row has slack at this width, so its floor is dormant and the assertion below would prove nothing. Not a layout regression",
  ).toBeGreaterThan(0);
  // And it is the header that absorbed all of it, down to its declared floor
  // and stopped there. The status word is the other shrinkable part (its own
  // wrapper shrinks to its own floor too), but Truncate re-cuts the header's
  // own text to fit its measured box, so the header is what gives up room the
  // moment the row is short of it.
  expect(
    pressured.headerWidth,
    "the tight row is not being held by the header sitting on its declared floor",
  ).toBeCloseTo(pressured.floor, 0);

  // The wide status costs width in its own row and in no other: the row that
  // states it carries the narrower identifier, and the row without it keeps
  // real room rather than having been squeezed onto its own floor too, which
  // would make the comparison below prove nothing.
  const shortHeader = shortStatusRow.locator(".tape-header");
  const shortFloorPx = await shortHeader.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).minWidth),
  );
  const roomy = await shortHeader.boundingBox();
  expect(
    roomy?.width ?? 0,
    "the un-pressured row's identifier has been squeezed onto its floor too, so the comparison below proves nothing",
  ).toBeGreaterThan(shortFloorPx * 1.25);
  expect(roomy?.width ?? 0).toBeGreaterThan(pressured.headerWidth);
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
    .getByRole("button", { name: optionsCopy.options.allRules.newRule })
    .click();

  const editor = page.getByRole("dialog", {
    name: editorCopy.editor.heading("new", "Default"),
  });
  await expect(editor).toBeVisible();

  const nameBox = await editor
    .getByRole("combobox", { name: editorCopy.editor.labels.headerName })
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

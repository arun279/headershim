import type { Page } from "@playwright/test";
import type { RuleDraft } from "../../src/core/model";
import { copy, siteAccessCopy } from "../../src/ui/copy";
import type { EchoServers } from "../echo-servers";
import {
  expect,
  fetchEcho,
  getDynamicRules,
  readEcho,
  seedState,
  seedStateAndWait,
  stateWithRules,
  test,
} from "../fixtures";

interface HeaderCase {
  readonly absent?: string;
  readonly draft: RuleDraft;
  readonly expected?: readonly [header: string, value: string];
  readonly name: string;
  readonly requestHeader?: readonly [header: string, value: string];
  readonly survives?: string;
  readonly transport: "cross-host" | "navigation";
}

const common = {
  direction: "request",
  scope: { type: "domains", domains: ["localhost"] },
  resourceTypes: "all",
  initiators: [],
  enabled: true,
} satisfies Omit<RuleDraft, "header" | "operation" | "value">;

const headerCases: readonly HeaderCase[] = [
  {
    name: "User-Agent set",
    draft: {
      ...common,
      operation: "set",
      header: "user-agent",
      value: "Headershim-UA-Verified",
    },
    expected: ["user-agent", "Headershim-UA-Verified"],
    transport: "navigation",
  },
  {
    name: "Origin set",
    draft: {
      ...common,
      operation: "set",
      header: "origin",
      value: "https://origin.headershim.test",
    },
    expected: ["origin", "https://origin.headershim.test"],
    transport: "navigation",
  },
  {
    name: "Origin remove",
    draft: {
      ...common,
      operation: "remove",
      header: "origin",
      scope: { type: "domains", domains: ["127.0.0.1"] },
    },
    absent: "origin",
    survives: "referer",
    transport: "cross-host",
  },
  {
    name: "Referer set",
    draft: {
      ...common,
      operation: "set",
      header: "referer",
      value: "https://referer.headershim.test/path",
    },
    expected: ["referer", "https://referer.headershim.test/path"],
    transport: "navigation",
  },
  {
    name: "Referer remove",
    draft: {
      ...common,
      operation: "remove",
      header: "referer",
      scope: { type: "domains", domains: ["127.0.0.1"] },
    },
    absent: "referer",
    survives: "origin",
    transport: "cross-host",
  },
  {
    name: "Accept-Language set",
    draft: {
      ...common,
      operation: "set",
      header: "accept-language",
      value: "zz-Headershim",
    },
    expected: ["accept-language", "zz-Headershim"],
    transport: "navigation",
  },
  {
    name: "custom header set",
    draft: {
      ...common,
      operation: "set",
      header: "x-headershim-matrix",
      value: "verified",
    },
    expected: ["x-headershim-matrix", "verified"],
    transport: "navigation",
  },
  {
    name: "custom header remove",
    draft: {
      ...common,
      operation: "remove",
      header: "x-before-remove",
      scope: { type: "domains", domains: ["127.0.0.1"] },
    },
    requestHeader: ["x-before-remove", "present-before-dnr"],
    absent: "x-before-remove",
    transport: "cross-host",
  },
  {
    name: "Cookie set",
    draft: {
      ...common,
      operation: "set",
      header: "cookie",
      value: "headershim_cookie=verified",
    },
    expected: ["cookie", "headershim_cookie=verified"],
    transport: "navigation",
  },
];

const h2Drafts: readonly RuleDraft[] = [
  {
    ...common,
    operation: "set",
    header: "host",
    value: "changed.invalid",
  },
  {
    ...common,
    operation: "set",
    header: "x-headershim-h2",
    value: "verified",
  },
];

const traffic = copy.options.traffic;

// What HTTP/2 did with a set rule HTTP/1.1 carried verbatim: the same bytes
// arrive, the request succeeds without the header, the navigation itself dies,
// or (host only) :authority keeps the real host. The field is required so no
// case can join the wire loop without stating its HTTP/2 half.
type H2Wire = "arrives" | "stripped" | "request-failed" | "authority-kept";

interface TransportCaseBase {
  readonly header: string;
  readonly value: string;
}

// A request-failed case must name the Chromium error it measured: without
// that, a rejection is only known to be *some* net:: failure, which a dead
// server or a cascaded half-open connection from an earlier case in this same
// loop can produce just as easily as the header under test.
type TransportCase =
  | (TransportCaseBase & {
      readonly h2: Exclude<H2Wire, "request-failed">;
    })
  | (TransportCaseBase & {
      readonly h2: "request-failed";
      readonly h2Error: RegExp;
    });

// The full measured matrix behind the product's transport caveats. HTTP/1.1
// carried every row as written (host included, rewritten to the rule's value),
// so each case records only its HTTP/2 outcome. Ordered benign first: an
// h2-breaking header kills its own navigation, and the body-contradicting
// content-length leaves the HTTP/1.1 server waiting on a body that never
// comes, so it runs last where the half-open connection has nothing after it.
const transportCases: readonly TransportCase[] = [
  { header: "connection", value: "close", h2: "stripped" },
  { header: "transfer-encoding", value: "chunked", h2: "stripped" },
  { header: "trailer", value: "x-probe", h2: "arrives" },
  { header: "te", value: "trailers", h2: "arrives" },
  { header: "content-length", value: "0", h2: "arrives" },
  { header: "host", value: "changed.invalid", h2: "authority-kept" },
  {
    header: "keep-alive",
    value: "timeout=5",
    h2: "request-failed",
    h2Error: /net::ERR_HTTP2_PROTOCOL_ERROR/,
  },
  {
    header: "upgrade",
    value: "websocket",
    h2: "request-failed",
    h2Error: /net::ERR_HTTP2_PROTOCOL_ERROR/,
  },
  {
    header: "te",
    value: "gzip",
    h2: "request-failed",
    h2Error: /net::ERR_HTTP2_PROTOCOL_ERROR/,
  },
  {
    header: "content-length",
    value: "5",
    h2: "request-failed",
    h2Error: /net::ERR_HTTP2_PROTOCOL_ERROR/,
  },
];

const CONTROL_HEADER = "x-headershim-transport-control";
const CONTROL_VALUE = "landed";

// A header the matrix measures doing both HTTP/2 outcomes is value-conditional
// and carries its own sentence naming the condition; every string comes from
// the copy source, never restated here.
const VALUE_CONDITIONAL: Record<
  string,
  { readonly word: string; readonly note: string }
> = {
  te: { word: traffic.caveat.te, note: copy.advisories.te },
  "content-length": {
    word: traffic.caveat.contentLength,
    note: copy.advisories.contentLength,
  },
};

/**
 * The claim the product must render for a header, derived from the measured
 * relation: stripped on HTTP/2 is the h1-only vocabulary, failing there the
 * h2-breaking vocabulary, arriving intact on both no claim at all; host keeps
 * its canonical sentence. A wire outcome and a rendered claim that disagree
 * fail here, which is this gate's entire point.
 */
function transportUi(
  header: string,
): { readonly word: string; readonly note: string } | undefined {
  const outcomes = new Set(
    transportCases.filter((c) => c.header === header).map((c) => c.h2),
  );
  if (outcomes.has("authority-kept")) {
    return { word: traffic.caveat.h1Only, note: copy.advisories.host };
  }
  if (outcomes.size > 1) {
    const ui = VALUE_CONDITIONAL[header];
    if (ui === undefined) {
      throw new Error(`${header} needs its own value-conditional sentence`);
    }
    return ui;
  }
  if (outcomes.has("stripped")) {
    return { word: traffic.caveat.h1Only, note: copy.advisories.h1Only };
  }
  if (outcomes.has("request-failed")) {
    return {
      word: traffic.caveat.h2Breaking,
      note: copy.advisories.h2Breaking,
    };
  }
  return undefined;
}

// Runs on the static host-access build: the shipped artifact holds no grant for
// localhost, and an ungranted rule is compiled out, so there would be no
// installed rule to read back. Acceptance is a property of the shape, not the build.
test("header operations reconcile into accepted browser rules", {
  tag: "@host-access",
}, async ({ serviceWorker }) => {
  for (const row of headerCases) {
    await seedStateAndWait(serviceWorker, stateWithRules([row.draft]));
    // Inspect the rule Chrome actually accepted and hands back, not the compile
    // output (already unit-covered) — the readback shape is the real gate.
    const installed = await getDynamicRules(serviceWorker);
    expect(installed).toHaveLength(1);
    // Assert the value survived too, not just header+operation — a compile bug
    // dropping or corrupting a set/append value would otherwise pass here.
    expect(installed[0]?.action.requestHeaders?.[0]).toMatchObject({
      header: row.draft.header,
      operation: row.draft.operation,
      ...(row.draft.value === undefined ? {} : { value: row.draft.value }),
    });
  }

  await seedStateAndWait(serviceWorker, stateWithRules(h2Drafts));
  const h2Installed = await getDynamicRules(serviceWorker);
  expect(
    [...h2Installed]
      .sort((a, b) => a.id - b.id)
      .map((rule) => rule.action.requestHeaders?.[0]),
  ).toMatchObject(
    h2Drafts.map((draft) => ({
      header: draft.header,
      operation: draft.operation,
      value: draft.value,
    })),
  );
});

test("HTTP/1.1 header operations are observable on the wire", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  const firstCase = headerCases[0];
  if (firstCase === undefined) {
    throw new Error("header matrix is empty");
  }
  await seedStateAndWait(serviceWorker, stateWithRules([firstCase.draft]));
  const page = await context.newPage();
  for (const [index, row] of headerCases.entries()) {
    if (index !== 0) {
      await seedStateAndWait(serviceWorker, stateWithRules([row.draft]));
    }
    const headers = await exerciseHeaderCase(page, echoServers, row, index);
    if (row.expected !== undefined) {
      expect(headers[row.expected[0]], row.name).toBe(row.expected[1]);
    }
    if (row.absent !== undefined) {
      expect(headers, row.name).not.toHaveProperty(row.absent);
    }
    if (row.survives !== undefined) {
      expect(headers[row.survives], row.name).toBeTruthy();
    }
  }
});

test("Host is a silent no-op over HTTP/2 while a custom header works", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  await seedStateAndWait(serviceWorker, stateWithRules(h2Drafts));

  const page = await context.newPage();
  await page.goto(`${echoServers.h2Url}/host-and-custom`);
  const headers = await readEcho(page);
  expect(headers[":authority"]).toBe(new URL(echoServers.h2Url).host);
  expect(headers[":authority"]).not.toBe("changed.invalid");
  expect(headers["x-headershim-h2"]).toBe("verified");
});

// One lethal header per pass: the h2-breaking members interact, and a dead
// request leaves in-flight chrome-error loads that cascade into later
// measurements. So every case is seeded alone beside a same-instant control
// rule and measured on a fresh page per transport, and the product's claims
// for that same header are read off both rule surfaces in the same pass.
test("transport caveats state what the wire does on each protocol", {
  tag: "@host-access",
}, async ({ context, echoServers, extensionId, serviceWorker }) => {
  for (const [index, row] of transportCases.entries()) {
    await seedStateAndWait(
      serviceWorker,
      stateWithRules([
        { ...common, operation: "set", header: row.header, value: row.value },
        {
          ...common,
          operation: "set",
          header: CONTROL_HEADER,
          value: CONTROL_VALUE,
        },
      ]),
    );

    const h1Page = await context.newPage();
    await h1Page.goto(`${echoServers.h1Url}/transport-${index}-h1`);
    const h1Headers = await readEcho(h1Page);
    await h1Page.close();
    expect(h1Headers[CONTROL_HEADER], `${row.header} HTTP/1.1 control`).toBe(
      CONTROL_VALUE,
    );
    expect(
      h1Headers[row.header],
      `${row.header}: ${row.value} over HTTP/1.1`,
    ).toBe(row.value);

    const h2Page = await context.newPage();
    const h2Target = `${echoServers.h2Url}/transport-${index}-h2`;
    if (row.h2 === "request-failed") {
      // Pinned to the Chromium error this header measured, not just any
      // net:: failure: a dead server or a cascaded half-open connection from
      // an earlier lethal case in this same loop can throw too, and a bare
      // prefix match would pass on either without proving anything about this
      // header.
      await expect(
        h2Page.goto(h2Target),
        `${row.header}: ${row.value} over HTTP/2`,
      ).rejects.toThrow(row.h2Error);
      await h2Page.close();

      // The failed navigation leaves no page to read a control from, so the
      // attribution above rests entirely on the error alone; prove in the
      // same pass that the h2 endpoint is still alive and still speaking h2,
      // so the rejection is this header's doing and not a dead server or a
      // cascaded half-open connection.
      await seedStateAndWait(
        serviceWorker,
        stateWithRules([
          {
            ...common,
            operation: "set",
            header: CONTROL_HEADER,
            value: CONTROL_VALUE,
          },
        ]),
      );
      const recoveryPage = await context.newPage();
      await recoveryPage.goto(`${echoServers.h2Url}/transport-${index}-h2-ok`);
      const recoveryHeaders = await readEcho(recoveryPage);
      expect(
        recoveryHeaders[CONTROL_HEADER],
        `${row.header} HTTP/2 recovery control`,
      ).toBe(CONTROL_VALUE);
      const protocol = await recoveryPage.evaluate(
        () =>
          (
            performance.getEntriesByType("navigation")[0] as
              | PerformanceNavigationTiming
              | undefined
          )?.nextHopProtocol,
      );
      expect(
        protocol,
        `${row.header} HTTP/2 recovery negotiated h2, not a fallback`,
      ).toBe("h2");
      await recoveryPage.close();
    } else {
      await h2Page.goto(h2Target);
      const h2Headers = await readEcho(h2Page);
      expect(h2Headers[CONTROL_HEADER], `${row.header} HTTP/2 control`).toBe(
        CONTROL_VALUE,
      );
      if (row.h2 === "arrives") {
        expect(h2Headers[row.header], `${row.header} over HTTP/2`).toBe(
          row.value,
        );
      } else if (row.h2 === "stripped") {
        expect(
          Object.keys(h2Headers),
          `${row.header} over HTTP/2`,
        ).not.toContain(row.header);
      } else {
        expect(h2Headers[":authority"], "host over HTTP/2").toBe(
          new URL(echoServers.h2Url).host,
        );
      }
      await h2Page.close();
    }

    if (row.h2 === "request-failed") {
      // The recovery check above reseeded the control rule alone; restore the
      // pair the UI assertions below expect to find.
      await seedStateAndWait(
        serviceWorker,
        stateWithRules([
          { ...common, operation: "set", header: row.header, value: row.value },
          {
            ...common,
            operation: "set",
            header: CONTROL_HEADER,
            value: CONTROL_VALUE,
          },
        ]),
      );
    }

    const ui = transportUi(row.header);
    const options = await context.newPage();
    await options.goto(
      `chrome-extension://${extensionId}/options.html#traffic`,
    );
    const tapeRow = options.locator(".tape-row").filter({
      has: options.getByTitle(row.header, { exact: true }),
    });
    // The status word is the access fact and the caveat word rides beside it,
    // never in its place; a row whose header arrived intact on both transports
    // must claim nothing.
    await expect(tapeRow.locator(".tape-status")).toHaveText(
      traffic.status.live,
    );
    if (ui === undefined) {
      await expect(tapeRow.locator(".tape-caveat")).toHaveCount(0);
    } else {
      await expect(tapeRow.locator(".tape-caveat")).toHaveText(ui.word);
    }

    await options.goto(`chrome-extension://${extensionId}/options.html#rules`);
    const fleetRow = options.locator(".fleet-row").filter({
      has: options.getByTitle(row.header, { exact: true }),
    });
    if (ui === undefined) {
      await expect(fleetRow).toHaveCount(1);
      await expect(fleetRow.locator(".why.amber")).toHaveCount(0);
    } else {
      await expect(fleetRow.locator(".why.amber")).toHaveText(ui.note);
    }
    await options.close();
  }
});

// The shipped build holds no grant, so the compiled ruleset stays empty and
// there is no installed rule to poll for: seedState plus a DOM wait, never
// seedStateAndWait, whose all-sites precondition does not hold here.
test("an ungranted rule keeps its transport caveat beside its Grant action", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedState(
    serviceWorker,
    stateWithRules([
      {
        ...common,
        operation: "set",
        header: "transfer-encoding",
        value: "chunked",
        scope: { type: "domains", domains: ["api.example.com"] },
      },
    ]),
  );

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#traffic`);
  const row = page.locator(".tape-row");
  await expect(row).toHaveCount(1);
  // Two independent facts share the row's meta cluster: the transport caveat
  // and the Grant action, side by side rather than one displacing the other.
  await expect(row.locator(".tape-meta > .tape-caveat")).toHaveText(
    traffic.caveat.h1Only,
  );
  await expect(row.locator(".tape-meta > .grant.tape-action")).toHaveText(
    siteAccessCopy.grant,
  );
  // The pill states the access fact itself, so no status word repeats it.
  await expect(row.locator(".tape-status")).toHaveCount(0);
});

async function exerciseHeaderCase(
  page: Page,
  echoServers: EchoServers,
  row: HeaderCase,
  index: number,
): Promise<Record<string, string>> {
  if (row.transport === "navigation") {
    await page.goto(`${echoServers.h1Url}/matrix-${index}`);
    return readEcho(page);
  }

  await page.goto(`${echoServers.h1Url}/matrix-source-${index}`);
  const requestHeaders =
    row.requestHeader === undefined
      ? undefined
      : { [row.requestHeader[0]]: row.requestHeader[1] };
  const result = await fetchEcho(
    page,
    `${echoServers.h1CrossUrl}/echo.json?case=${index}`,
    requestHeaders === undefined ? {} : { headers: requestHeaders },
  );
  expect(result.status).toBe(200);
  return result.requestHeaders;
}

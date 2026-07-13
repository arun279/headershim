import type { Worker } from "@playwright/test";
import { validateUrlFilter } from "../../src/core/scope";
import { expect, getDynamicRules, test } from "../fixtures";

// validateUrlFilter's whole premise is that Chrome refuses exactly these
// urlFilter forms and sinks the atomic updateDynamicRules batch when it sees
// one. FakeDnr does not model the grammar, so this grounds the validator against
// the real browser: the forms it gates must reject, and a form it accepts must
// land. updateDynamicRules is extension-level, so no host grant is involved.
const GATED_PATTERNS = ["||exämple.com^", "||*"] as const;
const ACCEPTED_PATTERN = "||example.com^";
const PROBE_RULE_ID = 987_654;

async function tryInstall(
  worker: Worker,
  urlFilter: string,
): Promise<string | null> {
  return worker.evaluate(
    async ({ filter, id }) => {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [id],
          addRules: [
            {
              id,
              priority: 1,
              action: {
                type: "modifyHeaders",
                requestHeaders: [
                  { header: "x-grammar-probe", operation: "set", value: "1" },
                ],
              },
              condition: { urlFilter: filter, resourceTypes: ["main_frame"] },
            },
          ],
        });
        return null;
      } catch (error) {
        return String(error);
      }
    },
    { filter: urlFilter, id: PROBE_RULE_ID },
  );
}

test("validateUrlFilter gates exactly the urlFilter forms Chrome rejects", async ({
  serviceWorker,
}) => {
  for (const pattern of GATED_PATTERNS) {
    expect(validateUrlFilter(pattern).ok, pattern).toBe(false);
    const rejection = await tryInstall(serviceWorker, pattern);
    expect(rejection, `Chrome must reject urlFilter ${pattern}`).not.toBeNull();
  }

  expect(validateUrlFilter(ACCEPTED_PATTERN).ok).toBe(true);
  const rejection = await tryInstall(serviceWorker, ACCEPTED_PATTERN);
  expect(rejection).toBeNull();
  // getDynamicRules is eventually consistent: the read-back can lag the resolved
  // updateDynamicRules, so poll for the accepted rule to land instead of reading
  // once.
  await expect
    .poll(
      async () =>
        (await getDynamicRules(serviceWorker)).some(
          (rule) => rule.condition.urlFilter === ACCEPTED_PATTERN,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  await serviceWorker.evaluate(
    (id) =>
      chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [id] }),
    PROBE_RULE_ID,
  );
});

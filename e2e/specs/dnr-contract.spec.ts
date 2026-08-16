import type { DnrRule } from "../../src/core/compile";
import {
  MAX_DYNAMIC_RULES,
  MAX_REGEX_RULES,
  MAX_SESSION_OVERRIDES,
} from "../../src/core/limits";
import { createV1Seed } from "../../src/core/schema";
import {
  contractBaseRule,
  contractRuleBatch,
  DNR_CONTRACT_CASES,
  DNR_REGEX_CONTRACT_CASES,
} from "../../src/test/dnr-contract";
import { expect, getDynamicRules, seedStateAndWait, test } from "../fixtures";

const PROBE_RULE_ID = 987_654;

async function update(
  serviceWorker: Parameters<typeof getDynamicRules>[0],
  addRules: DnrRule[],
  removeRuleIds: number[] = [],
): Promise<string | null> {
  return serviceWorker.evaluate(
    async ({ add, remove }) => {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({
          addRules: add,
          removeRuleIds: remove,
        });
        return null;
      } catch (error) {
        return String(error);
      }
    },
    { add: addRules, remove: removeRuleIds },
  );
}

async function updateSession(
  serviceWorker: Parameters<typeof getDynamicRules>[0],
  addRules: DnrRule[],
  removeRuleIds: number[] = [],
): Promise<string | null> {
  return serviceWorker.evaluate(
    async ({ add, remove }) => {
      try {
        await chrome.declarativeNetRequest.updateSessionRules({
          addRules: add,
          removeRuleIds: remove,
        });
        return null;
      } catch (error) {
        return String(error);
      }
    },
    { add: addRules, remove: removeRuleIds },
  );
}

test("matches Chrome's dynamic-rule boundary", {
  tag: "@host-access",
}, async ({ serviceWorker }) => {
  // The probes below drive chrome.declarativeNetRequest directly, so they
  // need the background's own reconciliation of the seeded (empty) doc to
  // have finished settling before they add rules of their own: measured, an
  // unconfined bare seedState here is a real race — the background's reconcile
  // of the just-seeded doc can still be in flight and strip a probe rule that
  // landed while it was computing its own removal batch.
  await seedStateAndWait(serviceWorker, createV1Seed());

  for (const contractCase of DNR_CONTRACT_CASES) {
    await test.step(contractCase.name, async () => {
      const rules = contractRuleBatch(contractCase);
      const ruleIds = [
        ...new Set(
          rules
            .map((rule) => rule.id)
            .filter((id) => Number.isSafeInteger(id) && id > 0),
        ),
      ];
      const rejection = await update(serviceWorker, rules, ruleIds);
      if (contractCase.accepted) {
        expect(rejection).toBeNull();
        await expect
          .poll(async () => {
            const installed = await getDynamicRules(serviceWorker);
            return ruleIds.every((id) =>
              installed.some((candidate) => candidate.id === id),
            );
          })
          .toBe(true);
        expect(await update(serviceWorker, [], ruleIds)).toBeNull();
      } else {
        expect(rejection).not.toBeNull();
        const installed = await getDynamicRules(serviceWorker);
        expect(
          ruleIds.some((id) =>
            installed.some((candidate) => candidate.id === id),
          ),
        ).toBe(false);
      }
    });
  }
});

test("rejects an invalid batch atomically", {
  tag: "@host-access",
}, async ({ serviceWorker }) => {
  // Same reasoning as above.
  await seedStateAndWait(serviceWorker, createV1Seed());
  const installed = contractBaseRule(PROBE_RULE_ID);
  expect(await update(serviceWorker, [installed], [PROBE_RULE_ID])).toBeNull();
  await expect
    .poll(async () =>
      (await getDynamicRules(serviceWorker)).some(
        (candidate) => candidate.id === PROBE_RULE_ID,
      ),
    )
    .toBe(true);

  const invalid = {
    ...contractBaseRule(PROBE_RULE_ID + 1),
    condition: { urlFilter: "||*" },
  };
  expect(
    await update(serviceWorker, [invalid], [PROBE_RULE_ID]),
  ).not.toBeNull();
  await expect
    .poll(async () =>
      (await getDynamicRules(serviceWorker)).some(
        (candidate) => candidate.id === PROBE_RULE_ID,
      ),
    )
    .toBe(true);
  expect(await update(serviceWorker, [], [PROBE_RULE_ID])).toBeNull();
});

test("publishes rule quotas and preflights regex support", async ({
  serviceWorker,
}) => {
  const limits = await serviceWorker.evaluate(() => {
    const dnr = chrome.declarativeNetRequest;
    return {
      dynamic: dnr.MAX_NUMBER_OF_DYNAMIC_RULES,
      regex: dnr.MAX_NUMBER_OF_REGEX_RULES,
      session: dnr.MAX_NUMBER_OF_SESSION_RULES,
      unsafe: dnr.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES,
    };
  });

  expect(limits).toEqual({
    dynamic: 30_000,
    regex: MAX_REGEX_RULES,
    session: 5_000,
    unsafe: MAX_DYNAMIC_RULES,
  });
  expect(MAX_SESSION_OVERRIDES).toBeLessThanOrEqual(limits.session);

  for (const contractCase of DNR_REGEX_CONTRACT_CASES) {
    await test.step(contractCase.name, async () => {
      const result = await serviceWorker.evaluate(
        (regex) => chrome.declarativeNetRequest.isRegexSupported({ regex }),
        contractCase.regex,
      );
      expect(result.isSupported).toBe(contractCase.supported);
      if (!contractCase.supported) {
        expect(result.reason).toBe(contractCase.reason);
      }
    });
  }
});

test("accepts tab identifiers on session rules", async ({ serviceWorker }) => {
  const rule = {
    ...contractBaseRule(PROBE_RULE_ID),
    condition: { tabIds: [1] },
  };
  expect(
    await updateSession(serviceWorker, [rule], [PROBE_RULE_ID]),
  ).toBeNull();
  expect(await updateSession(serviceWorker, [], [PROBE_RULE_ID])).toBeNull();
});

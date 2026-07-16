// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import background from "../../entrypoints/background";
import { App } from "../../entrypoints/popup/App";
import {
  createRule,
  type RuleDraft,
  type Scope,
  type StateDoc,
} from "../core/model";
import { createV1Seed } from "../core/schema";
import type { UpdateRulesOptions } from "../platform/dnr";
import { isRegexSupported } from "../platform/dnr";
import { FakeDnr } from "../platform/dnr.fake";
import { read as readState, write as writeState } from "../platform/store";
import { createMutations } from "../ui/state/mutations";
import { render, settle } from "../ui/test/render";

// The popup's tab is pinned so the readout has the host the seeded rule targets.
vi.mock("../platform/tabs", () => ({
  activeTabId: () => Promise.resolve(5),
  activeTabDomain: () => Promise.resolve("api.acme.dev"),
}));

// The amber can't-run background the badge state machine paints for needs-access
// and the indigo of the seeded Default profile in its live state.
const AMBER = "#B07B00";

function installDnr() {
  const fake = new FakeDnr();
  const handlers = {
    getDynamicRules: vi.fn(() => fake.getDynamicRules()),
    updateDynamicRules: vi.fn((options: UpdateRulesOptions) =>
      fake.updateDynamicRules(options),
    ),
    getSessionRules: vi.fn(() => fake.getSessionRules()),
    updateSessionRules: vi.fn((options: UpdateRulesOptions) =>
      fake.updateSessionRules(options),
    ),
    // The background re-validates every enabled regex against RE2 before it
    // compiles, so the reconcile pass needs this seam wired too.
    isRegexSupported: vi.fn((regex: string) => fake.isRegexSupported(regex)),
  };
  Object.assign(fakeBrowser.declarativeNetRequest, handlers);
  return { fake, ...handlers };
}

let dnr: ReturnType<typeof installDnr>;

beforeEach(() => {
  dnr = installDnr();
});

const mutations = createMutations({ validateRegex: isRegexSupported });

function seed(scope: Scope): StateDoc {
  const draft: RuleDraft = {
    direction: "request",
    operation: "set",
    header: "x-env",
    value: "staging",
    scope,
    resourceTypes: "all",
    initiators: [],
    enabled: true,
  };
  const [rule, next] = createRule(createV1Seed(), draft);
  return {
    ...next,
    profiles: next.profiles.map((profile, index) =>
      index === 0 ? { ...profile, rules: [rule] } : profile,
    ),
  };
}

// The one change reads its health straight off the severity spine.
const state = (root: HTMLElement): string | undefined => {
  const line = root.querySelector(".change-line");
  if (line === null) return undefined;
  return line.classList.contains("needs-access")
    ? "needs-access"
    : line.classList.contains("live")
      ? "live"
      : undefined;
};

async function grant(origin: string) {
  await act(async () => {
    await fakeBrowser.permissions.request({ origins: [origin] });
  });
  await settle();
}

async function revoke(origin: string) {
  await act(async () => {
    await fakeBrowser.permissions.remove({ origins: [origin] });
  });
  await settle();
}

const ORIGIN = "*://*.api.acme.dev/*";

const SCOPES: { name: string; scope: Scope }[] = [
  { name: "domains", scope: { type: "domains", domains: ["api.acme.dev"] } },
  {
    name: "pattern",
    scope: {
      type: "pattern",
      pattern: "||api.acme.dev^",
      hosts: ["api.acme.dev"],
    },
  },
  {
    name: "regex",
    scope: {
      type: "regex",
      regex: "^https://api\\.acme\\.dev/",
      hosts: ["api.acme.dev"],
    },
  },
];

describe.each(SCOPES)("grant flow — $name scope", ({ scope }) => {
  it("declines loud, grant clears every surface with zero DNR writes, revoke re-lights", async () => {
    const setBadge = vi.spyOn(browser.action, "setBadgeBackgroundColor");
    background.main();
    await writeState(seed(scope));
    await settle();

    const root = render(<App />);
    await settle();

    // A rule the user believes is running but can't: loud on the spine and badge.
    expect(state(root)).toBe("needs-access");
    expect(setBadge).toHaveBeenCalledWith({ color: AMBER });

    dnr.updateDynamicRules.mockClear();
    dnr.updateSessionRules.mockClear();
    setBadge.mockClear();

    // The grant clears the loud state without recompiling a single rule.
    await grant(ORIGIN);
    expect(state(root)).toBe("live");
    expect(dnr.updateDynamicRules).not.toHaveBeenCalled();
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
    expect(setBadge).toHaveBeenCalled();
    expect(setBadge).not.toHaveBeenCalledWith({ color: AMBER });

    // A grant revoked from Chrome's own UI re-lights the loud state live — the
    // spine returns to amber and so does the badge.
    setBadge.mockClear();
    await revoke(ORIGIN);
    expect(state(root)).toBe("needs-access");
    expect(setBadge).toHaveBeenCalledWith({ color: AMBER });
  });
});

describe("grant flow — persisting target hosts never recompiles", () => {
  it("writes pattern target hosts to scope.hosts as a converged no-op", async () => {
    background.main();
    const doc = seed({
      type: "pattern",
      pattern: "||api.acme.dev^",
      hosts: [],
    });
    await writeState(doc);
    await settle();
    dnr.updateDynamicRules.mockClear();
    dnr.updateSessionRules.mockClear();

    const profile = doc.profiles[0];
    const rule = profile?.rules[0];
    if (profile === undefined || rule === undefined) {
      throw new Error("seed produced no rule");
    }
    // scope.hosts records which concrete sites a pattern was granted for; it
    // drives grant computation only and is never part of a DNR condition, so
    // the reconcile after this write converges to a no-op. (Initiators, by
    // contrast, compile to initiatorDomains and legitimately recompile.)
    const outcome = await mutations.saveRule(profile.id, rule.id, {
      direction: rule.direction,
      operation: rule.operation,
      header: rule.header,
      ...(rule.value === undefined ? {} : { value: rule.value }),
      scope: {
        type: "pattern",
        pattern: "||api.acme.dev^",
        hosts: ["api.acme.dev"],
      },
      resourceTypes: rule.resourceTypes,
      initiators: rule.initiators,
      enabled: true,
    });
    await settle();

    expect(outcome.ok).toBe(true);
    expect(dnr.updateDynamicRules).not.toHaveBeenCalled();
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();

    // Read storage back: the write landed and the pattern now records the site
    // it was granted for, so a later revoke has a host to relight against.
    const stored = await readState();
    const storedRule = stored.profiles[0]?.rules[0];
    expect(storedRule?.scope).toMatchObject({ hosts: ["api.acme.dev"] });
  });
});

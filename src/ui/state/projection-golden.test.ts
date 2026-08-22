import { describe, expect, it } from "vitest";
import { type Applied, confirm } from "../../core/applied";
import { compile } from "../../core/compile";
import { MAX_REGEX_RULES } from "../../core/limits";
import type { Profile, Rule, StateDoc } from "../../core/model";
import { fleetRules } from "./fleet";
import { computeReadout } from "./readout";

const HOST = "fixture.test";
const FILLER = "fills-regex-band-";

function storedRule(
  id: string,
  num: number,
  changes: Partial<Rule> = {},
): Rule {
  const operation = changes.operation ?? "set";
  return {
    id,
    num,
    direction: "request",
    operation,
    header: `x-${id}`,
    ...(operation === "remove" ? {} : { value: id }),
    scope: { type: "domains", domains: [HOST] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...changes,
  };
}

function fixtureDoc(): StateDoc {
  const active: Profile = {
    id: "active",
    name: "Active",
    badgeText: "AC",
    color: "blue",
    rules: [
      storedRule("placed", 1),
      storedRule("off", 2, { enabled: false }),
      storedRule("refused", 3, { header: ":authority" }),
      storedRule("ungranted", 4, {
        scope: { type: "domains", domains: ["ungranted.fixture.test"] },
      }),
      storedRule("ungranted-initiator", 5, {
        resourceTypes: ["xhr"],
        initiators: ["initiator.fixture.test"],
      }),
      ...Array.from({ length: MAX_REGEX_RULES }, (_, index) =>
        storedRule(`${FILLER}${index}`, index + 6, {
          scope: {
            type: "regex",
            regex: `^https://overflow-${index}\\.fixture\\.test/`,
            hosts: [`overflow-${index}.fixture.test`],
          },
        }),
      ),
      storedRule("over-limit", MAX_REGEX_RULES + 6, {
        scope: {
          type: "regex",
          regex: "^https://overflow.fixture.test/",
          hosts: ["overflow.fixture.test"],
        },
      }),
      storedRule("container", MAX_REGEX_RULES + 7, { header: "x-contained" }),
      storedRule("contained", MAX_REGEX_RULES + 8, { header: "x-contained" }),
      storedRule("spanning", MAX_REGEX_RULES + 9, {
        scope: { type: "domains", domains: [HOST, "ungranted.example"] },
      }),
      storedRule("broad", MAX_REGEX_RULES + 10, { scope: { type: "all" } }),
      storedRule("secured", MAX_REGEX_RULES + 11, {
        direction: "response",
        header: "content-security-policy",
      }),
    ],
  };
  const inactive: Profile = {
    id: "inactive",
    name: "Inactive",
    badgeText: "IN",
    color: "slate",
    rules: [storedRule("other-profile", MAX_REGEX_RULES + 12)],
  };
  return {
    v: 1,
    profiles: [active, inactive],
    activeProfileId: active.id,
    nextRuleNum: MAX_REGEX_RULES + 13,
    settings: { paused: false, theme: "system" },
  };
}

function applied(doc: StateDoc, allSites: boolean): Applied {
  const batch = compile({
    doc,
    overrides: [],
    granted: {
      origins: allSites ? [] : [`https://${HOST}/*`],
      allSites,
    },
    isRegexSupported: () => true,
  });
  const revision = { dynamic: "dynamic", session: "session" };
  const live = confirm(batch, revision, revision);
  if (live.confirmation !== "applied") {
    throw new Error("fixture must be applied");
  }
  return live;
}

// The filler rules exist only to push the last regex rule past the band limit.
// Pinning all thousand of them would bury the records that carry signal.
function surfaces(doc: StateDoc, projection: Applied) {
  return {
    readout: computeReadout({
      applied: projection,
      doc,
      overrides: [],
      tab: { tabId: 1, host: HOST, origin: `https://${HOST}` },
    }),
    fleet: fleetRules(projection, doc).filter(
      (rule) => !rule.ruleId.startsWith(FILLER),
    ),
  };
}

describe("projection golden", () => {
  it("preserves every standing and absent reason under both grants", () => {
    const doc = fixtureDoc();
    const granted = applied(doc, true);
    const restricted = applied(doc, false);
    const standings = [granted, restricted].flatMap(({ batch }) =>
      batch.entries.map((entry) =>
        entry.standing.kind === "placed"
          ? "placed"
          : `absent:${entry.standing.reason.kind}`,
      ),
    );

    expect(new Set(standings)).toEqual(
      new Set([
        "placed",
        "absent:off",
        "absent:refused",
        "absent:ungranted",
        "absent:ungranted-initiator",
        "absent:over-limit",
        "absent:other-profile",
      ]),
    );
    expect({
      granted: surfaces(doc, granted),
      restricted: surfaces(doc, restricted),
    }).toMatchSnapshot();
  });
});

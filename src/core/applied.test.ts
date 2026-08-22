import { describe, expect, it } from "vitest";
import { confirm } from "./applied";
import { compile } from "./compile";
import type { Rule, StateDoc } from "./model";
import { revisionOf } from "./revision";

function state(rules: Rule[]): StateDoc {
  return {
    v: 1,
    profiles: [
      {
        id: "active",
        name: "Active",
        badgeText: "AC",
        color: "blue",
        rules,
      },
    ],
    activeProfileId: "active",
    nextRuleNum: 2,
    settings: { paused: false, theme: "system" },
  };
}

function batch(rules: Rule[] = []) {
  return compile({
    doc: state(rules),
    overrides: [],
    granted: { origins: ["<all_urls>"], allSites: true },
    isRegexSupported: () => true,
  });
}

describe("applied ruleset confirmation", () => {
  it("exposes the compiled batch only for its confirmed revision", async () => {
    const compiled = batch();
    const revision = await revisionOf(compiled.dynamic, compiled.session);

    const missing = confirm(compiled, revision, undefined);
    const mismatched = confirm(compiled, revision, {
      dynamic: "different",
      session: "different",
    });
    const applied = confirm(compiled, revision, revision);

    expect(missing.confirmation).toBe("pending");
    expect(mismatched.confirmation).toBe("pending");
    expect(applied.confirmation).toBe("applied");
    if (applied.confirmation === "applied") {
      expect(applied.batch).toBe(compiled);
    }
  });

  it("confirms equal emitted rulesets when their non-emitted entries differ", async () => {
    const empty = batch();
    const disabled = batch([
      {
        id: "disabled",
        num: 1,
        direction: "request",
        operation: "set",
        header: "x-disabled",
        value: "held",
        scope: { type: "domains", domains: ["example.com"] },
        resourceTypes: "all",
        initiators: [],
        enabled: false,
      },
    ]);

    const emptyRevision = await revisionOf(empty.dynamic, empty.session);
    expect(await revisionOf(disabled.dynamic, disabled.session)).toEqual(
      emptyRevision,
    );
    expect(disabled.entries).toHaveLength(1);
    const confirmed = confirm(disabled, emptyRevision, emptyRevision);
    expect(confirmed.confirmation).toBe("applied");
    if (confirmed.confirmation === "applied") {
      expect(confirmed.batch).toBe(disabled);
    }
  });

  it("keeps former 32-bit digest collisions pending", async () => {
    const first = batch([
      {
        id: "first",
        num: 1,
        direction: "request",
        operation: "set",
        header: "x",
        value: "YV2j=&)&",
        scope: { type: "domains", domains: ["example.com"] },
        resourceTypes: ["pages"],
        initiators: [],
        enabled: true,
      },
    ]);
    const second = batch([
      {
        id: "second",
        num: 1,
        direction: "request",
        operation: "set",
        header: "x",
        value: "AxK]RqsT",
        scope: { type: "domains", domains: ["example.com"] },
        resourceTypes: ["pages"],
        initiators: [],
        enabled: true,
      },
    ]);

    const firstRevision = await revisionOf(first.dynamic, first.session);
    const secondRevision = await revisionOf(second.dynamic, second.session);
    expect(secondRevision).not.toEqual(firstRevision);
    expect(confirm(second, secondRevision, firstRevision).confirmation).toBe(
      "pending",
    );
  });
});

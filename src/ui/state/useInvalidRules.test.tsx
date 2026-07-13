// @vitest-environment happy-dom
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import type { Profile, Rule, Scope } from "../../core/model";
import { err, ok } from "../../core/result";
import { fire, render, settle } from "../test/render";
import { useInvalidRules } from "./useInvalidRules";

function rule(id: string, scope: Scope, enabled: boolean): Rule {
  return {
    id,
    num: 1,
    direction: "request",
    operation: "set",
    header: "x-test",
    value: "1",
    scope,
    resourceTypes: "all",
    initiators: [],
    enabled,
  };
}

function profileOf(rules: Rule[]): Profile {
  return {
    id: "p1",
    name: "Default",
    badgeText: "DE",
    color: "teal",
    enabled: true,
    rules,
  };
}

const validator = vi.fn(async (regex: string) =>
  regex.includes("(") ? err("syntaxError") : ok(undefined),
);

function mount(profiles: Profile[]) {
  const seen: ReadonlySet<string>[] = [];
  function Probe() {
    seen.push(useInvalidRules(profiles, validator));
    return null;
  }
  render(<Probe />);
  return seen;
}

describe("useInvalidRules", () => {
  it("flags disabled rules whose regex the engine rejects", async () => {
    validator.mockClear();
    const seen = mount([
      profileOf([
        rule("bad", { type: "regex", regex: "(unclosed", hosts: [] }, false),
        rule("good", { type: "regex", regex: "ok.*", hosts: [] }, false),
        rule("domains", { type: "domains", domains: ["a.dev"] }, false),
      ]),
    ]);
    await settle();
    expect([...(seen.at(-1) ?? [])]).toEqual(["bad"]);
    expect(validator).toHaveBeenCalledTimes(2);
  });

  it("trusts enabled regex rules — every enable path already validated them", async () => {
    validator.mockClear();
    const seen = mount([
      profileOf([
        rule("live", { type: "regex", regex: "fine.*", hosts: [] }, true),
      ]),
    ]);
    await settle();
    expect(validator).not.toHaveBeenCalled();
    expect(seen.at(-1)?.size).toBe(0);
  });

  it("keeps the set identity stable when nothing changed", async () => {
    let bump: () => void = () => {};
    const profiles = [
      profileOf([
        rule("bad", { type: "regex", regex: "(unclosed", hosts: [] }, false),
      ]),
    ];
    const seen: ReadonlySet<string>[] = [];
    function Probe() {
      seen.push(useInvalidRules(profiles, validator));
      return null;
    }
    function Harness() {
      const [, tick] = useState(0);
      bump = () => tick((n) => n + 1);
      return <Probe />;
    }
    render(<Harness />);
    await settle();
    const first = seen.at(-1);
    fire(() => bump());
    await settle();
    expect(seen.at(-1)).toBe(first);
  });
});

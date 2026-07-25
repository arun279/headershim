import { describe, expect, it } from "vitest";
import { copy } from "../../copy";
import type { LineStatus } from "../../state/readout";
import { changeVerb } from "./changeVerb";

describe("changeVerb", () => {
  it.each<LineStatus>(["live", "unconfirmed", "managed"])(
    "uses the assertive verb for %s",
    (status) => {
      expect(changeVerb(status, "set")).toBe(copy.readout.verb.set);
    },
  );

  it.each<LineStatus>([
    "needs-access",
    "refused",
    "overridden",
    "out-of-sync",
    "off",
    "paused",
  ])("uses the conditional verb for %s", (status) => {
    expect(changeVerb(status, "set")).toBe(copy.readout.heldVerb.set);
  });
});

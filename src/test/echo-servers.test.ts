import { describe, expect, it } from "vitest";
import { echoServerEnvironment } from "../../e2e/echo-servers";

describe("echoServerEnvironment", () => {
  it("pins ports only for the narrow-host-access project", () => {
    const base = { EXISTING: "kept" };

    expect(echoServerEnvironment(base, false)).toEqual(base);
    expect(echoServerEnvironment(base, true)).toEqual({
      ...base,
      HEADERSHIM_LITERAL_GRANT_PORTS: "1",
    });
  });
});

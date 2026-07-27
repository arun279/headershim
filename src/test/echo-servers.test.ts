import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NARROW_H1_PORT } from "../../e2e/echo-ports.mjs";
import { echoServerEnvironment } from "../../e2e/echo-servers";

// The floor this kernel draws port 0 from. Both platforms the harness runs on
// publish it and both are reconfigurable, so the guarantee the harness needs
// comes from the running host and not from a documented default.
function ephemeralFloor(): number {
  if (process.platform === "linux") {
    const range = readFileSync(
      "/proc/sys/net/ipv4/ip_local_port_range",
      "utf8",
    );
    return Number(range.split(/\s+/)[0]);
  }
  return Number(
    execFileSync("sysctl", ["-n", "net.inet.ip.portrange.first"], {
      encoding: "utf8",
    }),
  );
}

describe("narrow-host-access echo servers", () => {
  it("pins the literal port only for the narrow-host-access project", () => {
    const base = { EXISTING: "kept" };

    expect(echoServerEnvironment(base, false)).toEqual(base);
    expect(echoServerEnvironment(base, true)).toEqual({
      ...base,
      HEADERSHIM_LITERAL_GRANT_PORTS: "1",
    });
  });

  it("keeps the pinned port under this host's ephemeral floor", () => {
    expect(NARROW_H1_PORT).toBeLessThan(ephemeralFloor());
  });
});

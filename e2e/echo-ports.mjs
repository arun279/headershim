// A built manifest cannot learn a runtime port, so the narrow-host-access build
// bakes NARROWED_ORIGIN in and its HTTP/1.1 echo server alone binds a literal
// port. It sits below the floor the kernel draws port 0 from, so an echo server
// in a concurrent worker is not handed it first; src/test/echo-servers.test.ts
// reads the running host's floor, so a host configured to reach this low fails
// that check instead of failing the harness. The HTTPS echo stays ephemeral: no
// manifest names it, and every https origin sits outside an http-only grant
// whatever port it lands on.
export const NARROW_H1_PORT = 15_848;
export const NARROWED_ORIGIN = `http://localhost:${NARROW_H1_PORT}/*`;

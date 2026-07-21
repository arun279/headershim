# End-to-end harness

Playwright drives the built extension against local echo servers to prove that
compiled `declarativeNetRequest` rules reach the browser network stack. Unit
tests cover compilation and reconciliation, but the on-wire assertions here
read the headers that the servers actually received.

## Running

```sh
pnpm e2e
HEADED=1 pnpm e2e
```

`pnpm e2e` builds two unpacked artifacts before Playwright starts:

- `.output/chrome-mv3` is the shipped build. It declares only
  `optional_host_permissions: ["*://*/*"]`, and the `shipped` Playwright
  project loads it for every untagged test.
- `.output/chrome-mv3-e2e-hostaccess` is the test-only traffic build. Setting
  `E2E_HOST_ACCESS=1` adds `host_permissions: ["*://*/*"]` and selects the
  distinct output directory. The `host-access` Playwright project loads it
  only for tests tagged `@host-access`.

The static grant lets Chromium apply DNR rules immediately without an optional
permission prompt. Everything else in the two builds is identical. The
test-only artifact is never packaged or checked as a release artifact.
`scripts/manifest-policy.mjs` continues to inspect only
`.output/chrome-mv3`, requiring zero static host permissions and the exact
optional wildcard permission.

The extension uses standard WebExtension manifest permissions and
`wxt/browser` in shipped code. The test grant does not introduce a Chrome-only
application path; Playwright uses Chromium to exercise Chromium's DNR network
implementation.

## Echo servers

`scripts/echo-server.mjs` starts two servers on ephemeral ports:

- an HTTP/1.1 server reachable as both `localhost` and `127.0.0.1`;
- an HTTP/2 server using a throwaway self-signed certificate.

Both reflect received request headers as JSON inside `<pre id="echo">`. JSON
and cache endpoints expose CORS headers so a page on `localhost` can make a
genuine cross-host request to `127.0.0.1`. The HTTP/2 navigation separately
asserts `nextHopProtocol === "h2"`.

## Real traffic coverage

Every row below runs in the `host-access` project and asserts an observable
network result. None gates or weakens its assertions based on permission state.

| Test | On-wire proof |
|---|---|
| `granted rule modifies the header on the wire` | A stored rule reconciles into Chrome and the HTTP/1.1 server receives `x-headershim-e2e: verified`. |
| `Chrome applies set/append/remove conflicts in visible order` | Three response-header scenarios prove set plus append ordering, remove dominance, and a changed winner after reorder. |
| `default resource types include top-level navigation` | A rule using the default resource set modifies a real main-frame request. |
| `HTTP/1.1 header operations are observable on the wire` | Nine request-header scenarios cover User-Agent, Origin set/remove, Referer set/remove, Accept-Language, custom set/remove, and Cookie. Removal rows also assert that a neighboring header survives. |
| `Host is a silent no-op over HTTP/2 while a custom header works` | The server keeps the original `:authority`, rejects the attempted Host replacement, and receives the custom header from the same ruleset. |
| `response-header rules apply to HTTP-cached responses` | After the first modified response is cached, the installed rule's value changes; the cache hit exposes the new value while both the cached body and server counter prove that no second request reached the server. |
| `a granted This-tab override modifies a same-origin request` | A tab-scoped session rule changes the echoed same-origin request header. |
| `a same-site navigation and an SPA route change keep the override` | Static host access exposes each updated tab URL; the session rule remains installed after both a navigation and `history.pushState`. |

The shipped-build project retains the permission-sensitive coverage: missing
access remains a silent network no-op, needs-access UI stays loud, the Site
access page mirrors the browser's empty grant state, and the extension manifest
keeps its optional-only install posture. Other untagged tests exercise DNR
readback normalization, pause and resume, self-healing, tab confinement,
cross-site cleanup, badges, import/export, keyboard operation, accessibility,
and options authoring.

## Browser-owned interactions excluded from the suite

Playwright cannot synthesize browser toolbar gestures, the operating system's
extension shortcut dispatcher, or native permission prompts. The suite does
not carry permanent placeholders for those platform interactions. Runnable
tests cover the application behavior on each side of the boundary:

| Boundary | Runnable coverage |
|---|---|
| DNR handling of `Content-Length` | Chrome currently sends a DNR-set value over HTTP/1.1 even when it conflicts with the body length. Whether the browser sends, rewrites, or rejects that value has no HeaderShim branch or state transition, so the suite does not pin it. |
| Global extension shortcuts | `src/test/background.test.ts` drives `toggle-pause` and `next-profile` through `commands.onCommand`. `keyboard.spec.ts` exercises the equivalent popup commands with real key events. Opening the popup for `_execute_action` is browser-owned. |
| Destination-only access followed by initiator access | `src/core/grants.test.ts` proves the initiator is the remaining grant gap. `src/test/background.test.ts` proves grant changes refresh status with zero DNR rewrites. `grants.spec.ts` keeps the real missing-access 200 response and absent-header assertion. |
| Revoking broad access while a narrow grant exists | `src/test/options-site-access.test.tsx` clicks the all-sites revoke control, proves the narrow permission survives, keeps its rule in Granted, and moves only the broad-covered rule to Needed. |

The separate `e2e/packed` harness remains available for CRX and managed-policy
experiments through the `e2e:packed:*` scripts. It is not part of `pnpm e2e`
and is not a substitute for the unpacked on-wire project above.

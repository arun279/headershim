# End-to-end harness

Playwright drives the built extension against local echo servers to check the
one thing unit and integration tests cannot: that a compiled rule actually
reaches the browser's network stack. `declarativeNetRequest` runs inside Chrome,
so the only honest proof is a real request whose headers we read back off the
wire.

## Running

```
pnpm e2e            # builds the extension, then runs the specs headless
HEADED=1 pnpm e2e   # same, with a visible window (local debugging)
```

The extension is loaded unpacked via a persistent context (`channel: 'chromium'`,
headless). `scripts/echo-server.mjs` starts two servers on ephemeral ports —
HTTP/1.1 in the clear and HTTP/2 behind a throwaway self-signed cert — each
reflecting the request headers it received as JSON inside `<pre id="echo">`.
The HTTP/1.1 server is also reachable through a `127.0.0.1` alias for genuine
cross-host fetches. Its JSON and cache endpoints expose CORS headers so specs can
inspect subresource requests and distinguish a cache hit from another server
request.

## What is automated vs. what stays a checklist

Some behaviour is genuinely not scriptable from Playwright and is recorded here
honestly rather than faked. This table starts with the smoke case and grows as
later specs land.

| Area | Verifies | Automated | Notes |
|---|---|---|---|
| Pipeline + echo-shape gate | Rule seeded into storage drives compile → reconcile → DNR; `getDynamicRules` reads back **normalized-equal** to the compiled set and a second reconcile is a no-op | ✅ headless | Pins the normalize/echo assumption in real Chrome. Observed: normalized-equal **holds** — Chrome echoes the rule with the same field values and resource-type ordering; `planReconcile` returns `null` on read-back. |
| HTTP/2 negotiation | The h2 echo server negotiates HTTP/2 | ✅ headless | Asserted via `performance` navigation timing `nextHopProtocol === 'h2'`; also exercises the self-signed cert + `--ignore-certificate-errors` path. |
| On-wire header modification | A granted rule sets a header on a real request | ⏸ deferred | See "Grant automation" below. The assertion is written and runs, but skips when no host grant is obtainable; the deterministic grant lives in the packed-build policy path. |
| Header-operation rule shapes | User-Agent, Origin, Referer, Accept-Language, custom, Cookie, Host, and removal rules are accepted by Chrome and read back normalized-equal | ✅ headless | Runs without host access because installing and reading dynamic rules does not require a live granted request. |
| HTTP/1.1 header matrix | Set/remove behavior is observed by the local server, including cross-host Origin/Referer survivor assertions | ⏸ self-skips without grant | Every run first attempts the wildcard grant. The complete table runs when it lands; otherwise the accepted/readback shapes remain enforced by the headless row above. |
| HTTP/2 Host behavior | `Host` remains the original authority while a custom header on the same request is modified | ⏸ self-skips without grant | The h2 request and both assertions share one rule set and one navigation; the test records the unavailable wildcard grant as its skip reason. |
| Missing-access silent no-op | A cross-host request succeeds with the already-installed target-and-initiator rule absent when access is missing | ✅ headless | Uses a rule with both a `127.0.0.1` destination and a named `localhost` initiator; the request returns 200, the header stays absent, and DNR readback remains unchanged. This supports, but does not replace, the exact destination-only case below. |
| Destination-only → initiator transition | Destination-only access gives 200 + absent header; adding initiator access makes the next request work without a rule/storage interaction | ⏸ self-skips without per-origin grant | The exact executable flow is retained, but a fresh unpacked profile cannot be put into the destination-only starting state by Playwright; the all-sites Details toggle cannot create that midpoint. |
| Conflict order | Earlier set/remove operations shadow later incompatible operations, appends stack when allowed, and reorder changes the winner | ⚠️ split | Compilation priorities and conflict detection are headless. The same set/append/remove cases are installed together and asserted on response headers when host access lands; that on-wire half self-skips otherwise. |
| Default main-frame coverage | The default resource set compiles with `main_frame` and modifies a top-level navigation | ⚠️ split | Compiled/readback shape is headless; the real navigation assertion self-skips without a host grant. |
| Pause/resume rule state | Pausing clears dynamic rules and resuming restores the normalized prior set | ✅ headless | Uses real storage events and Chrome dynamic-rule readback. On-wire traffic and persistent-context restart are not claimed by this row. |
| Reconcile self-heal | Direct dynamic-rule corruption is detected, repaired from stored state, and settles to a no-op plan | ✅ headless | The corruption calls Chrome's update API directly, bypassing the extension write path, before a storage change triggers recovery. |
| Cached response behavior | A fresh response is modified, a cache hit exposes the server header, and the server request count stays at one | ⏸ self-skips without grant | The cache assertion requires the first response to prove real DNR modification, so it is not marked green when access cannot be granted. |
| Network-managed content length | A rule value of `999` is accepted but the outgoing POST carries the body length selected by the network stack | ⏸ self-skips without grant | The accepted/readback rule is exercised before the grant attempt; the on-wire value is enforced only when access lands. |
| Grant-dialog verbatims / multi-origin prompt wording | Native permission-prompt copy | 📋 checklist | Native prompts are not scriptable (below); captured out of band. |
| Packed: on-wire header modification | A compiled rule sets a header under a policy-installed CRX with a `runtime_allowed_hosts` grant | ⏳ pending first CI run | `e2e/packed/`, Linux CI only. Confirms the grant path that the unpacked run must skip. |
| Packed: `getMatchedRules({tabId})` | Matched rules return under an `activeTab` gesture on the packed CRX (only ever confirmed unpacked) | ⏳ pending first CI run | `e2e/packed/`, Linux CI only. The gesture is the `_execute_action` command; a divergence re-opens the Verify design. |
| Packed: `displayActionCountAsBadgeText` | The count badge paints on the packed CRX (only ever confirmed unpacked) | ⏳ pending first CI run | `e2e/packed/`, Linux CI only. A divergence re-opens the count-badge design. |

## Grant automation

headershim declares **no** `host_permissions` and only
`optional_host_permissions: ["*://*/*"]`, requesting host access at runtime — the
posture that keeps the install surface clean. That posture has a consequence for
automation, confirmed empirically against this Chromium build:

- The native `permissions.request()` prompt is browser-level UI. Playwright,
  Puppeteer, and CDP all agree it cannot be accepted programmatically; it hangs
  in headless and requires OS-level input otherwise.
- The extension's Details page (`chrome://extensions/?id=…`) exposes only the
  "allow on the sites this extension requests" toggle, which governs *declared*
  host patterns. With none declared, toggling it grants no origin — the
  `grantAllSitesViaDetails` helper drives it and reports back that no grant
  landed.
- That helper has no per-origin mode. It therefore cannot stage a
  destination-only grant followed by an initiator grant. The unpacked suite
  separately enforces the missing-access 200 + absent-header behavior and keeps
  the exact destination-only transition as a reasoned self-skip.
- Extension host grants live in MAC-protected `Secure Preferences` and are
  re-derived from the manifest when an unpacked extension is reloaded, so
  pre-seeding the profile does not stick.

So an on-wire header modification cannot be granted in a headless unpacked run
without either OS input or an `ExtensionSettings` managed policy. The policy path
is deterministic and headless-friendly but installs system policy, so it belongs
to the **packed-build variant** (`e2e/packed/`), which grants
`runtime_allowed_hosts` and asserts the modification there. Revocation, by
contrast, needs no dialog (`permissions.remove()` from an extension page) and is
available to specs directly.

The on-wire smoke assertion is kept in `lifecycle.spec.ts` and runs its grant
attempt every time; it self-skips with a recorded reason when the grant does not
land, and enforces the header the moment a run *can* grant (headed with OS input,
a future Chromium affordance, or the policy path). It is never silently dropped.

## Packed-build gate (`e2e/packed/`)

Verify (getMatchedRules) and the count badge (displayActionCountAsBadgeText)
were only ever confirmed against an *unpacked* extension. This gate re-checks
them, plus one on-wire header modification, against a **policy-installed packed
CRX** before either feature is built — a divergence re-opens their designs.

The pieces:

- `pack.mjs` packs `.output/chrome-mv3` into a signed CRX using the Chromium that
  Playwright already downloads (`--pack-extension`). The signing key is generated
  once into `.artifacts/` (git-ignored, never committed) and the extension id is
  derived from it, so the policy and the update manifest agree on one id.
- `update-server.mjs` serves the Omaha update manifest and the CRX that Chrome's
  force-install policy fetches. Reused by the later store-approximation rerun.
- `policy/managed-policy.json` + `policy.mjs` render the `ExtensionSettings`
  force-install policy into `/etc/opt/chrome/policies/managed/`.
  `runtime_allowed_hosts` grants host access without the runtime prompt — the
  deterministic stand-in for the grant the unpacked harness cannot script.

This path installs machine policy and only works on the Linux CI runner, so the
specs skip themselves off Linux and the gate runs in its own workflow
(`.github/workflows/e2e-packed.yml`, on `workflow_dispatch` and when
`e2e/packed/**` changes). It runs Google Chrome (`channel: 'chrome'`, the only
build that reads that policy directory) headed under Xvfb.

Locally you can exercise everything except the policy install and the Chrome run:

```
pnpm e2e:packed:pack        # build + pack the CRX
pnpm e2e:packed:selfcheck   # pack, serve, and render the policy; assert their shape
```

The three gate outcomes are marked *pending first CI run* in the table above
until a real Linux run reports them.

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

## What is automated vs. what stays a checklist

Some behaviour is genuinely not scriptable from Playwright and is recorded here
honestly rather than faked. This table starts with the smoke case and grows as
later specs land.

| Area | Verifies | Automated | Notes |
|---|---|---|---|
| Pipeline + echo-shape gate | Rule seeded into storage drives compile → reconcile → DNR; `getDynamicRules` reads back **normalized-equal** to the compiled set and a second reconcile is a no-op | ✅ headless | Pins the normalize/echo assumption in real Chrome. Observed: normalized-equal **holds** — Chrome echoes the rule with the same field values and resource-type ordering; `planReconcile` returns `null` on read-back. |
| HTTP/2 negotiation | The h2 echo server negotiates HTTP/2 | ✅ headless | Asserted via `performance` navigation timing `nextHopProtocol === 'h2'`; also exercises the self-signed cert + `--ignore-certificate-errors` path. |
| On-wire header modification | A granted rule sets a header on a real request | ⏸ deferred | See "Grant automation" below. The assertion is written and runs, but skips when no host grant is obtainable; the deterministic grant lives in the packed-build policy path. |
| Grant-dialog verbatims / multi-origin prompt wording | Native permission-prompt copy | 📋 checklist | Native prompts are not scriptable (below); captured out of band. |

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

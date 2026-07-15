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

## What is automated vs. what needs manual verification

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
| This-tab confinement | A This-tab override compiles to a session rule whose condition names only that tab and its origin | ✅ headless | `getSessionRules` read-back is normalized-equal to `compileSession`; asserts `tabIds === [thisTab]`, `requestDomains === [origin]`, and `main_frame` in the resource set. Confinement is the rule's own condition, so the main frame + same-origin subresources are in scope while cross-origin subresources and every other tab are structurally excluded — independent of any grant. |
| This-tab cross-tab isolation | Opening a second same-origin tab and a cross-origin tab does not widen the override | ✅ headless | The session band still names only the tab the override was added to; the on-wire "other tabs unmodified even with all-sites granted" half is structurally implied and revalidated on the packed build. |
| This-tab lifetime, cross-site ends | A cross-site navigation deletes the override rows and an A→B→A round trip stays stopped; closing the tab ends it | ✅ headless | Cross-origin `tabs.onUpdated` and `tabs.onRemoved` drain the session band; returning to A does not resurrect the rows. |
| This-tab lifetime, same-site continues | A same-site navigation and an SPA route change keep the override | ⏭ env-skip | Telling a same-site hop from a cross-site one needs `tab.url` in `tabs.onUpdated`, exposed only while the activeTab grant is live. Headless, `url === undefined` on every navigation and the background prunes conservatively, so only the cross-site-ends half is observable. Explicit `test.skip`; verified manually against real Chrome before release. |
| This-tab on-wire modification | A granted This-tab override modifies a same-origin request | ⏸ self-skips without grant | Exact flow retained; seeding happens after navigation so no hop prunes the row. Skips when the activeTab grant cannot be scripted. |
| Loud needs-access (UI half) | An ungranted rule lights the popup annunciator's `needs-access` state with its one-click recovery | ✅ headless | Opens `popup.html`, asserts `.annunciator[data-state="needs-access"]` and a grant-access button. (The `role` starts `alert` and settles to `status` after the alert-once announce, so it is not asserted.) |
| Badge count mode | Count mode engages the Chrome-managed count badge | ✅ headless | Per-tab `getBadgeText` returns the `<<declarativeNetRequestActionCount>>` sentinel (proof `displayActionCountAsBadgeText === true`) with the focused profile's color; the live *number* needs matched traffic and is verified manually against real Chrome before release. |
| Badge initials + This-tab "T" | Initials mode paints the focused profile's text; with no profile enabled a This-tab override marks its tab "T" while the global badge stays empty | ✅ headless | Read back via `getBadgeText` global and per-tab. Modified traffic is never invisible. |
| Badge precedence + no stale bleed | Paused (grey) and needs-access (amber) outrank content mode and sweep per-tab text | ✅ headless | Starting from a tab showing "T", entering each global tier clears that tab's text to empty (no bleed-through when switching to it) and paints the tier color (`#6E7B88` grey, `#B07B00` amber), asserted via `getBadgeText`/`getBadgeBackgroundColor`. |
| Verify gesture premise | Without a gesture-granted activeTab (and with `declarativeNetRequestFeedback` barred by policy), `getMatchedRules({tabId})` rejects | ✅ headless | Confirms the reason Verify is a per-tab, on-demand, gesture-driven feature. Establishes the boundary the deferred rows below sit behind. |
| Verify popup gesture | Whether the popup's Verify button, under the activeTab grant from the action click / `_execute_action`, counts as an activeTab-granting gesture for `getMatchedRules` | ⏭ env-skip | The action click and `_execute_action` are browser-level UI unscriptable by Playwright/CDP. Explicit `test.skip`; answered by manual verification against real Chrome. |
| Verify tallies + edit-window attribution | Per-rule tallies attribute correctly after an insert within the 5-minute window | ⏭ env-skip | Needs a gesture-granted `getMatchedRules`. Explicit `test.skip`; the stable-id attribution itself is unit-tested (`decodeMatches`). Verified manually against real Chrome before release. |
| Verify quota | 21+ rapid gesture-initiated Verify calls succeed under the gesture exemption | ⏭ env-skip | Needs a real gesture per call. Explicit `test.skip`; verified manually against real Chrome before release. |
| Broad-grant revocation survival | Whether individually granted sites survive revoking a broad all-sites grant | ⏭ env-skip | Staging it needs a real all-sites grant to then revoke, which the unpacked headless posture cannot obtain. Explicit `test.skip`; verified manually against real Chrome before release. |
| Site-access UI half | The Site access options page lists granted and needed-but-not-granted origins matching the browser's real permission state | ✅ headless | The page is a projection of `permissions.getAll` + the rules' required origins. No host grant is obtainable in this posture (same reason the survival half above is deferred), so the browser's reality is "nothing granted": every enabled rule's origin sits under needed-but-not-granted, the granted group is empty, and the broad-grant offer (not the revoke card) stands. The broad-grant action is absent from the DOM and keyboard order until its warning disclosure opens, where the warning precedes the action. The spec asserts that projection and cross-checks the empty granted rows against a live `permissions.getAll`. Populating the granted group under a real grant, and the revoke-survival question, are verified manually against real Chrome before release. |
| Import/export round-trip | Export → wipe → import through the real options UI yields an equivalent state with the imported profiles off | ✅ headless | Drives the built options page: export downloads the golden envelope, the store is wiped to a fresh seed, the file re-imports through the summary screen, and the applied profiles are compared (ids and export timestamp normalized) — identical except every imported profile arrives disabled. |
| ModHeader import warnings | Every mapping warning class is itemized on the pre-apply summary | ✅ headless | A two-profile ModHeader fixture (`e2e/fixtures/modheader-all-warnings.json`) exercises all thirteen warning kinds, including a real RE2-invalid pattern rejected by Chrome's `isRegexSupported`; the summary renders one row per warning with each class's copy. |
| Accessibility | Zero axe violations (names/roles, contrast from the real tokens, ARIA) on the popup states and options surfaces, both themes | ✅ headless | `@axe-core/playwright` over `wcag2a/aa`, `wcag21a/aa`, `wcag22aa` — the statically-decidable AA slice. Popup: first-run, needs-access + rule list, paused, rule editor, This-tab composer, grant step, Verify panel. Options: profiles, site access, import & export, settings, about, and the import summary. Each `<html>` carries the asserted theme, and reduced motion is emulated so contrast is read in the resting state, not mid-transition. Logical focus order and keyboard operability are proven by the keyboard walk below, not by axe. |
| Explicit rule-editor commit | A draft saves only through Create rule / Save changes, Enter in a single-line commit field, or Ctrl/Cmd+Enter | ✅ headless | Pointer changes to Direction, Operation, URL pattern/Regex scope, and All sites leave the full-popup editor open and storage unchanged. Focus leaving a field and stray clicks do the same. Value is asserted to be a textarea; plain Enter neither saves nor closes it. Dirty Esc/Cancel requires a discard decision. |
| Keyboard-model walk (popup) | Every automatable in-popup binding operates through real key events | ✅ headless | `n`/`t`/`v` open their surfaces, `p` toggles pause, digit `1–9` switches profiles exclusively while `Shift+1–9` toggles without turning others off, list `↑/↓` move roving focus, and row `Enter`/`Space`/`Delete` edit/toggle/delete. In the editor, single-line Enter saves, Value Enter stays in the draft, Ctrl/Cmd+Enter saves and focuses the grant Allow button without activating it, and dirty Esc opens the discard guard. |
| Options master-detail authoring | A rule can be created and edited in the selected profile's detail pane | ✅ headless | The New rule action, field entry, Create rule, row-open, edit, Save changes, and Grant later path are all driven with keyboard events. The resulting stored values and blocked row state are asserted after both commits. |
| Popup header controls | Profiles, theme, and options are available without leaving the working popup | ✅ headless | The + chip creates a named profile, makes it the sole active profile, and preserves the same popup document. The theme popover changes `data-theme` and persistent settings in place. The Options gear opens the full options workspace. |
| Global commands | `Alt+Shift+H/P/K` dispatch through the browser shortcut manager | 📋 manual | The shortcut manager feeds `chrome.commands`, which neither Playwright nor CDP can synthesize; the popup behaviour each triggers is covered by its in-popup equivalent above. Explicit `test.skip`; the shortcuts themselves ride the per-release manual keyboard pass. |
| Grant-dialog verbatims / multi-origin prompt wording | Native permission-prompt copy | 📋 manual | Native prompts are not scriptable (below); captured out of band. |
| Packed: on-wire header modification | A compiled rule sets a header under a policy-installed CRX with a `runtime_allowed_hosts` grant | ⏭ env-skip | Not CI-automatable in this environment; verified manually against real Chrome before each release. The CRX force-installs and enables, but its lazy MV3 service worker is not surfaced to Playwright on the runner, so the specs cannot drive it. Unconfirmed until that manual check runs. |
| Packed: `getMatchedRules({tabId})` | Matched rules return under an `activeTab` gesture on the packed CRX (only ever confirmed unpacked) | ⏭ env-skip | Not CI-automatable in this environment; verified manually against real Chrome before each release. The gesture is the `_execute_action` command; a divergence re-opens the Verify design. Unconfirmed until that manual check runs. |
| Packed: `displayActionCountAsBadgeText` | The count badge paints on the packed CRX (only ever confirmed unpacked) | ⏭ env-skip | Not CI-automatable in this environment; verified manually against real Chrome before each release. A divergence re-opens the count-badge design. Unconfirmed until that manual check runs. |

## Status of behaviors deferred from headless CI

Each behavior below is genuinely uncertain until confirmed by more than the
headless suite, and where its answer stands today. A structural outcome (the
compiled rule's condition, read back from Chrome) settles the design; the
on-wire confirmation that leans on a runtime grant is verified manually
against real Chrome before release.

- **Do individual grants survive broad-grant revocation?** The survival
  question is not settled here: the unpacked headless posture cannot obtain the
  all-sites grant to then revoke. Verified manually against real Chrome before
  release; the "Revoking returns previously-granted individual sites to
  whatever Chrome preserved" copy stays unconfirmed until then. The Site-access
  **UI half** is settled: the page is a faithful projection of
  `permissions.getAll` + the rules' required origins, verified against the
  browser's real (empty-grant) state — needed origins listed, granted group
  empty, broad-grant offer standing. It will reflect whatever the survival
  check preserves once that check can run.
- **The exact request set an activeTab session rule modifies.**
  Structurally confirmed: the compiled session rule's condition is
  `tabIds: [thisTab]` + `requestDomains: [origin]` over all resource types
  including `main_frame`, so the reach is exactly the tab's own main frame and
  same-origin subresources — no wider, no narrower. This **holds** the copy
  ("Applies to example.com requests in this tab", the same-origin-only promise).
  The remaining on-wire confirmation under a real activeTab grant is verified
  manually against real Chrome before release; nothing about the scope depends
  on it.
- **This-tab lifetime across navigations.** Cross-site navigation ends
  the override, an A→B→A round trip stays stopped, and closing the tab ends it —
  all confirmed headless. The same-site/SPA *continues* half needs the activeTab
  `tab.url`, so it is deferred; the "Applies to this tab while it stays on
  example.com. Navigating the tab to a different site ends the override" copy is
  confirmed for the ends direction and unconfirmed for the continues direction.
- **Does the popup Verify button grant activeTab for `getMatchedRules`?**
  Confirmed headless that `getMatchedRules` **rejects** without a gesture-granted
  activeTab (the feature's whole premise). Whether the action click that opens
  the popup supplies that gesture to the Verify button is unscriptable and
  deferred until manual verification against real Chrome answers it.
- **Verify tallies, quota, count number.** All three need a gesture-granted
  `getMatchedRules` and are deferred. Stable-id attribution is independently
  unit-tested (`decodeMatches`); the count-badge *state machine* (mode
  exclusivity, per-tab sweep, precedence) is confirmed headless while the painted
  *number* is deferred.

**Quick-override reach.** Part (a) — whether even the
same-origin set holds — is answered *yes, structurally*: the session rule's own
condition confines it to the tab's origin, so the zero-prompt This-tab surface
does not need the real-per-site-grant fallback on scoping grounds. Part (b) —
lifetime flakiness — the ends direction is deterministic here; the continues
direction is verified manually against real Chrome before the "no prompt"
promise freezes. No relabel is required on the evidence gathered so far.

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
gate runs in its own workflow (`.github/workflows/e2e-packed.yml`, on
`workflow_dispatch` and when `e2e/packed/**` changes). It runs Google Chrome
(`channel: 'chrome'`, the only build that reads that policy directory) headed
under Xvfb.

On the runner the CRX force-installs and enables cleanly — Chrome reads the
managed policy, fetches the update manifest and CRX from the local server, and
`chrome://extensions-internals` reports the extension `ENABLED` with its
listeners registered. What is missing is the handle: the extension's lazy MV3
service worker starts, registers, and idles out again without the persistent
context ever surfacing a `serviceworker` target to Playwright, so the specs have
no worker to drive. The specs therefore skip with that reason recorded in code,
and the three behaviours are verified manually against real Chrome before each
release, until this harness can drive them directly. The harness (pack, update
server, policy render, force-install, and an on-timeout diagnostic that dumps
the read policy, the extension records, and Chrome's own updater/installer
log) is kept intact for when that becomes possible.

Locally you can exercise everything except the policy install and the Chrome run:

```
pnpm e2e:packed:pack        # build + pack the CRX
pnpm e2e:packed:selfcheck   # pack, serve, and render the policy; assert their shape
```

The three outcomes are marked *env-skip* in the table above: they are not
CI-automatable in this environment and stay unconfirmed until a manual
real-Chrome check records them before each release.

## Manual verification before release

A handful of behaviors above have no automated readout in this repo — either
because they need OS-level input (native permission prompts, global keyboard
shortcuts) or because the packed-build gate can't get a service worker handle
in this environment yet. Before shipping a release, check them by hand:

- Load the built extension unpacked (`.output/chrome-mv3`) or the packed CRX
  (`pnpm e2e:packed:pack`) in real Chrome.
- Trigger the behavior with a real user gesture: click the action, press the
  `Alt+Shift+H/P/K` shortcuts, open the Grant panel to see the native
  permission-prompt wording, or grant/revoke all-sites access from
  `chrome://extensions`.
- Confirm the expected result directly — the badge, the popup's Verify panel,
  `chrome://extensions-internals`, or a network trace in DevTools.

The table above names each behavior currently relying on this pass.

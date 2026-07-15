# Security policy

HeaderShim changes HTTP request and response headers in your browser. That is a
capability worth handling with care. This policy explains how to report a
vulnerability, what HeaderShim does to limit risk, the risks it accepts, and a
commitment about who controls it.

## Reporting a vulnerability

Report security issues privately through GitHub. Open the repository's Security
tab and use "Report a vulnerability". That starts a private advisory, which
stays confidential until a fix is ready. Please do not open a public issue for a
security bug.

Include enough to reproduce: the affected version, the steps, and the impact you
observed. A small proof of concept helps.

This is a small open-source project maintained on a best-effort basis. There is
no paid bounty. Reports are acknowledged, worked through with you, and credited
in the release notes if you would like. Please reproduce against the latest
published version before reporting, and give a reasonable window to ship a fix
before disclosing publicly.

## Scope

In scope: the extension source in this repository, its build and release
workflows, and the published extension they produce.

Out of scope: the browser itself, the Chrome Web Store, and the sites you choose
to modify. HeaderShim applies the rules you write on the sites you grant it
access to. A rule that weakens a site's own protections because you configured
it to is doing what you asked, not a vulnerability in HeaderShim. That said, if
HeaderShim makes a dangerous configuration too easy to create without a clear
warning, that is a real safety bug and worth reporting.

Only the latest published version is supported.

## What HeaderShim does to limit risk

Each of these is a property of the code, and most are enforced automatically on
every build so they cannot quietly regress.

- **No code path into your pages.** There are no content scripts, no
  `webRequest`, no `scripting`, no `web_accessible_resources`, and no broad host
  access baked into the install. A build guard fails the build if any of these
  appear. This is what answers "could a page trick it into leaking data" or
  "could it inject into pages": there is no code that runs in a page.

- **No network code of its own.** HeaderShim makes no requests, sends no
  telemetry, and contacts no server. This is what answers "could it exfiltrate
  data": there is nothing in it that sends data anywhere. A build gate greps the
  shipped worker for network primitives so this stays an enforced invariant, not
  a promise.

- **Stores only your configuration.** Your rules, profiles, and settings live in
  local extension storage. HeaderShim records nothing about the sites you visit,
  the requests you make, or the headers on your traffic. There is no traffic log
  to leak. One honest note: a rule you write can itself contain a secret you
  typed, such as an `Authorization` token or a `Cookie` value, and that value is
  stored as-is so the rule can work. Treat an exported configuration file like a
  file of passwords. The export screen reminds you of this.

- **No remote code.** HeaderShim ships and runs only the code in this
  repository. There is no `eval`, no dynamically loaded remote script, and the
  content security policy forbids both. This is what answers "could a later
  update change behavior after it was reviewed": all behavior is bundled in the
  build you installed.

- **Reproducible, attested build.** Releases are built from a clean checkout by
  a public workflow, and each release artifact carries a build provenance
  attestation. You can confirm that a release zip was built by this repository's
  workflow from a specific commit:

  ```
  gh attestation verify <release-zip> --repo arun279/headershim
  ```

## The risk provenance does not cover: who controls the source

Provenance answers "was this artifact built by this workflow from this commit".
It says nothing about the intent of the source, or about who controls the source
next quarter. The most common way a trusted extension turns harmful is a change
of ownership followed by a quiet update: because it adds no new permission, the
browser shows no prompt and disables nothing pending review. A future worker
that read the local rule store (which can hold the secrets above) and had an
already-granted all-sites permission would be enough to send them out.

HeaderShim's structural properties are properties of today's source, not laws
the platform enforces. A hostile maintainer could remove them in a single
change. Three things constrain that:

- The commitment below, against a silent sale or ownership transfer.
- The network-egress build gate, so deleting "no network code" is a visible edit
  to the build, not a quiet one.
- Reproducible builds and published release hashes, so a shipped artifact that
  diverges from the public source is detectable.

None of these makes a takeover impossible. They make it loud.

## Commitment: no sale, no silent ownership transfer

HeaderShim will not be sold, and its maintainership will not be transferred,
without a public notice in this repository first. There are no accounts, no
server, and no user data to sell. If maintainership ever changes hands, that
change is announced before any release under new ownership.

## Risks HeaderShim accepts

These are real and documented rather than hidden. Most are inherent to what the
tool does or to the platform it runs on.

- **Maintainer takeover.** Covered above. The commitment, the egress build gate,
  and reproducible builds constrain it; they do not eliminate it.

- **Secret values are stored unencrypted at rest.** A rule that sets an
  `Authorization` or `Cookie` header must keep its value to work, and that value
  sits unencrypted in local extension storage, like any local config file. Local
  malware, disk forensics, or a backup that sweeps up an exported file can read
  it. Scope credential-bearing rules to the exact host that needs them, and keep
  exports somewhere you would keep passwords.

- **Enterprise force-install bypasses per-site consent.** An administrator can
  force-install HeaderShim and grant host access by policy, which skips the
  runtime per-site prompt. In a managed environment HeaderShim can be active
  without you ever clicking grant. HeaderShim reads no managed configuration, so
  an administrator can install it but cannot centrally lock or forbid specific
  rules across a fleet.

- **The store binary is not the artifact you can verify.** The attestation
  covers the release zip in this repository. Chrome re-packages and signs the
  extension when it serves it from the Web Store, so the installed binary is a
  separate artifact you cannot byte-compare to that zip. What you can verify: the
  release zip was built by this repository's workflow, and the files inside your
  installed extension match the attested release files.

- **`activeTab` is a second access path.** A This-tab override applies a rule to
  the current tab using Chrome's `activeTab` access, granted by your click,
  without a persistent per-site grant. It is bound to the tab you clicked and
  expires with it. Count it alongside the sites you grant when you reason about
  where HeaderShim can act.

## A note on other extensions

If another header-modifying extension is installed, Chrome, not HeaderShim,
decides which edit wins when both touch the same header, and that outcome can
change between browser versions. Verify shows that a rule matched a request, not
that its header was the final one the server saw. In a browser with more than
one such extension, treat a match as best-effort.

## A note on the capability

Because HeaderShim can add, change, or remove headers, it can weaken a site's
protections if you configure it to, for example by removing a
`Content-Security-Policy` header or attaching a credential to a broad set of
sites. HeaderShim warns where it can, but it will not block a change that might
be legitimate. Grant access only to the sites you mean to, scope
credential-bearing rules to the specific host that needs them, and be careful
with configuration files you import from others. Imported profiles arrive turned
off, so nothing takes effect until you review and enable it.

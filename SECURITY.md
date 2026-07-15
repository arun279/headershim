# Security policy

HeaderShim changes HTTP request and response headers in your browser, so
security reports are welcome. This policy explains how to report a vulnerability
and what is in scope.

## Reporting a vulnerability

Report security issues privately through GitHub. Open the repository's Security
tab and use "Report a vulnerability". That starts a private advisory, which stays
confidential until a fix is ready. Please do not open a public issue for a
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
to modify. A rule that weakens a site's own protections because you configured it
to is doing what you asked, not a vulnerability in HeaderShim. If HeaderShim makes
a dangerous configuration too easy to create without a clear warning, that is a
real safety bug and worth reporting.

## Supported versions

Only the latest published version is supported.

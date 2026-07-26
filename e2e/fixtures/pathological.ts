import {
  createProfile,
  createRule,
  defaultProfileColor,
  type HeaderOp,
  type RuleDraft,
  type Scope,
  type StateDoc,
} from "../../src/core/model";
import { createV1Seed } from "../../src/core/schema";

// The one source of pathological content for the regression harness: strings a
// heavy user can accumulate, each chosen for a distinct failure class a bounded
// layout has to survive. Every layout and a11y spec seeds from here, so the
// content stays consistent and a new stressor is added once.

const base64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const jwtHeader = base64url({
  alg: "RS256",
  typ: "JWT",
  kid: "a7f3c9e1-2b4d-4f8a-9c6e-1d3b5a7f9c2e",
});
const jwtPayload = base64url({
  iss: "https://auth.acme-internal.example.com/realms/production",
  sub: "9f8e7d6c-5b4a-3928-1706-fedcba987654",
  aud: [
    "api.acme-internal.example.com",
    "billing.acme-internal.example.com",
    "reporting.acme-internal.example.com",
  ],
  exp: 1799999999,
  nbf: 1769990000,
  iat: 1769990000,
  jti: "c3f1a9d7-8e6b-4c2a-9f5d-3b7e1a4c8d20",
  azp: "headershim-regression-client",
  scope:
    "openid profile email offline_access billing:read billing:write reporting:read admin:audit",
  email: "arun.krishnamurthy@acme-internal.example.com",
  email_verified: true,
  preferred_username: "arun.krishnamurthy",
  realm_access: {
    roles: ["default-roles-production", "billing-admin", "reporting-viewer"],
  },
  session_state: "5d2c8b1a-4e7f-49a3-b6c0-2f8e1d7a3b95",
  tenant_id: "tnt_01HQZX8K3M9V2P4R6T8W0Y1B3D",
});
const jwtSignature =
  "Qm9ndXNTaWduYXR1cmVGb3JSZWdyZXNzaW9uVGVzdGluZ09ubHlEb05vdFVzZUluUHJvZHVjdGlvbkV2ZXJfXzAxMjM0NTY3ODlhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ekFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFla";

/** An 800+ char realistic JWT, the class of value users paste into Authorization. */
const AUTH_JWT = `${jwtHeader}.${jwtPayload}.${jwtSignature}`;
const AUTH_VALUE = `Bearer ${AUTH_JWT}`;

/** A long descriptive comment on a rule. */
const LONG_COMMENT =
  "Set by the platform team on 2026-03-11 after the staging gateway started rejecting requests that did not carry an explicit correlation id. Keep this on until the tracing rollout finishes, then delete it along with the matching rule in the legacy proxy config. Ask in the platform channel before changing the value, because the billing export job parses this exact prefix.";

/** A full URL with query parameters as a header value. */
const URL_VALUE =
  "https://auth.acme-internal.example.com/oauth2/v2/callback?client_id=hs_live_9f8e7d6c5b4a&redirect_uri=https%3A%2F%2Fapp.acme-internal.example.com%2Fsession%2Fcomplete&response_type=code&scope=openid+profile+email+offline_access&state=eyJyZXR1cm5UbyI6Ii9kYXNoYm9hcmQvYmlsbGluZyJ9&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256";

/** Non-Latin scripts, a ZWJ emoji sequence, and combining diacritics. */
const NON_LATIN_VALUE = "Üñicóde тестовый 日本語のテキスト مرحبا 🧑‍🚀 👩‍👩‍👧‍👦";

/** An unusually long header name, already in normalized (lowercased) form. */
const LONG_HEADER_NAME =
  "x-acme-internal-service-mesh-correlation-identifier-for-tracing-and-audit";

/** A long registrable domain whose single label cannot break onto two lines. */
const LONG_DOMAIN =
  "verylongunbreakableregistrablelabelfortestingoverflow.example";

/** An internationalized domain in its punycode form, from core/scope.test.ts. */
const IDN_DOMAIN = "xn--bcher-kva.de";

/** Profile names past the profile truncation ceiling. */
const LONG_PROFILE_NAME =
  "Staging environment for the acme payments platform integration team";
const LONG_PROFILE_UNICODE =
  "本番前チェック 🚀 pre-production smoke checks (EU region)";

const XHR: RuleDraft["resourceTypes"] = ["xhr"];
const domains = (...names: string[]): Scope => ({
  type: "domains",
  domains: names,
});

const req = (
  header: string,
  value: string,
  scope: Scope,
  extra: Partial<RuleDraft> = {},
): RuleDraft => ({
  direction: "request",
  operation: "set",
  header,
  value,
  scope,
  resourceTypes: XHR,
  initiators: [],
  enabled: true,
  ...extra,
});

const res = (
  operation: HeaderOp,
  header: string,
  scope: Scope,
  extra: Partial<RuleDraft> = {},
): RuleDraft => ({
  direction: "response",
  operation,
  header,
  scope,
  resourceTypes: XHR,
  initiators: [],
  enabled: true,
  ...extra,
});

/**
 * The heavy user's rules: about fifteen across several sites, request and
 * response, some switched off. The reaching block is scoped to the tab in front
 * so the populated popup readout paints these values live; the rest are scoped
 * to other sites so the options rule list carries the long domain, the punycode
 * domain, and the mix an options width sweep has to hold.
 *
 * `host` is the granted tab host on the host-access build, threaded the same way
 * a11y.spec.ts threads it, so the reaching rules read live rather than
 * needs-access.
 */
export function pathologicalDoc(host: string): StateDoc {
  let doc = createV1Seed();
  const make = (draft: RuleDraft) => {
    const [rule, next] = createRule(doc, draft);
    doc = next;
    return rule;
  };

  const reaching = [
    req("authorization", AUTH_VALUE, domains(host)),
    req(LONG_HEADER_NAME, "mesh-7f3a", domains(host)),
    req("x-mixed-script", NON_LATIN_VALUE, domains(host)),
    req("x-callback-url", URL_VALUE, domains(host)),
    req("x-correlation-id", "trace-7f3a-9c2e", domains(host), {
      comment: LONG_COMMENT,
    }),
    res("set", "x-trace", domains(host), { value: "on" }),
    res("remove", "server", domains(host)),
    req("x-idle-probe", "off", domains(host), { enabled: false }),
  ].map(make);

  const elsewhere = [
    req("x-env", "staging", domains(LONG_DOMAIN)),
    req("x-idn-reach", "on", domains(IDN_DOMAIN)),
    res("set", "content-security-policy", domains("api.example.com"), {
      value: "default-src 'self'",
    }),
    req("accept-language", "en-GB,en;q=0.9", domains("example.org"), {
      enabled: false,
    }),
    req("x-acme-experiments", "checkout-v3,pricing-b", { type: "all" }),
    res("set", "access-control-allow-origin", { type: "all" }, { value: "*" }),
  ].map(make);

  const sidecar = [
    req("x-region", "eu-west", domains("smoke.example.net")),
  ].map(make);

  const [seedDefault] = doc.profiles;
  if (seedDefault === undefined) {
    throw new Error("seed document is missing its Default profile");
  }
  const active = {
    ...createProfile({
      name: LONG_PROFILE_NAME,
      badgeText: LONG_PROFILE_NAME,
      color: defaultProfileColor(1),
    }),
    rules: [...reaching, ...elsewhere],
  };
  const unicode = {
    ...createProfile({
      name: LONG_PROFILE_UNICODE,
      badgeText: LONG_PROFILE_UNICODE,
      color: defaultProfileColor(2),
    }),
    rules: sidecar,
  };

  return {
    ...doc,
    profiles: [seedDefault, active, unicode],
    activeProfileId: active.id,
  };
}

/**
 * The single source of every user-facing string. Components never inline copy;
 * they read it from here so wording stays consistent and reviewable in one place.
 * Strings are verbatim from the product spec: the platform is named as the actor,
 * cause precedes impact precedes next step, and exact names are always shown.
 */

const rules = (n: number) => (n === 1 ? "rule" : "rules");
const sites = (n: number) => (n === 1 ? "site" : "sites");
const profiles = (n: number) => (n === 1 ? "profile" : "profiles");

export const copy = {
  app: {
    name: "headershim",
    // Identical wording ships on the trust page (SPEC §8.6).
    tagline:
      "Change HTTP headers on sites you choose. No account. Nothing ever leaves your device.",
  },

  annunciator: {
    paused: "Paused — no headers are being modified.",
    off: "Off — no profiles are on.",
    liveEmpty: "Live — no rules yet.",
    live: (ruleCount: number, profileCount: number, temporaryCount: number) => {
      const base = `Live — ${ruleCount} ${rules(ruleCount)} on ${profileCount} ${profiles(profileCount)}.`;
      return temporaryCount > 0
        ? `${base} · ${temporaryCount} temporary on this tab`
        : base;
    },
    needsAccess: (ruleCount: number, host: string, moreSites: number) => {
      const lead = `${ruleCount} ${rules(ruleCount)} can't run — headershim doesn't have access to ${host}`;
      return moreSites > 0
        ? `${lead} and ${moreSites} more ${sites(moreSites)}.`
        : `${lead}.`;
    },
  },

  actions: {
    newRule: "+ New rule",
    verify: "Verify",
    resume: "Resume",
    grantAccess: "Grant access",
    notNow: "Not now",
    cancel: "Cancel",
    undo: "Undo",
    regenerate: "Regenerate",
    options: "Options",
    allowOn: (target: string) => `Allow on ${target}`,
  },

  toast: {
    activeOn: (host: string) => `Active on ${host}`,
    ruleDeleted: "Rule deleted · Undo",
    profileDeleted: (name: string) => `Profile '${name}' deleted · Undo`,
  },

  emptyState: {
    profile: (name: string) => `No rules in ${name} yet.`,
    siteAccess:
      "No sites granted yet. Grants appear here when a rule asks for one.",
  },

  generatedValue: {
    note: "Generated when you saved this rule — this value is frozen; it does not change per request.",
    frozen: (savedAtUtc: string) =>
      `Frozen at save · ${savedAtUtc} · Regenerate`,
  },

  grantPanel: {
    single: (host: string) =>
      `To change headers on ${host}, Chrome requires you to grant headershim access to that site.`,
    multiple: (siteCount: number) =>
      `To change headers on ${siteCount} sites, Chrome requires you to grant headershim access to those sites:`,
    initiator: (initiator: string, target: string) =>
      `Also allow on ${initiator} (the site you're on) — needed when its pages call ${target}.`,
  },

  errors: {
    regexInvalid:
      "This pattern isn't valid RE2, the regex dialect Chrome's rule engine uses — it has no lookahead or backreferences. Fix the pattern, or switch this scope to a URL pattern.",
    regexOversize:
      "This pattern compiles to more than Chrome's 2 KB limit for a single rule. Shorten or split it.",
    grantDeclined: (host: string) =>
      `Saved, but not running. You declined access to ${host}, so this rule can't change anything there. Grant access whenever you're ready — the rule starts working immediately.`,
    appendDisallowed: (name: string) =>
      `Chrome only allows appending to a fixed set of request headers, and ${name} isn't one of them. Use Set instead — it replaces any existing value.`,
    ruleCap:
      "Chrome caps extensions at 5,000 header rules, and enabling this would pass headershim's safe limit of 4,500. Disable or delete rules you're not using, or turn off a profile.",
    ruleCounter: (enabled: number) =>
      `${enabled.toLocaleString("en-US")} of 4,500 enabled rules.`,
    importParse:
      "This file isn't valid JSON, so nothing was imported and nothing was changed. If it came from ModHeader, export it again with Profile → Export → JSON.",
    importNewer: (fileVersion: number, supportedVersion: number) =>
      `This file was exported by a newer headershim (format ${fileVersion}; this version reads up to ${supportedVersion}). Update headershim, then import again. Nothing was changed.`,
    importUnrecognized:
      "This file is valid JSON but isn't a headershim or ModHeader export, so nothing was imported and nothing was changed. headershim reads two formats: its own exports, and ModHeader profile exports.",
    verifyNoMatch:
      "No rule matched requests on this tab in the last 5 minutes. Reload the tab, then verify again. Still nothing? Cached responses skip header rules — in DevTools, check Network → Disable cache and reload. If a rule is scoped to specific resource types, confirm the request kind matches. And if the requests you care about are started by a different site, that site needs access too (Site access in options).",
    headerNotModifiable:
      "Header names starting with ':' are HTTP/2 internals that Chrome doesn't let any extension touch. To change the host a server sees, the request would have to use HTTP/1.1, which most modern sites no longer accept.",
  },

  advisories: {
    managedHeader:
      "Chrome's network stack manages this header itself; a rule here usually has no effect.",
    host: "Chrome can't change the authority on HTTP/2 connections, which most sites use — this rule usually has no effect.",
  },

  verify: {
    // Verbatim honest-limits footer (SPEC §5).
    limits:
      'Chrome only reports rule matches from the last 5 minutes on this tab. DevTools\' Network panel will not show header changes made by extensions (a known Chrome bug) — trust this panel or your server logs, not DevTools. Cached responses never pass through header rules: to test reliably, open DevTools → Network → check "Disable cache", then reload.',
    summary: (matched: number, total: number) =>
      `${matched} of ${total} rules matched on this tab · last 5 min`,
  },
} as const;

/**
 * The single source of every user-facing string. Components never inline copy;
 * they read it from here so wording stays consistent and reviewable in one place.
 * Strings are verbatim from the product spec: the platform is named as the actor,
 * cause precedes impact precedes next step, and exact names are always shown.
 */

/**
 * Annunciator sentences are segment lists so the wire-facing tokens inside
 * them (hostnames, counts) can render in the data face while every word still
 * lives here. `sentenceText` flattens one back to its plain reading.
 */
export type SentencePart = string | { readonly data: string };
export type Sentence = readonly SentencePart[];

export function sentenceText(sentence: Sentence): string {
  return sentence
    .map((part) => (typeof part === "string" ? part : part.data))
    .join("");
}

const data = (value: string | number): SentencePart => ({
  data: String(value),
});

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
    paused: ["Paused — no headers are being modified."] as Sentence,
    off: ["Off — no profiles are on."] as Sentence,
    liveEmpty: ["Live — no rules yet."] as Sentence,
    outOfSync: [
      "Out of sync — Chrome rejected headershim's last rule update, so the rules shown here may not all be applied. Any edit retries it.",
    ] as Sentence,
    live: (
      ruleCount: number,
      profileCount: number,
      temporaryCount: number,
    ): Sentence => [
      "Live — ",
      data(ruleCount),
      ` ${rules(ruleCount)} on `,
      data(profileCount),
      ` ${profiles(profileCount)}.`,
      ...(temporaryCount > 0
        ? [" · ", data(temporaryCount), " temporary on this tab"]
        : []),
    ],
    needsAccess: (
      ruleCount: number,
      host: string,
      moreSites: number,
    ): Sentence => [
      data(ruleCount),
      ` ${rules(ruleCount)} can't run — headershim doesn't have access to `,
      data(host),
      ...(moreSites > 0
        ? [" and ", data(moreSites), ` more ${sites(moreSites)}`]
        : []),
      ".",
    ],
  },

  firstRun: {
    tryThisTab: "Try it on this tab",
    createRule: "Create a rule",
    importFile: "Import from ModHeader or a file",
  },

  profiles: {
    navLabel: "Profiles",
    offTag: "off",
    chipState: (focused: boolean, on: boolean) =>
      `${focused ? ", focused" : ""}${on ? ", on" : ", off"}`,
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
    pause: "Pause",
    globalPause: "Global pause",
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

  scopeSummary: {
    allSites: "all sites",
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
    regexRuleCap:
      "Chrome separately caps regex-scoped rules at 1,000, and enabling this would pass that limit. Disable or delete regex rules you're not using, or switch some scopes to URL patterns.",
    storageBudget:
      "Chrome gives an extension limited local storage, and this change would pass headershim's safe budget of 4 MB. Shorten long header values, or delete rules you're not using.",
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
    newerStore: (foundVersion: number, supportedVersion: number) =>
      `Your rules were saved by a newer headershim (format ${foundVersion}; this version reads up to ${supportedVersion}). Update headershim to pick them back up — nothing has been changed.`,
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

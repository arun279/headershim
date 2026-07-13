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

  // The full-tab options surface: frame, profile management, and bulk actions.
  options: {
    nav: {
      label: "Sections",
      profiles: "Profiles",
      importExport: "Import & export",
      siteAccess: "Site access",
      about: "Appearance & about",
    },
    version: (version: string) => `v${version}`,
    profiles: {
      title: "Profiles",
      new: "+ New",
      // The name a fresh profile is created under before the user renames it;
      // availableProfileName resolves collisions ("New profile 2", …).
      newName: "New profile",
      ruleCount: (count: number) => `${count} ${rules(count)}`,
      nameLabel: "Profile name",
      rename: "Rename",
      clone: "Clone",
      delete: "Delete",
      toggleLabel: (name: string, on: boolean) =>
        `Profile ${on ? "on" : "off"}: ${name}`,
      // The disclosure that opens a profile for badge/rule editing.
      expand: (name: string) => `Edit ${name}`,
      reorderHandle: (name: string) =>
        `Reorder ${name}; press the arrow keys to move it`,
      reordered: (name: string, position: number) =>
        `${name}, moved to position ${position}`,
      nameTaken: (name: string) =>
        `A profile named '${name}' already exists — pick a different name.`,
      deleteConfirm: {
        title: (name: string) => `Delete profile '${name}'?`,
        body: (count: number) =>
          `Its ${count} ${rules(count)} will be deleted. Site grants are not changed.`,
        confirm: "Delete profile",
      },
    },
    badge: {
      textLabel: "Badge text",
      colorLabel: "Badge color",
      colorNames: {
        indigo: "Indigo",
        blue: "Blue",
        teal: "Teal",
        green: "Green",
        plum: "Plum",
        magenta: "Magenta",
        crimson: "Crimson",
        slate: "Slate",
      },
    },
    rules: {
      sectionLabel: (name: string) => `Rules in ${name}`,
      selectAll: "Select all rules",
      selected: (count: number) => `${count} ${rules(count)} selected`,
      selectRule: (header: string) => `Select rule: ${header}`,
      enable: "Enable",
      disable: "Disable",
      move: "Move",
      moveTo: (name: string) => `Move to ${name}`,
      delete: "Delete",
    },
    importExport: {
      title: "Import & export",
      importHeading: "Import",
      instruction:
        "headershim JSON or ModHeader export — detected automatically.",
      choose: "Choose file…",
      fileInputLabel: "Import a headershim or ModHeader export",
      exportHeading: "Export",
      exportEverything: "Export everything",
      exportOne: "Export one profile",
      exportChoiceLabel: "Profile to export",
      // Shown verbatim on every export.
      secretsReminder:
        "This file contains the header values you typed — including any tokens or keys. Treat it like a credentials file.",
      everythingFilename: "headershim-export.json",
      profileFilename: (slug: string) => `headershim-${slug}.json`,
      summaryHeading: "Import summary",
      counts: (profileCount: number, ruleCount: number): Sentence => [
        "Import will create ",
        data(profileCount),
        ` ${profiles(profileCount)} / `,
        data(ruleCount),
        ` ${rules(ruleCount)}.`,
      ],
      needAttention: (count: number) =>
        count === 1
          ? "1 item needs attention:"
          : `${count} items need attention:`,
      import: "Import",
      convert: "Convert to frozen value",
      imported: (count: number) =>
        `Imported ${count} ${profiles(count)}, off — turn them on when you're ready.`,
      warnings: {
        appendDegraded: (header: string): Sentence => [
          "Chrome only allows appending to a fixed set of request headers, and ",
          data(header),
          " isn't one of them — imported as Set.",
        ],
        cookieSemantics:
          "Imported as a whole-header append on cookie; per-cookie merge behaves differently.",
        setCookieSemantics:
          "Imported as Set on set-cookie; a set collapses multiple Set-Cookie headers into one.",
        cspSemantics:
          "Browsers combine CSPs restrictively; this cannot loosen a page's own policy.",
        invalidRegex: (pattern: string): Sentence => [
          "This pattern isn't valid RE2, so the rule was imported disabled: ",
          data(pattern),
        ],
        dynamicToken:
          "Contains a request-time token Chrome extensions can no longer compute.",
        droppedExcludeUrl:
          "Dropped — headershim has no per-rule URL exclusion in this version.",
        droppedInitiatorDomain:
          "Dropped — headershim has no initiator scoping in this version.",
        droppedTab: "Dropped — use This-tab overrides for per-tab needs.",
        droppedUrlReplacement:
          "Dropped — headershim changes headers only, never redirects.",
      },
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
    pause: "Pause",
    globalPause: "Global pause",
    allowOn: (target: string) => `Allow on ${target}`,
  },

  toast: {
    activeOn: (host: string) => `Active on ${host}`,
    activeOnSites: (siteCount: number) => `Active on ${siteCount} sites`,
    // "· Undo" is the toast's action button, not part of the message.
    ruleDeleted: "Rule deleted",
    rulesDeleted: (count: number) => `${count} ${rules(count)} deleted`,
    profileDeleted: (name: string) => `Profile '${name}' deleted`,
  },

  rules: {
    listLabel: "Rules",
    switchLabel: (header: string, on: boolean) =>
      `Rule ${on ? "on" : "off"}: ${header}`,
    menuLabel: (header: string) => `Rule actions: ${header}`,
    direction: { request: "request", response: "response" },
    operation: { set: "set", append: "append", remove: "remove" },
    needsAccess: (host: string, moreSites: number): Sentence => [
      "Needs access · ",
      data(host),
      ...(moreSites > 0 ? [" +", data(moreSites)] : []),
    ],
    // Silkscreen tag; stays sentence case in the DOM, uppercased via CSS only.
    temporaryTag: "Temporary",
    temporary: (host: string): Sentence => [
      "applies to ",
      data(host),
      " requests in this tab",
    ],
    invalidRegex: "Invalid regex — edit the scope to enable",
    overridden: "overridden by a rule above",
    initiatorNote:
      "requests started by other pages also need those pages granted",
  },

  thisTab: {
    // Silkscreen section label; " · host · N temporary" follows it.
    sectionLabel: "This tab",
    summary: (host: string, count: number): Sentence => [
      " · ",
      data(host),
      " · ",
      data(count),
      " temporary",
    ],
    composerTitle: "New this-tab override",
    saveAsRule: "Save as rule…",
    remove: (header: string) => `Remove temporary override: ${header}`,
    // Persistent honesty line under the section (SPEC §3.5); "Create a rule"
    // is the action button between the two spans.
    standingBefore:
      "Calling a different API from this page? That needs a saved rule and a one-click site grant — ",
    standingAction: "Create a rule",
    standingAfter: " pre-fills it.",
    // No web origin to bind to (chrome:// or store page).
    noHost: "Open the popup on a website to add a temporary override for it.",
  },

  menu: {
    edit: "Edit",
    duplicate: "Duplicate",
    moveToProfile: "Move to profile",
    regenerateValue: "Regenerate value",
    undoLastDelete: "Undo last delete",
    delete: "Delete",
  },

  emptyState: {
    profile: (name: string) => `No rules in ${name} yet.`,
    siteAccess:
      "No sites granted yet. Grants appear here when a rule asks for one.",
  },

  scopeSummary: {
    allSites: "all sites",
    pattern: "pattern",
    regex: "regex",
    domains: (first: string, more: number): Sentence => [
      data(first),
      ...(more > 0 ? [" +", data(more)] : []),
    ],
  },

  resourceTypes: {
    groups: {
      pages: "Pages",
      subframes: "Subframes",
      xhr: "XHR/fetch",
      scripts: "Scripts",
      stylesheets: "Stylesheets",
      images: "Images",
      fonts: "Fonts",
      media: "Media",
      websockets: "WebSockets",
      other: "Other",
    },
    only: (group: string) => `${group} only`,
    count: (n: number) => `${n} types`,
  },

  editor: {
    editRule: "Edit rule",
    newRule: "New rule",
    labels: {
      direction: "Direction",
      operation: "Operation",
      headerName: "Header name",
      value: "Value",
      scope: "Scope",
      comment: "Comment",
      resourceTypes: "Resource types",
    },
    direction: { request: "Request", response: "Response" },
    operation: { set: "Set", append: "Append", remove: "Remove" },
    savedAs: (name: string): Sentence => ["saved as ", data(name)],
    suggestions: (n: number) => (n === 1 ? "1 suggestion" : `${n} suggestions`),
    scopeType: {
      domains: "Domains",
      pattern: "URL pattern",
      regex: "Regex",
    },
    allSites: "All sites",
    domainsHelper: "matches this domain and its subdomains",
    addDomain: "+ add",
    domainInputLabel: "Add domain",
    removeDomain: (domain: string) => `Remove ${domain}`,
    patternHint: [
      data("||example.com^"),
      " matches the site and subdomains · ",
      data("*://*/api/*"),
      " matches paths",
    ] as Sentence,
    grantNote: "This rule only takes effect on sites you've granted access to.",
    allTypes: "All types",
    includesPages: "Includes top-level pages",
    insert: "Insert",
    insertUuid: "UUID",
    insertTimestamp: "Timestamp (ISO 8601)",
  },

  // Optional one-word context after a suggested name ("authorization — credentials").
  headerHints: {
    authorization: "credentials",
    "user-agent": "client identity",
    "content-type": "media type",
    "content-security-policy": "content policy",
    cookie: "stored cookies",
    "set-cookie": "cookie to store",
    origin: "requesting origin",
    referer: "linking page",
    accept: "acceptable media types",
    "accept-language": "preferred languages",
    "accept-encoding": "acceptable encodings",
    "cache-control": "caching directives",
    "access-control-allow-origin": "CORS origins",
    "x-forwarded-for": "client address",
    host: "target authority",
    etag: "resource version",
    location: "redirect target",
  } as Partial<Record<string, string>>,

  generatedValue: {
    note: "Generated when you saved this rule — this value is frozen; it does not change per request.",
    frozen: (savedAtUtc: string) => `Frozen at save · ${savedAtUtc}`,
  },

  grantPanel: {
    single: (host: string) =>
      `To change headers on ${host}, Chrome requires you to grant headershim access to that site.`,
    multiple: (siteCount: number) =>
      `To change headers on ${siteCount} sites, Chrome requires you to grant headershim access to those sites:`,
    initiator: (initiator: string, target: string) =>
      `Also allow on ${initiator} (the site you're on) — needed when its pages call ${target}.`,
    // Pattern/regex scopes: Chrome grants by site, not by pattern, so the two
    // dimensions the platform needs are collected as separate labeled inputs.
    patternIntro:
      "This rule matches by pattern. Chrome grants access by site, so name both:",
    targetsQuestion: "Which sites do the requests go to?",
    initiatorsQuestion: "Which pages start those requests?",
    patternEffect:
      "The rule matches wherever its pattern says, but only takes effect where both sites are granted.",
    allSitesLink: "All of them / I can't enumerate",
    // No page-under-test context (authored from options, or an untracked tab):
    // no initiator can be inferred, so the input is explicit and optional.
    noContextInitiators: "Pages that call these sites",
    addSite: "+ add",
    targetInputLabel: "Add a site the requests go to",
    initiatorInputLabel: "Add a page that starts these requests",
    removeSite: (host: string) => `Remove ${host}`,
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
    sessionCap:
      "Chrome caps temporary tab rules, and this would pass headershim's limit of 1,000. Remove a temporary override you're done with, or save this one as a rule instead.",
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
    headerNameRequired: "Every rule needs a header name — type one to save.",
    headerNameInvalid:
      "This isn't a legal header name — letters, digits, and hyphens are the safe set.",
    valueRequired:
      "Set and append need a value — type one, or switch the operation to Remove.",
    valueLineBreak:
      "Header values can't contain line breaks — remove them to save.",
    scopeEmpty: {
      domains: "Name at least one domain this rule applies to.",
      pattern: "Type a URL pattern this rule applies to.",
      regex: "Type a regex this rule applies to.",
      all: "Pick a scope for this rule.",
      resourceTypes: "Pick at least one resource type.",
    },
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
    // Silkscreen heading; stays sentence case in the DOM, uppercased via CSS.
    heading: "Verify · this tab",
    regionLabel: "Verify results",
    matchedLabel: "Rules that fired",
    noMatchesLabel: "No matches",
    close: "Close verify",
    matchCount: (n: number) =>
      n === 0 ? "no matches" : n === 1 ? "1 match" : `${n} matches`,
    // Per-rule hints: only the statically determinable causes (SPEC §5).
    hints: {
      disabled: "disabled",
      "scope-excludes": "scope excludes this site",
      "needs-access": "needs access",
    } as const,
  },
} as const;

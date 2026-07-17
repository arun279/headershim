/**
 * The single source of every user-facing string. Components do not inline copy;
 * they read it from here so wording stays consistent and reviewable in one place.
 * Strings follow a consistent voice: the platform is named as the actor,
 * cause precedes impact precedes next step, and exact names are always shown.
 */

import { BRAND_NAME } from "../brand";

/**
 * A sentence is a segment list so the wire-facing tokens inside it (hostnames,
 * counts) can render in the data face while every word still lives here.
 * `sentenceText` flattens one back to its plain reading.
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
const profiles = (n: number) => (n === 1 ? "profile" : "profiles");
const changes = (n: number) => (n === 1 ? "change" : "changes");
const sites = (n: number) => (n === 1 ? "site" : "sites");

/** "5h 18m" / "8m" / "3d 4h", the coarsest two units that stay honest. */
function duration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export const copy = {
  app: {
    name: BRAND_NAME,
    tagline: "Add, change, and remove HTTP headers on the sites you choose.",
  },

  // The popup readout: the tab-scoped answer and the one exception grammar.
  // Live changes carry no words; only exceptions speak, each in one language.
  readout: {
    // The one fact. It wraps rather than truncating the count.
    status: (count: number): Sentence => [
      data(count),
      ` ${changes(count)} on this tab`,
    ],
    newChange: "New change on this tab",
    // Substatus segments, shown only when a count is nonzero.
    needsAccess: (count: number) => `${count} needs access`,
    refused: (count: number) =>
      count === 1 ? "1 refused by Chrome" : `${count} refused by Chrome`,
    overridden: (count: number) =>
      count === 1
        ? "1 overridden by another rule"
        : `${count} overridden by another rule`,
    liveLabel: "Running",
    attentionLabel: "Needs attention",
    direction: { request: "Request", response: "Response" },
    verb: { set: "Set", append: "Append", remove: "Remove" },
    to: "→",
    overriddenBy: (winner: string) => `overridden by ${winner}`,
    refusedReason: {
      host: "Chrome won't let extensions change the Host header",
      header: "Chrome won't accept this header name",
      append:
        "Chrome accepts this header name, but only allows appending to a fixed set of request headers. Use Set instead.",
      value: "Chrome won't accept a line break in the value",
      pattern: "Chrome won't accept this URL pattern",
      regex: "Chrome won't accept this regular expression",
      domains: "Chrome won't accept this rule's sites",
    },
    // A rule whose match Chrome settles per request, against a URL this popup
    // never sees. Saying "live" here would draw a fact it cannot know.
    unconfirmedReason: "Only Chrome can tell whether this matches here",
    // The ruleset Chrome is running is not the one on screen, so no line can
    // claim to be live until the two agree again.
    outOfSyncReason: "Chrome hasn't taken this rule yet",
    unconfirmed: (count: number) => `${count} unconfirmed`,
    outOfSync: (count: number) => `${count} not applied yet`,
    details: "Details",
    grant: "Grant",
    ruleToggle: (header: string, on: boolean) =>
      `${on ? "Turn off" : "Turn on"}: ${header}`,
    editValue: (header: string) => `Edit ${header} value`,
    // Two different permanences, so two different words: the footer opens a
    // saved rule, the composer commits a change that dies with the tab.
    addChange: "Add a change",
    addThisTab: "Add to this tab",
    justThisTab: "Just this tab",
    pauseSwitch: "All header changes",
    onLabel: "On",
    pausedLabel: "Paused",
    pausedBanner:
      "Everything paused. Switching back on restores this exact state.",
    empty: (host: string): Sentence => [
      "HeaderShim isn't changing anything on ",
      data(host),
      ".",
    ],
    noHost: "Open the popup on a website to see what HeaderShim does there.",
    thisTabTag: "This tab only",
    thisTabClears: "clears when you close the tab",
    removeOverride: (header: string) => `Remove this-tab change: ${header}`,
    overrideToggle: (header: string, on: boolean) =>
      `${on ? "Turn off" : "Turn on"} this-tab change: ${header}`,
    switcher: {
      chipLabel: "Switch profile",
      title: "Switch profile",
      select: (name: string) => `Switch to ${name}`,
      // Consequence first: the local diff a switch would apply to this tab.
      previewLead: (name: string) => `If you switch to ${name}, on this tab`,
      drops: (header: string, more: number): Sentence => [
        "drops ",
        data(header),
        ...(more > 0 ? [` and ${more} more`] : []),
      ],
      adds: (label: string, more: number): Sentence => [
        "adds ",
        data(label),
        ...(more > 0 ? [` and ${more} more`] : []),
      ],
      newProfile: "New profile",
    },
  },

  // The credential hero. Honest by construction: a countdown only where a
  // countdown can be true, an opaque token stating only that it has none.
  token: {
    jwtTag: "JWT",
    opaque: "opaque token · no expiry to read",
    expiresIn: (remainingMs: number) =>
      remainingMs <= 0 ? "expired" : `expires in ${duration(remainingMs)}`,
    warnNote: "swap before it lapses",
    valueLabel: (header: string) => header,
    swap: "Swap",
    swapOn: (host: string): Sentence => ["on ", data(host)],
    pasteLabel: "Paste the new token",
    // Where the new bytes land, said before you commit them: a swap rewrites
    // whichever change is carrying the token, and those two live different lives.
    pasteReplaces: {
      rule: "replaces the token on the saved rule",
      override: "replaces the token on this tab",
    },
    pasteAria: "New token value",
    replace: "Replace",
    cancel: "Cancel",
  },

  profiles: {
    navLabel: "Profiles",
    allProfiles: "all profiles",
    onTag: "on",
    offTag: "off",
    create: "Create profile",
    turnOn: "Turn on",
    turnOff: "Turn off",
    toggleLabel: (name: string, on: boolean) =>
      `Turn ${on ? "off" : "on"} profile: ${name}`,
    manage: "Manage profiles",
    actions: (name: string) => `Profile actions: ${name}`,
    saveError: "Could not save the profile. Try again.",
    chipState: (focused: boolean, on: boolean) =>
      `${focused ? ", focused" : ""}${on ? ", on" : ", off"}`,
  },

  // The full-tab options surface: frame, profile management, and bulk actions.
  options: {
    nav: {
      label: "Sections",
      groupRules: "Rules",
      groupManage: "Manage",
      allRules: "All rules",
      profiles: "Profiles",
      importExport: "Import & export",
      siteAccess: "Site access",
      traffic: "Configured changes",
      settings: "Settings",
      about: "About",
    },
    version: (version: string) => `v${version}`,

    // Every rule across every profile, in one severity grammar, grouped by the
    // site it lands on or the header it carries.
    allRules: {
      title: "All rules",
      lensLabel: "Group rules",
      bySite: "By site",
      byHeader: "By header",
      newRule: "New rule",
      ruleCount: (count: number) => `${count} ${rules(count)}`,
      // A site group's header: the domain and how many rules land on it.
      siteRules: (count: number) => `${count} ${rules(count)}`,
      crossSite: "Cross-site rules",
      crossSiteNote:
        "Pattern, regex, and all-sites rules, whichever tab they meet.",
      // A header group's blast radius.
      reaches: (siteCount: number, broad: boolean): Sentence => [
        "reaches ",
        data(siteCount),
        ` ${sites(siteCount)}`,
        ...(broad ? [" plus every site a pattern matches"] : []),
      ],
      allReach: (scopeName: string): Sentence => ["reaches ", scopeName],
      broadReach: "reaches every matching site",
      sharedRule: (siteCount: number) =>
        `one shared rule · switch affects all ${siteCount} sites`,
      scope: {
        all: "all sites",
        pattern: "URL pattern",
        regex: "regex",
        domains: (first: string, more: number): Sentence => [
          data(first),
          ...(more > 0 ? [" +", data(more)] : []),
        ],
      },
      editRule: (header: string) => `Edit rule: ${header}`,
      profileOff: "its profile is off",
      empty: "No rules yet.",
      emptyProfileOff:
        "Every profile is off. Turn one on to see its rules run.",
    },

    // Every change the compiled ruleset carries, and where each one stands. It
    // reads that ruleset, never the wire, so no line here may speak of a
    // request: none has been observed, and one may never be made.
    traffic: {
      title: "Configured changes",
      status: {
        live: "live",
        unconfirmed: "only Chrome can say",
        needsAccess: "not granted",
        refused: "refused by Chrome",
        outOfSync: "not applied yet",
        paused: "paused",
      },
      crossSiteHost: "cross-site",
      empty: "Nothing is running yet. Turn on a rule or grant a site.",
    },
    profiles: {
      title: "Profiles",
      new: "+ New",
      newProfile: "New profile",
      listLabel: "Profiles",
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
      reorderHandle: (name: string) =>
        `Reorder ${name}; press the arrow keys to move it`,
      reordered: (name: string, position: number) =>
        `${name}, moved to position ${position}`,
      nameTaken: (name: string) => `'${name}' is taken. Use a different name.`,
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
      loadingEditor: "Loading rule editor…",
    },
    importExport: {
      title: "Import & export",
      importHeading: "Import",
      instruction:
        "HeaderShim JSON or ModHeader export, detected automatically.",
      choose: "Choose file…",
      fileInputLabel: "Import a HeaderShim or ModHeader export",
      exportHeading: "Export",
      exportEverything: "Export everything",
      exportOne: "Export one profile",
      exportChoiceLabel: "Profile to export",
      // Shown verbatim on every export.
      secretsReminder:
        "This file contains the header values you typed, including any tokens or keys. Treat it like a credentials file.",
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
        `Imported ${count} ${profiles(count)}, turned off. Turn them on when you're ready.`,
      warnings: {
        credentialHeader: (header: string): Sentence => [
          "Carries a credential in ",
          data(header),
          ". Check where this rule reaches before you turn it on.",
        ],
        securityResponseHeader: (header: string): Sentence => [
          "Changes ",
          data(header),
          ", a protection sites send. Check where this rule reaches before you turn it on.",
        ],
        appendDegraded: (header: string): Sentence => [
          "Chrome only allows appending to a fixed set of request headers, and ",
          data(header),
          " isn't one of them, so it was imported as Set.",
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
          "Dropped. HeaderShim has no per-rule URL exclusion in this version.",
        droppedInitiatorDomain:
          "Dropped. HeaderShim has no initiator scoping in this version.",
        droppedTab: "Dropped. Use This-tab overrides for per-tab needs.",
        droppedUrlReplacement: "Dropped. HeaderShim changes headers only.",
      },
    },
    siteAccess: {
      title: "Site access",
      neededHeading: "Needed but not granted",
      grantedHeading: "Granted",
      usedBy: (count: number) => `used by ${count} ${rules(count)}`,
      ruleCount: (count: number) => `${count} ${rules(count)}`,
      grant: "Grant",
      grantLabel: (domain: string) => `Grant access to ${domain}`,
      revoke: "Revoke",
      revokeLabel: (domain: string) => `Revoke access to ${domain}`,
      revoked: (domain: string) => `Access to ${domain} revoked`,
      // A narrow grant removed while the broad grant stands changes nothing
      // about reach; saying "revoked" there would claim access ended.
      revokedUnderAllSites: (domain: string) =>
        `${domain} grant removed. All-sites access still covers it.`,
      // The standing note: shown while any enabled rule reaches
      // subresources without naming the pages that start those requests.
      initiatorNote:
        "Requests started by other pages also need those pages granted.",
      allSites: {
        heading: "Allow on all sites",
        consequence:
          "This gives HeaderShim access to every website instead of asking one site at a time.",
        disclosure: "Review all-sites access",
        // Chrome shows this exact warning before it can grant broad access.
        warning:
          'Chrome will warn: "Read and change all your data on all websites". Your rules still only apply where their scopes say, and you can revoke this access here at any time.',
        button: "Allow on all sites",
        on: "All-sites access is on",
        revoked: "All-sites access revoked",
      },
    },
    settings: {
      title: "Settings",
      theme: {
        label: "Theme",
        options: { system: "System", light: "Light", dark: "Dark" },
      },
      shortcuts: "Keyboard shortcuts",
    },
    about: {
      title: "About",
      build: (version: string, commit: string): Sentence => [
        "HeaderShim v",
        data(version),
        " · commit ",
        data(commit),
      ],
      description:
        "HeaderShim modifies HTTP request and response headers using scoped rules, profiles, and tab-specific overrides.",
      license:
        "Open source under the MIT license. Provided as is, without warranty.",
      links: {
        repository: "Repository",
        repositoryUrl: "https://github.com/arun279/headershim",
        license: "License",
        licenseUrl: "https://github.com/arun279/headershim/blob/main/LICENSE",
        issues: "Issues",
        issuesUrl: "https://github.com/arun279/headershim/issues",
        releases: "Releases",
        releasesUrl: "https://github.com/arun279/headershim/releases",
      },
    },
  },

  actions: {
    newRule: "+ New rule",
    createRule: "Create rule",
    createRuleAndAllow: (host: string) => `Create rule and allow ${host}`,
    saveChanges: "Save changes",
    saveChangesAndAllow: (host: string) => `Save changes and allow ${host}`,
    testOnThisTab: "Test on this tab",
    resume: "Resume",
    grantAccess: "Grant access",
    // activeTab reload handed to the user after a grant lands; there is no
    // automatic reload (locus of control).
    reloadTab: "Reload tab",
    grant: "Grant",
    addOverride: "Add override",
    cancel: "Cancel",
    undo: "Undo",
    regenerate: "Regenerate",
    options: "Options",
    pause: "Pause",
    globalPause: "Global pause",
  },

  toast: {
    ruleCreated: "Rule created",
    changesSaved: "Changes saved",
    ruleLive: "Access granted",
    activeOn: (host: string) => `Active on ${host}`,
    activeOnSites: (siteCount: number) => `Active on ${siteCount} sites`,
    // The grant-to-reload prompt when the annunciator grant names no single
    // site: confirms access landed and pairs with a Reload-tab action.
    accessGranted: "Access granted",
    // "· Undo" is the toast's action button, not part of the message.
    ruleDeleted: "Rule deleted",
    rulesDeleted: (count: number) => `${count} ${rules(count)} deleted`,
    profileDeleted: (name: string) => `Profile '${name}' deleted`,
  },

  rules: {
    listLabel: "Rules",
    switchLabel: (header: string, on: boolean, siteCount?: number) =>
      `Rule ${on ? "on" : "off"}: ${header}${siteCount === undefined ? "" : `; affects all ${siteCount} sites`}`,
    menuLabel: (header: string) => `Rule actions: ${header}`,
    direction: { request: "request", response: "response" },
    operation: { set: "set", append: "append", remove: "remove" },
    redacted: "…redacted",
    generated: (kind: string) => `${kind} · generated`,
    profileOffDetail: "This profile is off · its rules aren't running.",
    needsAccess: (host: string, moreSites: number): Sentence => [
      "Needs access · ",
      data(host),
      ...(moreSites > 0 ? [" +", data(moreSites)] : []),
    ],
    editValueHint: "Enter saves · Esc cancels",
    pasteNewValue: "Paste new value",
    temporarySwitchLabel: (header: string, on: boolean) =>
      `Temporary override ${on ? "on" : "off"}: ${header}`,
    invalidRegex: "Invalid regex. Edit the scope to enable",
    // Announced after the ⋯ menu copies a (possibly truncated) value in full.
    valueCopied: "Value copied",
    overridden: "overridden by a rule above",
    initiatorNote:
      "requests started by other pages also need those pages granted",
  },

  emptyState: {
    profile: (name: string) => `${name} has no rules yet.`,
    otherProfilesUnchanged: "Your other profiles are unchanged.",
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
    heading: (mode: "new" | "edit", profile: string) =>
      `${mode === "new" ? "New rule" : "Edit rule"} · ${profile}`,
    close: "Close editor",
    delete: "Delete rule",
    // The editor writes into whichever profile is picked here, so a rule can be
    // authored into one that is not running without touching live traffic.
    profileHelper: "The profile this rule is saved in",
    discardConfirm: {
      title: "Discard this rule?",
      keepEditing: "Keep editing",
      discard: "Discard",
    },
    labels: {
      direction: "Direction",
      operation: "Operation",
      headerName: "Header name",
      value: "Value",
      profile: "Profile",
      scope: "Scope",
      comment: "Comment",
      resourceTypes: "Resource types",
    },
    placeholders: {
      headerName: "authorization",
      value: "Bearer …",
    },
    // A pasted `name: value` line lands split across the two fields rather than
    // failing the name's token grammar on the colon.
    pastedLineSplit: "Pasted header split into name and value.",
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
    allSitesHelper: "matches every website",
    domainsHelper: "matches this domain and its subdomains",
    requestTarget:
      "Runs on requests to these hosts, which may differ from the page you are viewing.",
    addDomain: "+ add",
    addChipHint: "Press Enter to add",
    domainInputLabel: "Add domain",
    removeDomain: (domain: string) => `Remove ${domain}`,
    patternHint: [
      data("||example.com/"),
      " matches the site, subdomains, and every path · ",
      data("||example.com/api/"),
      " narrows it to /api/ paths",
    ] as Sentence,
    regexHint: "Uses Chrome's RE2 syntax.",
    allTypes: "All types",
    insert: "Insert",
    insertUuid: "UUID",
    insertTimestamp: "Timestamp (ISO 8601)",
    generatedKind: { uuid: "UUID", timestamp: "Timestamp" },
    newlineRemoved: "Line breaks removed. A header value is a single line.",
    caution: "Caution",
  },

  // Optional one-word context after a suggested name ("authorization: credentials").
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
    note: "Generated when you saved this rule. This value is frozen and does not change per request.",
    frozen: (savedAtUtc: string) => `Frozen at save: ${savedAtUtc}`,
  },

  errors: {
    regexInvalid:
      "This pattern isn't valid RE2, the regex dialect Chrome's rule engine uses. RE2 has no lookahead or backreferences. Fix the pattern, or switch this scope to a URL pattern.",
    regexOversize:
      "This pattern compiles to more than Chrome's 2 KB limit for a single rule. Shorten or split it.",
    patternInvalid:
      "Chrome's rule engine can't use this URL pattern. A pattern can't contain non-ASCII characters (write an internationalized domain in its punycode form) and can't start with '||*'. Fix the pattern, or switch this scope to a regex.",
    grantDeclined: (host: string) =>
      `Saved, but not running. You declined access to ${host}, so this rule can't change anything there. Grant access when you're ready.`,
    // A this-tab change has no life beyond the grant, so a decline leaves
    // nothing to save: the draft stays here rather than becoming a dead row.
    thisTabDeclined: (host: string) =>
      `Not added. A this-tab change needs access to ${host}, and you declined. Add it again when you're ready to allow it.`,
    appendDisallowed: (name: string) =>
      `Chrome only allows appending to a fixed set of request headers, and ${name} isn't one of them. Use Set instead. It replaces any existing value.`,
    ruleCap:
      "Chrome caps extensions at 5,000 header rules, and enabling this would pass HeaderShim's safe limit of 4,500. Disable or delete rules you're not using, or turn off a profile.",
    ruleCounter: (enabled: number) =>
      `${enabled.toLocaleString("en-US")} of 4,500 enabled rules.`,
    regexRuleCap:
      "Chrome separately caps regex-scoped rules at 1,000, and enabling this would pass that limit. Disable or delete regex rules you're not using, or switch some scopes to URL patterns.",
    storageBudget:
      "Chrome gives an extension limited local storage, and this change would pass HeaderShim's safe budget of 4 MB. Shorten long header values, or delete rules you're not using.",
    sessionCap:
      "Chrome caps temporary tab rules, and this would pass HeaderShim's limit of 1,000. Remove a temporary override you're done with, or save this one as a rule instead.",
    importParse:
      "This file isn't valid JSON, so nothing was imported and nothing was changed. If it came from ModHeader, export it again with Profile → Export → JSON.",
    importNewer: (fileVersion: number, supportedVersion: number) =>
      `This file was exported by a newer HeaderShim (format ${fileVersion}; this version reads up to ${supportedVersion}). Update HeaderShim, then import again. Nothing was changed.`,
    importUnrecognized:
      "This file is valid JSON but isn't a HeaderShim or ModHeader export, so nothing was imported and nothing was changed. HeaderShim reads its own exports and ModHeader profile exports only.",
    importTooLarge:
      "This file is far larger than any export HeaderShim can hold, so it wasn't read and nothing was changed. Check you picked the right file.",
    importUnreadable:
      "This file couldn't be read, so nothing was imported and nothing was changed. If it moved or changed since you picked it, pick it again.",
    headerNotModifiable:
      "Header names starting with ':' are HTTP/2 internals that Chrome doesn't let any extension touch. To change the host a server sees, the request would have to use HTTP/1.1. For most modern sites that isn't possible.",
    headerNameRequired: "Every rule needs a header name. Type one to save.",
    headerNameInvalid:
      "This isn't a legal header name. Letters, digits, and hyphens are the safe set.",
    valueRequired:
      "Set and append need a value. Type one, or switch the operation to Remove.",
    valueLineBreak:
      "Header values can't contain line breaks. Remove them to save.",
    scopeEmpty: {
      domains: "Name at least one domain this rule applies to.",
      pattern: "Type a URL pattern this rule applies to.",
      regex: "Type a regex this rule applies to.",
      all: "Pick a scope for this rule.",
      resourceTypes: "Pick at least one resource type.",
    },
    newerStore: (foundVersion: number, supportedVersion: number) =>
      `Your rules were saved by a newer HeaderShim (format ${foundVersion}; this version reads up to ${supportedVersion}). Update HeaderShim to pick them back up. Nothing has been changed.`,
  },

  advisories: {
    managedHeader:
      "Chrome's network stack manages this header itself; a rule here usually has no effect.",
    host: "Chrome can't change the authority on HTTP/2 connections, which most sites use. This rule usually has no effect.",
    credential:
      "This header carries a credential. Everything this rule reaches will be sent it, so keep the scope as narrow as the job needs.",
    securityResponse:
      "Sites send this header to protect the pages they serve. Changing it turns that protection off wherever this rule reaches, for as long as it's on.",
  },
} as const;

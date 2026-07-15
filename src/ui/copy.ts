/**
 * The single source of every user-facing string. Components never inline copy;
 * they read it from here so wording stays consistent and reviewable in one place.
 * Strings follow a consistent voice: the platform is named as the actor,
 * cause precedes impact precedes next step, and exact names are always shown.
 */

import { BRAND_NAME } from "../brand";

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
    name: BRAND_NAME,
    // Identical wording ships on the trust page.
    tagline:
      "Change HTTP headers on sites you choose. No account. Nothing ever leaves your device.",
  },

  annunciator: {
    paused: ["Paused. No headers are being modified."] as Sentence,
    off: ["Off. No profiles are on."] as Sentence,
    liveEmpty: ["Live. No rules yet."] as Sentence,
    outOfSync: [
      "Out of sync. Chrome rejected HeaderShim's last rule update, so the rules shown here may not all be applied. Any edit retries it.",
    ] as Sentence,
    // "N of M rules enabled" names the enabled/configured signal so it never
    // reads as a match score; the badge and Verify speak of matches instead.
    live: (
      enabledCount: number,
      totalCount: number,
      temporaryCount: number,
    ): Sentence => [
      "Live. ",
      data(enabledCount),
      " of ",
      data(totalCount),
      ` ${rules(totalCount)} enabled`,
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
      ` ${rules(ruleCount)} can't run. HeaderShim doesn't have access to `,
      data(host),
      ...(moreSites > 0
        ? [" and ", data(moreSites), ` more ${sites(moreSites)}`]
        : []),
      ".",
    ],
    activeProfiles: (count: number): Sentence => [
      " · ",
      data(count),
      " profiles active",
    ],
  },

  firstRun: {
    createRule: "Create your first rule",
    tryThisTab: "Try it on this tab",
    tryThisTabSubline: "temporary, this tab only, gone on close",
    importFile: "Import from a file",
  },

  profiles: {
    navLabel: "Profiles",
    offTag: "off",
    duplicateRules: "Duplicate this profile's rules",
    create: "Create profile",
    enableWithoutSwitching: "Enable without switching",
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
      profiles: "Profiles & rules",
      importExport: "Import & export",
      siteAccess: "Site access",
      settings: "Settings",
      about: "About",
    },
    version: (version: string) => `v${version}`,
    profiles: {
      title: "Profiles",
      new: "+ New",
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
      // The disclosure that opens a profile for badge/rule editing.
      expand: (name: string) => `Edit ${name}`,
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
      sectionLabel: (name: string) => `Rules in ${name}`,
      new: "+ New rule",
      loadingEditor: "Loading rule editor…",
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
        droppedUrlReplacement:
          "Dropped. HeaderShim changes headers only, never redirects.",
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
      badgeMode: {
        label: "Badge shows",
        options: { count: "Matched-rule count", initials: "Profile initials" },
      },
      shortcuts: "Keyboard shortcuts",
    },
    // The trust page, written for the person who installed HeaderShim:
    // falsifiable claims, each with a way to check it. The reviewer-grade threat
    // model lives in SECURITY.md, linked once. The install claim is always "no
    // install-time warning", never "no permission text anywhere"; the CWS caveat
    // is stated, never "verify the store build".
    about: {
      trustHeading: "About & trust",
      build: (version: string, commit: string): Sentence => [
        "HeaderShim v",
        data(version),
        " · commit ",
        data(commit),
      ],
      summary: {
        heading: "Three facts you can check",
        facts: [
          "HeaderShim is open source. The full source, its MIT license, and every release are linked below.",
          "No code in HeaderShim can send your data anywhere. It ships no content scripts, no scripting permission, and no webRequest, and it takes no host access at install. Its only capability is Chrome's declarative header engine, which cannot read page contents or make network calls. The manifest shows this.",
          "HeaderShim has no telemetry or analytics. A policy check in CI fails the build if any network or tracking capability is added.",
        ],
      },
      permissions: {
        heading: "Permissions, justified",
        intro:
          'HeaderShim installs with no install-time warning. It requests no host access and no warning-bearing permission at install. Chrome\'s details page shows its generic site-access line ("This extension can read and change your data on sites. You can control which sites the extension can access."), and that line is accurate: you grant site access per site, when a rule needs it, and revoke it in one click.',
        columns: {
          permission: "Permission",
          why: "Why it's needed",
          when: "When",
        },
        rows: [
          {
            permission: "declarativeNetRequestWithHostAccess",
            why: "Applies your header rules through Chrome's declarative rule engine, which only acts on sites you've granted.",
            when: "At install. No warning dialog.",
          },
          {
            permission: "storage",
            why: "Saves your profiles, rules, and settings on this device, and nothing else.",
            when: "At install. No warning dialog.",
          },
          {
            permission: "activeTab",
            why: "Lets This-tab overrides and Verify act on the tab where you clicked, with no site grant.",
            when: "Only on your gesture. The click or keyboard shortcut is the consent.",
          },
          {
            permission: "Site access (optional)",
            why: "Lets rules change headers on the sites you name. Chrome asks with its own prompt, scoped to exactly those sites.",
            when: "When a rule first needs a site. Revocable any time in Site access.",
          },
        ],
      },
      storage: {
        heading: "What's stored",
        body: "HeaderShim stores exactly what you typed: rule definitions and UI preferences, on this device, and nothing else. It never records your traffic, the headers on it, the sites you visit, or history of any kind. You can export the whole store to a readable file at any time and check it byte for byte. That export is the inspection surface. A rule can hold a live secret you typed, such as an Authorization token or a Cookie value, stored unencrypted on disk like any local config file. Treat an export like a file of passwords.",
      },
      neverList: {
        heading: "What HeaderShim will never do",
        intro:
          "Some of these you can check in the manifest, some are standing commitments, and some are limits Chrome places on every extension.",
        // The lead claims are the signature. Each detail is one plain user-facing
        // consequence. The groups mirror what the listing states.
        groups: [
          {
            heading: "Checkable in the manifest",
            items: [
              {
                lead: "No content scripts, no scripting, no web-accessible resources, no webRequest",
                detail:
                  "HeaderShim has no code path into the pages you open, so it can't read them or inject into them.",
              },
              {
                lead: "No telemetry or analytics",
                detail:
                  "No network code ships to send it, and CI fails the build if any is added.",
              },
              {
                lead: "No remote config",
                detail:
                  "Every behavior is bundled in the build you installed. Nothing is fetched to change it after review.",
              },
            ],
          },
          {
            heading: "Standing commitments",
            items: [
              {
                lead: "No accounts, no cloud sync, no server",
                detail:
                  "There is no HeaderShim server, and none is planned. To share a profile, export a file.",
              },
              {
                lead: "No traffic or header history",
                detail:
                  "HeaderShim saves the rules you write, never the requests you make. Any future debug log would be in-memory and off by default.",
              },
              {
                lead: "No sale, no silent ownership transfer",
                detail:
                  "A change of maintainer is the most common way a trusted extension goes bad. HeaderShim commits against a quiet handover. The security policy has the detail.",
              },
            ],
          },
          {
            heading: "Limits HeaderShim doesn't work around",
            items: [
              {
                lead: "No request-time dynamic values",
                detail:
                  "Chrome doesn't let an extension compute a header value per request, and HeaderShim doesn't try to. Generated values are frozen when you save the rule.",
              },
              {
                lead: "No response-body changes",
                detail:
                  "Chrome's header engine can't touch the page you receive, only its headers. It can't rewrite the page.",
              },
              {
                lead: "No redirects or URL rewriting",
                detail:
                  "HeaderShim changes headers only. It can't send you to another site.",
              },
            ],
          },
        ],
      },
      security: {
        heading: "Security and disclosure",
        body: "The full threat model, the risks HeaderShim accepts, and how to report a vulnerability are in the security policy.",
        linkLabel: "Read the security policy",
        linkUrl: "https://github.com/arun279/headershim/blob/main/SECURITY.md",
      },
      verifyBuild: {
        heading: "Verify this build",
        intro:
          "Every release zip is built by public CI from a tagged commit. The GitHub release carries the zip, a SHA256SUMS file, and a signed provenance attestation binding the artifact to the exact commit and workflow run.",
        steps: [
          [
            "Check the zip you downloaded against the published hashes: ",
            data("sha256sum -c SHA256SUMS"),
          ],
          [
            "Check that the zip was built from the tagged commit by the public workflow: ",
            data("gh attestation verify <zip> --repo arun279/headershim"),
          ],
        ] as readonly Sentence[],
        caveat:
          "The Chrome Web Store re-packages and signs what we upload, so the installed extension can't be byte-compared against our zip. What you can verify: the files inside your installed extension match the attested release files, and the attestation chains to the public source.",
      },
      links: {
        license: "MIT license",
        repository: "Repository",
        repositoryUrl: "https://github.com/arun279/headershim",
        issues: "Issues",
        issuesUrl: "https://github.com/arun279/headershim/issues",
        changelog: "Changelog",
        changelogUrl: "https://github.com/arun279/headershim/releases",
      },
    },
  },

  actions: {
    newRule: "+ New rule",
    createRule: "Create a rule",
    saveChanges: "Save changes",
    verify: "Verify",
    resume: "Resume",
    grantAccess: "Grant access",
    // activeTab reload handed to the user after a grant lands and in Verify's
    // no-request state; never an automatic reload (locus of control).
    reloadTab: "Reload tab",
    grantLater: "Grant later",
    discardRule: "Discard rule",
    grant: "Grant",
    addOverride: "Add override",
    cancel: "Cancel",
    undo: "Undo",
    regenerate: "Regenerate",
    options: "Options",
    pause: "Pause",
    globalPause: "Global pause",
    allowOn: (target: string) => `Allow on ${target}`,
  },

  toast: {
    ruleCreated: "Rule created",
    changesSaved: "Changes saved",
    ruleLive:
      "Rule is live. Make a request on that site, then run Verify to confirm.",
    activeOn: (host: string) => `Active on ${host}`,
    activeOnSites: (siteCount: number) => `Active on ${siteCount} sites`,
    // The grant-to-reload prompt when no single host can be named (annunciator /
    // Verify Grant): confirms access landed and pairs with a Reload-tab action.
    accessGranted: "Access granted",
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
    redacted: "…redacted",
    profileOff: "Profile off",
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
    invalidRegex: "Invalid regex. Edit the scope to enable",
    // Announced after the ⋯ menu copies a (possibly truncated) value in full.
    valueCopied: "Value copied",
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
    // Persistent honesty line under the section; "Create a rule"
    // is the action button between the two spans.
    standingBefore:
      "Calling a different API from this page? That needs a saved rule and a one-click site grant. ",
    standingAction: "Create a rule",
    standingAfter: " pre-fills it.",
    // No web origin to bind to (chrome:// or store page).
    noHost: "Open the popup on a website to add a temporary override for it.",
  },

  menu: {
    edit: "Edit",
    copyValue: "Copy value",
    duplicate: "Duplicate",
    moveToProfile: "Move to profile",
    regenerateValue: "Regenerate value",
    undoLastDelete: "Undo last delete",
    delete: "Delete",
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
    editRule: "Edit rule",
    newRule: "New rule",
    heading: (mode: "new" | "edit", profile: string) =>
      `${mode === "new" ? "New rule" : "Edit rule"} · ${profile}`,
    close: "Close editor",
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
    domainSuggestion: "Suggested from this tab. Edit or remove it.",
    requestTarget:
      "Runs on requests to these hosts, which may differ from the page you are viewing.",
    addDomain: "+ add",
    domainInputLabel: "Add domain",
    removeDomain: (domain: string) => `Remove ${domain}`,
    patternHint: [
      data("||example.com/"),
      " matches the site, subdomains, and every path · ",
      data("||example.com/api/"),
      " narrows it to /api/ paths",
    ] as Sentence,
    grantNote: "This rule only takes effect on sites you've granted access to.",
    allTypes: "All types",
    includesPages: "Includes top-level pages",
    insert: "Insert",
    insertUuid: "UUID",
    insertTimestamp: "Timestamp (ISO 8601)",
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

  grantPanel: {
    heading: "Grant access",
    createdLead: "Rule created. One step left to make it run.",
    savedLead: "Saved. One step left to make it run.",
    single: (host: string) =>
      `To change headers on ${host}, Chrome requires you to grant HeaderShim access to that site.`,
    multiple: (siteCount: number) =>
      `To change headers on ${siteCount} sites, Chrome requires you to grant HeaderShim access to those sites:`,
    initiator: (initiator: string, target: string) =>
      `Also allow on ${initiator} (the site you're on). Its pages need it to call ${target}.`,
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
      "This pattern isn't valid RE2, the regex dialect Chrome's rule engine uses. RE2 has no lookahead or backreferences. Fix the pattern, or switch this scope to a URL pattern.",
    regexOversize:
      "This pattern compiles to more than Chrome's 2 KB limit for a single rule. Shorten or split it.",
    patternInvalid:
      "Chrome's rule engine can't use this URL pattern. A pattern can't contain non-ASCII characters (write an internationalized domain in its punycode form) and can't start with '||*'. Fix the pattern, or switch this scope to a regex.",
    grantDeclined: (host: string) =>
      `Saved, but not running. You declined access to ${host}, so this rule can't change anything there. Grant access whenever you're ready. The rule starts working immediately.`,
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
  },

  verify: {
    // The honest-limits footer.
    limits:
      'Chrome only reports rule matches from the last 5 minutes on this tab. DevTools\' Network panel will not show header changes made by extensions (a known Chrome bug), so trust this panel or your server logs, not DevTools. Cached responses never pass through header rules: to test reliably, open DevTools → Network → check "Disable cache", then reload.',
    // Verify leads with the most basic unmet precondition,
    // never the caching essay. blocked > no-request > matched, in that order.
    // A grant gap is the headline, with Grant surfaced in the panel itself.
    blockedHeadline: (
      ruleCount: number,
      host: string,
      moreSites: number,
    ): Sentence => [
      data(ruleCount),
      ` ${rules(ruleCount)} can't run. Needs access to `,
      data(host),
      ...(moreSites > 0
        ? [" and ", data(moreSites), ` more ${sites(moreSites)}`]
        : []),
      ".",
    ],
    // Nothing fired and nothing is blocked: the tab has almost certainly not
    // been requested since the last change, so lead with the reload, not cache.
    noRequestHeadline: "No headers changed on this tab's last request.",
    reloadHint: "Reload the tab, then run Verify again to see what fired.",
    // The residual causes once a reload is ruled out. The caching/DevTools half
    // lives in `limits`, so this names only what that footer does not.
    stillNothing:
      "Still nothing after a reload? A rule limited to certain resource types only fires on those requests, and requests another site starts need that site granted too. See Site access in options.",
    // The has-matches headline. Counts of matches, phrased so it never reads as
    // a configuration score; the per-rule list carries the tallies.
    matchedHeadline: (matched: number): Sentence => [
      "Last request: ",
      data(matched),
      " matched",
    ],
    // Silkscreen heading; stays sentence case in the DOM, uppercased via CSS.
    heading: "Verify · this tab",
    regionLabel: "Verify results",
    matchedLabel: "Rules that fired",
    noMatchesLabel: "No matches",
    close: "Close verify",
    matchCount: (n: number) =>
      n === 0 ? "no matches" : n === 1 ? "1 match" : `${n} matches`,
    // Per-rule hints: only the statically determinable causes.
    hints: {
      disabled: "disabled",
      "scope-excludes": "scope excludes this site",
      "needs-access": "needs access",
    } as const,
  },
} as const;

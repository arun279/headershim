/**
 * The single source of every user-facing string. Components do not inline copy;
 * they read it from here so wording stays consistent and reviewable in one place.
 * Strings follow a consistent voice: the platform is named as the actor,
 * cause precedes impact precedes next step, and exact names are always shown.
 */

import { BRAND_NAME } from "../brand";
import {
  ALL_SITES_ORIGIN,
  MANIFEST_PERMISSIONS,
  type ManifestPermission,
} from "../core/grants";
import {
  MAX_DOC_BYTES,
  MAX_ENABLED_RULES,
  MAX_REGEX_RULES,
  MAX_SESSION_OVERRIDES,
} from "../core/limits";
import type { BadgeColor, ResourceGroup } from "../core/model";

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
const managedHeader =
  "Chrome's network stack manages this header itself; a rule here usually has no effect.";

/**
 * Why each declared permission is there, keyed by the ids the manifest is built
 * from, so a permission cannot reach the manifest without a reason to show
 * beside it. The title is the row's heading, in the words the product uses
 * elsewhere; the manifest id sits under it as the mapping. One lead sentence
 * answers what the permission is for; the details under it are one fact each, so
 * a reader looking for where a header value ends up finds that line instead of a
 * paragraph. Plain words here; the storage-area and API literals stay in
 * PRIVACY.md, which maps the two vocabularies. Every string below is also a
 * sentence of PRIVACY.md, and copy.test.ts holds the two together.
 */
interface PermissionReason {
  readonly title: string;
  readonly reason: string;
  readonly details: readonly string[];
}

const PERMISSION_REASONS: Record<ManifestPermission, PermissionReason> = {
  declarativeNetRequestWithHostAccess: {
    title: "Changing headers",
    reason: `${BRAND_NAME} applies your header rules through Chrome's rules engine, which runs a rule only where Chrome's own host access covers the request. The engine does not hand ${BRAND_NAME} request or response content.`,
    details: [
      "A request rule sends the value you typed to every site it matches and you have granted, so where that value goes is limited by the rule's scope and by the sites you have granted. A response rule changes what this browser sees.",
      "While header changes are running, each rule you turn on in the active profile that Chrome accepts is handed to the rules engine as a dynamic rule, with the header value in the clear; a rule in a profile that is not active is not. Chrome keeps that dynamic ruleset on disk, across browser sessions and across extension updates, so it holds a second copy of each of those values, alongside the one in local storage.",
      "Turning the rule off, deleting it, switching to another profile, or pausing every header change takes it back out of the dynamic ruleset.",
      "A this-tab change goes to the session ruleset instead, which Chrome clears when the browser shuts down.",
    ],
  },
  storage: {
    title: "Storing your rules",
    reason: `${BRAND_NAME} keeps your rules, profiles, and settings in Chrome's local extension storage, in this browser on this device.`,
    details: [
      "Header values are stored on this device without encryption, exactly as you typed them, and an exported configuration file contains them in the clear. Treat it like a credentials file.",
      "Chrome's synced storage is not used, so nothing is copied to your Google account.",
      "The theme you pick is also kept in the extension pages' own web storage, so a page paints in it before the stored settings load. No header value is kept there.",
      "Adding a this-tab change writes it to Chrome's session storage rather than to local storage, and it is not part of an export. The record is the tab it applies to, the number Chrome matches the change by, the hostname it belongs to, the direction, the operation, the header name, the value you typed, and whether it is on.",
      `${BRAND_NAME} removes it when you close the tab or when the tab navigates away from that host, and Chrome clears session storage when the browser shuts down.`,
      `If ${BRAND_NAME} cannot read the saved configuration, it sets that configuration aside under a separate key in the same local storage and starts over with an empty one, so a configuration it cannot parse is not discarded without a trace. The copy holds whatever that configuration held, header values included. Nothing in this version deletes that copy on its own; a later configuration set aside the same way replaces it, and removing the extension deletes it along with the rest of the stored data.`,
    ],
  },
  activeTab: {
    title: "Reading the current tab",
    reason:
      "Opening the popup on a site reads that tab's address and reduces it to a hostname, to show what applies there and prefill a new rule's scope.",
    details: [
      "Full addresses are not stored.",
      `Chrome reports that tab's address as it navigates, for as long as the tab stays on that site, and ${BRAND_NAME} uses that to end a this-tab change when the tab leaves the site it was made for.`,
      `Opening the popup is a gesture Chrome answers with temporary host access to that tab, which lasts while the tab stays on that site. That access is Chrome's to give and take back; the access a rule needs is the site grant you approve, and ${BRAND_NAME} asks for that separately.`,
    ],
  },
};

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
    // The same fact while everything is paused. The count is the honest summary
    // of an unusual state, so pause changes its verb rather than removing it.
    heldStatus: (count: number): Sentence => [
      data(count),
      ` ${changes(count)} held on this tab`,
    ],
    newChange: "New change on this tab",
    // Substatus segments, shown only when a count is nonzero.
    needsAccess: (count: number) => `${count} needs access`,
    refused: (count: number) =>
      count === 1 ? "1 refused by Chrome" : `${count} refused by Chrome`,
    managed: (count: number) =>
      count === 1 ? "1 managed by Chrome" : `${count} managed by Chrome`,
    overridden: (count: number) =>
      count === 1
        ? "1 overridden by another rule"
        : `${count} overridden by another rule`,
    liveLabel: "Running",
    attentionLabel: "Needs attention",
    direction: { request: "Request", response: "Response" },
    verb: { set: "Set", append: "Append", remove: "Remove" },
    // While everything is paused a line states what it would do, not what it
    // does. Pause has to change the sentence, not only the colour it is set in.
    heldVerb: {
      set: "Would set",
      append: "Would append",
      remove: "Would remove",
    },
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
    managedReason: managedHeader,
    // A rule whose match Chrome settles per request, against a URL this popup
    // never sees. Saying "live" here would draw a fact it cannot know.
    unconfirmedReason: "Only Chrome can tell whether this matches here",
    // The ruleset Chrome is running is not the one on screen, so no line can
    // claim to be live until the two agree again.
    outOfSyncReason: "Chrome hasn't taken this rule yet",
    unconfirmed: (count: number) => `${count} confirmable only by Chrome`,
    outOfSync: (count: number) => `${count} not applied yet`,
    details: "Details",
    grant: "Grant",
    // A rule Chrome can only run with broad access says so on the button, so the
    // click is honest before Chrome's own all-sites dialog appears.
    grantAllSites: "Grant all sites",
    ruleToggle: (header: string, on: boolean, reach?: string) =>
      `${on ? "Turn off" : "Turn on"}: ${header}${reach === undefined ? "" : `; ${reach}`}`,
    // The switch on a popup line is the rule's switch, not this tab's, so a rule
    // that reaches past this tab says how far before anyone flips it.
    widerReach: {
      sites: (count: number) => `also on ${count} other ${sites(count)}`,
      broad: "also on every other site it matches",
    },
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
      `${BRAND_NAME} isn't changing anything on `,
      data(host),
      ".",
    ],
    // The tab has no site to read: a Chrome page, a new tab, a local file, or
    // another extension. Say why the screen is empty rather than asking for
    // something the reader has already done.
    noHost: `${BRAND_NAME} changes headers on websites, and this tab is not on one.`,
    seeAllRules: "See all rules",
    // The standing data note: one sentence, because it stands under every
    // readout and every editor, and a disclosure that costs four lines of a
    // 600px popup is a disclosure people learn to look past. It carries the two
    // facts that matter while a credential is in the clipboard: where the value
    // comes to rest, and that turning the rule on is what sends it out. Both
    // hold wherever a value can be read or typed, including a chrome:// page
    // with no site to read. Reach is stated as the scope alone, without the
    // grant that narrows it, so the short form overstates exposure rather than
    // understating it; the exact statement, scope and grant together, is the
    // About page, also in the product.
    dataNote:
      "The values you type are stored on this device without encryption, and a request rule sends them to every site it matches.",
    thisTabTag: "This tab only",
    thisTabClears: "clears when you close the tab",
    removeOverride: (header: string) => `Remove this-tab change: ${header}`,
    overrideToggle: (header: string, on: boolean) =>
      `${on ? "Turn off" : "Turn on"} this-tab change: ${header}`,
    switcher: {
      chipLabel: "Switch profile",
      title: "Switch profile",
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
    warnNote: "replace it before it lapses",
    valueLabel: (header: string) => header,
    // The verb the field it opens commits with, and the verb the expiry note
    // asks for. It shares the row with a live credential, so it is one word.
    swap: "Replace",
    swapOn: (host: string): Sentence => ["on ", data(host)],
    // Pause has to reach the hero in words, the way it reaches every line: a
    // dimmed card beside a live-looking button says nothing on its own.
    held: "held while header changes are paused",
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
      // Direction is what two otherwise identical rows differ by, so the name
      // that reaches assistive technology carries it too.
      editRule: (direction: string, header: string) =>
        `Edit rule: ${direction} ${header}`,
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
        unconfirmed: "confirmable only by Chrome",
        needsAccess: "needs access",
        refused: "refused by Chrome",
        managed: "managed by Chrome",
        outOfSync: "not applied yet",
        paused: "paused",
      },
      crossSiteHost: "cross-site",
      // The page lists what the ruleset holds, which includes rules a grant
      // away from running, so an empty page means no rule is on, not that
      // nothing is running.
      empty: "No changes configured yet. Turn a rule on to see it here.",
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
      } satisfies Record<BadgeColor, string>,
    },
    rules: {
      loadingEditor: "Loading rule editor…",
    },
    importExport: {
      title: "Import & export",
      importHeading: "Import",
      instruction: `${BRAND_NAME} JSON or ModHeader export, detected automatically.`,
      choose: "Choose file…",
      fileInputLabel: `Import a ${BRAND_NAME} or ModHeader export`,
      exportHeading: "Export",
      exportEverything: "Export everything",
      exportOne: "Export one profile",
      exportChoiceLabel: "Profile to export",
      // A standing hint between the Export heading and the export buttons, read
      // before a download rather than raised by one.
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
        droppedExcludeUrl: `Dropped. ${BRAND_NAME} has no per-rule URL exclusion in this version.`,
        droppedInitiatorDomain: `Dropped. ${BRAND_NAME} has no initiator scoping in this version.`,
        droppedTab: "Dropped. Use This-tab overrides for per-tab needs.",
        droppedUrlReplacement: `Dropped. ${BRAND_NAME} changes headers only.`,
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
        consequence: `This gives ${BRAND_NAME} access to every website instead of asking one site at a time.`,
        disclosure: "Review all-sites access",
        // Chrome shows this exact warning before it can grant broad access.
        warning:
          'Chrome will warn: "Read and change all your data on all websites". Your rules still only apply where their scopes say, and you can revoke this access here at any time.',
        sensitive: (count: number) =>
          count === 1
            ? "1 enabled rule attaches a credential or changes a security header and needs all-sites access to run. Allowing all sites lets it run wherever it matches."
            : `${count} enabled rules attach a credential or change a security header and need all-sites access to run. Allowing all sites lets them run wherever they match.`,
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
        `${BRAND_NAME} v`,
        data(version),
        " · commit ",
        data(commit),
      ],
      description: `${BRAND_NAME} modifies HTTP request and response headers using scoped rules, profiles, and tab-specific overrides.`,
      license:
        "Open source under the MIT license. Provided as is, without warranty.",
      // The three permissions the manifest declares, in the order it declares
      // them, then the optional site access it asks for at runtime.
      permissions: {
        heading: "Permissions",
        items: [
          ...MANIFEST_PERMISSIONS.map((name) => ({
            name,
            ...PERMISSION_REASONS[name],
          })),
          {
            name: ALL_SITES_ORIGIN,
            title: "Site access",
            reason: `${BRAND_NAME} asks Chrome for the sites a rule's scope needs, and the grants you approve are the host access it asks for.`,
            details: [
              "A rule scoped to named domains asks for those domains. A rule scoped to all sites asks for all sites, whether the request comes from that rule's own Grant button or from the Site access page, and it is a request you can decline.",
              "The Site access page lists every grant and revokes any of them.",
              `While a site is granted, Chrome reports the address of every tab that navigates there, not only the tab the popup was opened on. ${BRAND_NAME} reduces each one to a hostname. Full addresses are not stored.`,
            ],
          },
        ],
      },
      links: {
        repository: "Repository",
        repositoryUrl: "https://github.com/arun279/headershim",
        privacy: "Privacy",
        privacyUrl:
          "https://github.com/arun279/headershim/blob/main/PRIVACY.md",
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
    // What a commit is about to ask Chrome for, when it is more than one site.
    // Naming the first of several understates the reach the click discloses.
    allowSites: (count: number) => `${count} ${sites(count)}`,
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
    // Withheld, not elided: the ellipsis is the truncation primitive's mark for
    // a value that was cut, so a value being held back cannot borrow it.
    redacted: "[hidden]",
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
    } satisfies Record<ResourceGroup, string>,
    only: (group: string) => `${group} only`,
    count: (n: number) => `${n} types`,
  },

  editor: {
    heading: (mode: "new" | "edit", profile: string) =>
      `${mode === "new" ? "New rule" : "Edit rule"} · ${profile}`,
    close: "Close editor",
    delete: "Delete rule",
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
    // A header name has one shape whatever the rule, so an example teaches it.
    // A value does not: the field takes whatever this header carries, and an
    // example of one header's value is wrong on every other header.
    placeholders: {
      headerName: "authorization",
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
    // The escape hatch for a pattern/regex rule: bound the grant to named hosts
    // instead of all sites. A regex names no host Chrome can scope a permission
    // to, so an empty list is an honest all-sites request, said here before the
    // save button repeats it.
    grantHostsLabel: "Grant on hosts",
    grantHostInputLabel: "Add host",
    grantHostsAllSites: "Leave empty and this rule needs access to all sites.",
    grantHostsBounded: "This rule is granted only on the hosts listed here.",
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
    saveFailed: "Couldn't save this change. Try again.",
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
    ruleCap: `Chrome caps extensions at 5,000 header rules, and enabling this would pass ${BRAND_NAME}'s safe limit of ${MAX_ENABLED_RULES.toLocaleString("en-US")}. Disable or delete rules you're not using, or turn off a profile.`,
    ruleCounter: (enabled: number) =>
      `${enabled.toLocaleString("en-US")} of ${MAX_ENABLED_RULES.toLocaleString("en-US")} enabled rules.`,
    regexRuleCap: `Chrome separately caps regex-scoped rules at ${MAX_REGEX_RULES.toLocaleString("en-US")}, and enabling this would pass that limit. Disable or delete regex rules you're not using, or switch some scopes to URL patterns.`,
    storageBudget: `Chrome gives an extension limited local storage, and this change would pass ${BRAND_NAME}'s safe budget of ${MAX_DOC_BYTES / (1024 * 1024)} MB. Shorten long header values, or delete rules you're not using.`,
    sessionCap: `Chrome caps temporary tab rules, and this would pass ${BRAND_NAME}'s limit of ${MAX_SESSION_OVERRIDES.toLocaleString("en-US")}. Remove a temporary override you're done with, or save this one as a rule instead.`,
    importParse:
      "This file isn't valid JSON, so nothing was imported and nothing was changed. If it came from ModHeader, export it again with Profile → Export → JSON.",
    importNewer: (fileVersion: number, supportedVersion: number) =>
      `This file was exported by a newer ${BRAND_NAME} (format ${fileVersion}; this version reads up to ${supportedVersion}). Update ${BRAND_NAME}, then import again. Nothing was changed.`,
    importUnrecognized: `This file is valid JSON but isn't a ${BRAND_NAME} or ModHeader export, so nothing was imported and nothing was changed. ${BRAND_NAME} reads its own exports and ModHeader profile exports only.`,
    importTooLarge: `This file is far larger than any export ${BRAND_NAME} can hold, so it wasn't read and nothing was changed. Check you picked the right file.`,
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
      `Your rules were saved by a newer ${BRAND_NAME} (format ${foundVersion}; this version reads up to ${supportedVersion}). Update ${BRAND_NAME} to pick them back up. Nothing has been changed.`,
  },

  advisories: {
    managedHeader,
    host: "Chrome can't change the authority on HTTP/2 connections, which most sites use. This rule usually has no effect.",
    // Fires on request and response rules alike, so it names where the value is
    // written rather than a send: a response rule sends the site nothing.
    credential:
      "This header carries a credential. This rule writes it on everything its scope reaches, so keep the scope as narrow as the job needs.",
    securityResponse:
      "Sites send this header to protect the pages they serve. Changing it turns that protection off wherever this rule reaches, for as long as it's on.",
  },
} as const;

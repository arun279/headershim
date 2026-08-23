/** Options-only user-facing copy, loaded only by the options surface. */

import { BRAND_NAME } from "../brand";
import {
  ALL_SITES_ORIGIN,
  isAllSitesOrigin,
  MANIFEST_PERMISSIONS,
  type ManifestPermission,
} from "../core/grants";
import type { BadgeColor } from "../core/model";
import {
  andList,
  changes,
  data,
  type Sentence,
  copy as sharedCopy,
  sites,
} from "./copy";

const rules = (n: number) => (n === 1 ? "rule" : "rules");
const covers = (n: number) => (n === 1 ? "covers" : "cover");

const bareOrigin = (origin: string) => origin.replace(/\/\*$/, "");

const coverageName = (origin: string) =>
  isAllSitesOrigin(origin) ? "all-sites access" : bareOrigin(origin);

// Revoking one host leaves every broader grant in place, and a line that
// stopped at the host would read as access removed when it is not. The grants
// that outlast the click are named here in the words the row uses for them.
const stillCovered = (covering: readonly string[]) =>
  covering.length === 0
    ? ""
    : `; ${andList(covering.map(coverageName))} still ${covers(covering.length)} it`;

export const siteAccessCopy = {
  empty: "No individual sites to show.",
  title: "Site access",
  neededHeading: "Needed but not granted",
  partialHeading: "Limited access",
  grantedHeading: "Granted",
  guidance:
    "Add rules in the popup or rule editor, and this-tab changes in the popup. Chrome's own controls can limit or remove access. Granting a site happens here or from a rule's Grant button.",
  usageLead: (coverage: "full" | "partial" | "none") =>
    coverage === "none" ? "Needed by" : "Used by",
  partial: (origins: readonly string[]): Sentence => [
    "Covers only ",
    data(andList(origins.map(bareOrigin))),
  ],
  ruleCount: (count: number) => `${count} ${rules(count)}`,
  tabCount: (count: number) => `${count} tab ${changes(count)}`,
  unused: "Not used by an active rule or tab change",
  grant: "Grant",
  grantLabel: (domain: string) => `Grant access to ${domain}`,
  broaden: "Broaden",
  broadenLabel: (domain: string) => `Broaden access to ${domain}`,
  broadened: (domain: string) => `Access to ${domain} broadened`,
  notBroadened: (domain: string) => `Access to ${domain} was not broadened`,
  grantOriginsLabel: (origins: readonly string[]) =>
    `Grant access to ${andList(origins)}`,
  revoke: "Revoke",
  revokeLabel: (domain: string) => `Remove grant for ${domain}`,
  revoked: (domain: string, covering: readonly string[]) =>
    `Access to ${domain} revoked${stillCovered(covering)}`,
  noDirectGrant: (domain: string, covering: readonly string[]) =>
    `No direct grant for ${domain}${stillCovered(covering)}`,
  notGranted: (domain: string) => `Access to ${domain} was not granted`,
  revokeFailed: (domain: string) =>
    `Site grant for ${domain} could not be removed`,
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
    button: sharedCopy.readout.grantAllSites,
    on: "All-sites access is on",
    revoke: "Revoke all-sites access",
    revoked: "All-sites access is off",
    notGranted: "All-sites access was not granted",
    revokeFailed: "All-sites access could not be revoked",
  },
};

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
      "While header changes are running, each rule you turn on in the active profile that Chrome accepts, and whose sites you have granted, is handed to the rules engine as a dynamic rule, with the header value in the clear. A rule in a profile that is not active is not, and neither is one still waiting on a site grant. Chrome keeps that dynamic ruleset on disk, across browser sessions and across extension updates, so it holds a second copy of each of those values, alongside the one in local storage.",
      "Turning the rule off, deleting it, switching to another profile, revoking a site the rule needs, or pausing every header change takes it back out of the dynamic ruleset.",
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
      "Adding a this-tab change writes it to Chrome's session storage rather than to local storage, and it is not part of an export. The record is the tab it applies to, the number Chrome matches the change by, the origin it belongs to (scheme, host, and port), the direction, the operation, the header name, the value you typed, and whether it is on.",
      `${BRAND_NAME} removes it when you close the tab or when the tab navigates away from that origin, and Chrome clears session storage when the browser shuts down.`,
      `If ${BRAND_NAME} cannot read the saved configuration, it sets that configuration aside under a separate key in the same local storage and starts over with an empty one, so a configuration it cannot parse is not discarded without a trace. The copy holds whatever that configuration held, header values included. Nothing in this version deletes that copy on its own; a later configuration set aside the same way replaces it, and removing the extension deletes it along with the rest of the stored data. Start over in Settings removes that set-aside copy as well.`,
    ],
  },
  activeTab: {
    title: "Reading the current tab",
    reason:
      "Opening the popup on a site reads that tab's address and reduces it to an origin (scheme, host, and port), to show what applies there and prefill a new rule's scope.",
    details: [
      "Full addresses are not stored.",
      `Chrome reports that tab's address as it navigates, for as long as the tab stays on that site, and ${BRAND_NAME} uses that to end a this-tab change when the tab leaves the site it was made for.`,
      `Opening the popup is a gesture Chrome answers with temporary host access to that tab, which lasts while the tab stays on that site. That access is Chrome's to give and take back; the access a rule needs is the site grant you approve, and ${BRAND_NAME} asks for that separately.`,
    ],
  },
};

// The full-tab options surface: frame, profile management, and bulk actions.
export const copy = {
  options: {
    nav: {
      label: "Sections",
      groupRules: "Rules",
      groupManage: "Manage",
      allRules: "All rules",
      profiles: "Profiles",
      importExport: "Import & export",
      siteAccess: "Site access",
      traffic: "Active changes",
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
      },
      // Direction is what two otherwise identical rows differ by, so the name
      // that reaches assistive technology carries it too.
      editRule: (direction: string, header: string) =>
        `Edit rule: ${direction} ${header}`,
      empty: "No rules yet.",
    },

    // Every switched-on change in the active profile, and where each one stands.
    // It reads the stored rules, never the wire, so no line here may speak of a
    // request: none has been observed, and one may never be made. Off rules are
    // not active and never appear, which is why the page is named for what it
    // shows and not for the whole configured set, which All rules already holds.
    traffic: {
      title: "Active changes",
      status: {
        live: "live",
        unconfirmed: "decided per request",
        needsAccess: "needs access",
        refused: "refused by Chrome",
        overLimit: "rule limit reached",
        overridden: "overridden",
        outOfSync: "not applied yet",
        paused: "paused",
      },
      // A second, independent word beside the status, never in its place: the
      // header's transport caveat in the same lowercase register. The full
      // sentences live in `advisories`; te gets its own word because "breaks
      // on HTTP/2" is false for the one value HTTP/2 allows it.
      caveat: {
        h1Only: "HTTP/1.1 only",
        h2Breaking: "breaks on HTTP/2",
        te: "trailers only on HTTP/2",
        contentLength: "mismatch breaks HTTP/2",
      },
      crossSiteHost: "cross-site",
      // Empty means the active profile has nothing switched on: either its rules
      // are all off or it holds none. Both read the same here, and neither is a
      // cue to turn on a rule that may not exist, so the line only states the
      // fact.
      empty: "No changes are switched on.",
    },
    profiles: {
      title: "Profiles",
      newProfile: "New profile",
      ruleCount: (count: number) => `${count} ${rules(count)}`,
      rename: "Rename",
      clone: "Clone",
      delete: "Delete",
      activeLabel: (name: string) => `Active profile: ${name}`,
      reorderHandle: (name: string) =>
        `Reorder ${name}; press the arrow keys to move it`,
      reordered: (name: string, position: number) =>
        `${name}, moved to position ${position}`,
      deleteConfirm: {
        title: (name: string) => `Delete profile '${name}'?`,
        body: (count: number) =>
          `${count === 0 ? "" : `Its ${count} ${rules(count)} will be deleted. `}Site grants are not changed.`,
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
      // The file carries profiles and rules, not the site access, theme, pause,
      // or active-profile state that stay with this browser, so the label names
      // what it can carry rather than claiming everything.
      exportAll: "Export all profiles",
      exportOne: "Export one profile",
      exportChoiceLabel: "Profile to export",
      // A standing hint between the Export heading and the export buttons, read
      // before a download rather than raised by one. It names what the file
      // holds and what it does not: site access is a browser permission state a
      // file cannot carry back, since each origin needs its own grant gesture.
      secretsReminder:
        "This file holds your profiles and rules. Treat it like a credentials file. Site access stays in this browser, not the file.",
      exportFilename: "headershim-export.json",
      profileFilename: (slug: string) => `headershim-${slug}.json`,
      // A file this build could have written, holding one rule it cannot read:
      // the envelope is recognized before any rule is validated, so the message
      // places the fault instead of denying the format. The field is the first
      // one the validator can name, and a rule that is not even a record has
      // its shape named instead.
      invalidRule: (
        profileName: string,
        ruleNumber: number,
        field = "its shape",
      ) =>
        `This is a ${BRAND_NAME} export, but rule ${ruleNumber} in profile ${profileName} is not valid (${field}). Fix or remove it and import again; nothing was changed.`,
      // The fallback for a file whose format was recognized and whose fault has
      // no rule to point at. Naming it a file of an unknown format would be
      // false: the reader picked an export this build reads, and the part that
      // failed is inside it.
      invalidExport: `${BRAND_NAME} recognizes the format of this file but not its contents, so nothing was imported and nothing was changed. Export it again from the app that wrote it.`,
      summaryHeading: "Import summary",
      addsLead: "Adds these profiles and keeps the ones you have:",
      needAttention: (count: number) =>
        count === 1
          ? "1 item needs attention:"
          : `${count} items need attention:`,
      import: "Import",
      convert: "Convert to frozen value",
      imported: (count: number) =>
        count === 1
          ? "Imported 1 profile. It is not active; switch to it from the popup."
          : `Imported ${count} profiles. None is active; switch to one from the popup.`,
      exported: (filename: string) => `Exported ${filename}`,
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
        invalidValue:
          "Not imported. Header values can't contain line breaks or NUL characters.",
        dynamicToken:
          "Contains a request-time token Chrome extensions can no longer compute.",
        droppedExcludeUrl: `Dropped. ${BRAND_NAME} has no per-rule URL exclusion in this version.`,
        droppedInitiatorDomain: `Dropped. ${BRAND_NAME} has no initiator scoping in this version.`,
        droppedTab: "Dropped. Use This-tab overrides for per-tab needs.",
        droppedUrlReplacement: `Dropped. ${BRAND_NAME} changes headers only.`,
      },
    },
    settings: {
      title: "Settings",
      theme: {
        label: "Theme",
        options: { system: "System", light: "Light", dark: "Dark" },
      },
      shortcuts: "Keyboard shortcuts",
      shortcutsManage: "Change",
      shortcutUnset: "Not set",
      // What each command does, in display order. Chrome returns no label for
      // the reserved action command, so these live here and pair with the live
      // key the browser reports for each.
      commands: [
        { name: "_execute_action", label: "Open the popup" },
        { name: "toggle-pause", label: "Toggle global pause" },
        { name: "previous-profile", label: "Switch to the previous profile" },
      ],
      eraseAll: {
        action: "Start over",
        confirmTitle: "Start over?",
        confirmBody:
          "This replaces your configuration with a new empty Default profile and default settings, revokes all site access, clears any This-tab overrides, and removes any configuration that was set aside as unreadable. Undo restores only the configuration, not site access, This-tab overrides, or the set-aside copy.",
        done: "Configuration replaced",
      },
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
              `While a site is granted, Chrome reports the address of every tab that navigates there, not only the tab the popup was opened on. ${BRAND_NAME} reduces each one to an origin. Full addresses are not stored.`,
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
} as const;

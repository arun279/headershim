/**
 * User-facing copy shared by the popup and options surfaces; options-only copy
 * lives in copy.options.ts and editor-only copy in copy.editor.ts. Components
 * read their strings from these modules rather than inlining them, so wording
 * stays consistent and reviewable. Strings follow a consistent voice: the
 * platform is named as the actor, cause precedes impact precedes next step, and
 * exact names are always shown.
 */

import { BRAND_NAME } from "../brand";
import {
  MAX_DOC_BYTES,
  MAX_ENABLED_RULES,
  MAX_REGEX_RULES,
  MAX_SESSION_OVERRIDES,
} from "../core/limits";
import { DEFAULT_PROFILE_NAME } from "../core/model";

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

export const data = (value: string | number): SentencePart => ({
  data: String(value),
});

export const changes = (n: number) => (n === 1 ? "change" : "changes");
export const sites = (n: number) => (n === 1 ? "site" : "sites");

// Every site a grant will ask Chrome for, named, so the button that fires the
// request states the same reach Chrome's own dialog will list.
export const andList = (items: readonly string[]) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.slice(-1).join("")}`;

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
  },

  // The popup readout: the tab-scoped answer and the one exception grammar.
  // Live changes carry no words; only exceptions speak, each in one language.
  readout: {
    status: (count: number, listed: number, held: boolean): Sentence => [
      data(count),
      ...(count === listed ? [] : [" of ", data(listed)]),
      ` ${changes(listed)} ${held ? "held " : count === listed ? "" : "running "}on this tab`,
    ],
    newChange: "New change on this tab",
    // Substatus segments, shown only when a count is nonzero.
    needsAccess: (count: number) =>
      count === 1 ? "1 more needs access" : `${count} more need access`,
    refused: (count: number) =>
      count === 1 ? "1 more needs attention" : `${count} more need attention`,
    // Counts the transport-caveat changes the headline leaves out. The line
    // names the caveat that set them apart, not the working half every member
    // shares; what each one does on HTTP/2 differs per header, and each
    // listed change carries its own full sentence. Transport-family members
    // depend on the connection; te and content-length depend on the value
    // they carry.
    transport: (count: number) =>
      count === 1
        ? "1 more depends on the connection or its value"
        : `${count} more depend on the connection or their value`,
    security: (count: number) =>
      `Includes ${count} security-sensitive ${changes(count)}`,
    overridden: (count: number) =>
      count === 1
        ? "1 more is overridden by another rule"
        : `${count} more are overridden by another rule`,
    globalNeedsAccess:
      "Some enabled rules are not running on sites without access.",
    direction: { request: "Request", response: "Response" },
    verb: { set: "Set", append: "Append", remove: "Remove" },
    // A change that pause or missing access prevents states what it would do,
    // not what it does. The shared verb selector applies this on every surface.
    heldVerb: {
      set: "Would set",
      append: "Would append",
      remove: "Would remove",
    },
    to: "→",
    overriddenBy: (winner: string) => `overridden by ${winner}`,
    refusedReason: {
      header: "Chrome won't accept this header name",
      append:
        "Chrome accepts this header name, but only allows appending to a fixed set of request headers. Use Set instead.",
      value: "Chrome won't send a value with a line break or a NUL character",
      pattern: "Chrome won't accept this URL pattern",
      regex: "Chrome won't accept this regular expression",
      domains: "Chrome won't accept this rule's sites",
    },
    // A rule whose match Chrome settles per request, against a URL this popup
    // never sees. Saying "live" here would draw a fact it cannot know.
    unconfirmedReason: "Whether this runs is decided per request",
    unconfirmed: (count: number) =>
      count === 1
        ? "Includes 1 decided per request"
        : `Includes ${count} decided per request`,
    outOfSync: "Header changes are not applied yet",
    grant: "Grant",
    // A rule Chrome can only run with broad access says so on the button, so the
    // click is honest before Chrome's own all-sites dialog appears.
    grantAllSites: "Allow on all sites",
    // The switch on a popup line is the rule's switch, not this tab's, so a rule
    // that reaches past this tab says how far before anyone flips it.
    widerReach: {
      sites: (count: number) => `also on ${count} other ${sites(count)}`,
      broad: "also on every other site it matches",
    },
    editValue: (header: string) => `Edit ${header} value`,
    // The footer's two openers are actions, not passive scopes: addChange opens
    // the saved-rule editor, justThisTab the this-tab composer. addThisTab is
    // that composer's commit, left bare when access is already held so it
    // neither repeats the "THIS TAB ONLY" scope its heading already states,
    // nor collides with the opener.
    addChange: "Add a change",
    justThisTab: "Add for this tab",
    addThisTab: "Add",
    addThisTabAndAllow: (host: string) => `Add and allow ${host}`,
    pauseSwitch: "All header changes",
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
    // The head's site slot, on a tab that has no site to name (a Chrome page, a
    // new tab, a local file). Marks the slot as deliberately empty rather than a
    // dropped element.
    noSite: "No site",
    seeAllRules: "See all rules",
    thisTabTag: "This tab only",
    thisTabClears: "clears when you close the tab",
    needsAccessReason: (temporary: boolean) =>
      temporary
        ? "Not running. Grant access to run it on this tab."
        : "Not running. Grant access to run it here.",
    partiallyRunning: "Running where access is granted.",
    removeOverride: (header: string) => `Remove this-tab change: ${header}`,
    overrideToggle: (header: string, on: boolean) =>
      `This-tab change ${on ? "on" : "off"}: ${header}`,
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
    // The masked value as one honest leaf: the scheme, that the middle is
    // withheld, and the tail shown in the clear. A screen reader hears a mask
    // rather than the two cleartext fragments read back as a whole credential.
    maskedValue: (scheme: string | undefined, last4: string | undefined) =>
      `${scheme === undefined ? "" : `${scheme} `}credential, hidden${last4 === undefined ? "" : `, ending in ${last4}`}`,
    // The button that opens the swap field. It names its object, so a hover
    // name or a screen reader gets more than a bare verb on the one control that
    // can overwrite a live credential.
    swap: "Replace token",
    // Pause has to reach the hero in words, the way it reaches every line: a
    // dimmed card beside a live-looking button says nothing on its own.
    held: "held while header changes are paused",
    pasteLabel: "Paste the new token",
    // Where the new bytes land, said before commit. Only saved rules enter the
    // token hero; temporary changes keep their lifetime controls in the strip.
    pasteReplaces: "replaces the token on the saved rule",
    pasteAria: "New token value",
    replace: "Replace",
    cancel: "Cancel",
  },
  actions: {
    // activeTab reload handed to the user after a grant lands; there is no
    // automatic reload (locus of control).
    reloadTab: "Reload tab",
    cancel: "Cancel",
    undo: "Undo",
    options: "Options",
  },

  toast: {
    ruleCreated: "Rule created",
    changesSaved: "Changes saved",
    ruleDeleted: "Rule deleted",
    profileDeleted: (name: string) => `Profile '${name}' deleted`,
    // Deleting the last profile leaves one behind: a fresh empty Default takes
    // its place, so the toast says so rather than reading as a no-op.
    lastProfileDeleted: (name: string) =>
      `Profile '${name}' deleted; a new empty ${DEFAULT_PROFILE_NAME} replaces it`,
    // Confirms a grant landed, and says only that: a grant means the host is
    // permitted, while whether a rule runs there turns on pause, the active
    // profile, and Chrome taking the rule. The popup pairs it with a Reload-tab
    // action, since a granted tab keeps its pre-grant response; the options
    // surfaces raise it on its own.
    accessGranted: "Access granted",
    // "· Undo" is the toast's action button, not part of the message.
  },

  rules: {
    switchLabel: (header: string, on: boolean) =>
      `Rule ${on ? "on" : "off"}: ${header}`,
    // Withheld, not elided: the ellipsis is the truncation primitive's mark for
    // a value that was cut, so a value being held back cannot borrow it.
    redacted: "[hidden]",
    emptyValue: "(empty)",
    generated: (kind: string) => `${kind} · generated`,
    generatedKind: { uuid: "UUID", timestamp: "Timestamp" },
    editValueHint: "Enter saves · Esc cancels",
  },

  // The popup borrows these leaves from options-only concerns.
  profiles: {
    // The name a fresh profile is created under before the user renames it;
    // availableProfileName resolves collisions ("New profile 2", …).
    newName: "New profile",
    nameLabel: "Profile name",
    renameHint: "Press Enter to save, Esc to cancel",
    nameTaken: (name: string) => `'${name}' is taken. Use a different name.`,
  },

  allRules: {
    notActiveProfile: (name: string) => `in ${name}, not the active profile`,
  },

  siteAccess: {
    // The standing note: shown while any enabled rule reaches
    // subresources without naming the pages that start those requests.
    initiatorNote:
      "Requests started by other pages also need those pages granted.",
  },

  headerFields: {
    direction: "Direction",
    operation: "Operation",
    headerName: "Header name",
    value: "Value",
    headerNamePlaceholder: { request: "authorization", response: "set-cookie" },
    pastedLineSplit: "Pasted header split into name and value.",
    caution: "Caution",
  },

  errors: {
    pageLoad:
      "This page could not be loaded. Reload the extension to try again.",
    grantDeclined: (host: string) =>
      `Saved, but not running. You declined access to ${host}, so this rule can't change anything there. Grant access when you're ready.`,
    ruleCounter: (enabled: number) =>
      `${enabled.toLocaleString("en-US")} of ${MAX_ENABLED_RULES.toLocaleString("en-US")} enabled rules.`,
    importParse:
      "This file isn't valid JSON, so nothing was imported and nothing was changed. If it came from ModHeader, export it again with Profile → Export → JSON.",
    importNewer: (fileVersion: number, supportedVersion: number) =>
      `This file was exported by a newer ${BRAND_NAME} (format ${fileVersion}; this version reads up to ${supportedVersion}). Update ${BRAND_NAME}, then import again. Nothing was changed.`,
    importUnrecognized: `This file is valid JSON but isn't a ${BRAND_NAME} or ModHeader export, so nothing was imported and nothing was changed. ${BRAND_NAME} reads its own exports and ModHeader profile exports only.`,
    importTooLarge: `This file is far larger than any export ${BRAND_NAME} can hold, so it wasn't read and nothing was changed. Check you picked the right file.`,
    importUnreadable:
      "This file couldn't be read, so nothing was imported and nothing was changed. If it moved or changed since you picked it, pick it again.",
    eraseFailed:
      "Couldn't finish erasing. Check Site access and This tab, then try again.",
    saveFailed: "Couldn't save this change. Try again.",
    unavailable:
      "Couldn't load saved state. Reload the extension from chrome://extensions and try again.",
    regexInvalid:
      "This pattern isn't valid RE2, the regex dialect Chrome's rule engine uses. RE2 has no lookahead or backreferences. Fix the pattern, or switch this scope to a URL pattern.",
    regexOversize:
      "This pattern compiles to more than Chrome's 2 KB limit for a single rule. Shorten or split it.",
    patternInvalid:
      "Chrome's rule engine can't use this URL pattern. A pattern can't contain non-ASCII characters (write an internationalized domain in its punycode form) and can't start with '||*'. Fix the pattern, or switch this scope to a regex.",
    // A this-tab change has no life beyond the grant, so a decline leaves
    // nothing to save: the draft stays here rather than becoming a dead row.
    thisTabDeclined: (host: string) =>
      `Not added. A this-tab change needs access to ${host}, and you declined. Add it again when you're ready to allow it.`,
    appendDisallowed: (name: string) =>
      `Chrome only allows appending to a fixed set of request headers, and ${name} isn't one of them. Use Set instead. It replaces any existing value.`,
    ruleCap: `Chrome caps extensions at 5,000 header rules, and enabling this would pass ${BRAND_NAME}'s safe limit of ${MAX_ENABLED_RULES.toLocaleString("en-US")}. Disable or delete rules you're not using, or turn off a profile.`,
    dynamicRuleCap:
      "This profile would expand past Chrome's 5,000-rule limit because rules that name several sites can require one installed rule per site. Use fewer sites or split the profile.",
    regexRuleCap: `Chrome separately caps regex-scoped rules at ${MAX_REGEX_RULES.toLocaleString("en-US")}, and enabling this would pass that limit. Disable or delete regex rules you're not using, or switch some scopes to URL patterns.`,
    storageBudget: `Chrome gives an extension limited local storage, and this change would pass ${BRAND_NAME}'s safe budget of ${MAX_DOC_BYTES / (1024 * 1024)} MB. Shorten long header values, or delete rules you're not using.`,
    sessionCap: `Chrome caps temporary tab rules, and this would pass ${BRAND_NAME}'s limit of ${MAX_SESSION_OVERRIDES.toLocaleString("en-US")}. Remove a temporary override you're done with, or save this one as a rule instead.`,
    headerNotModifiable:
      "Header names starting with ':' are HTTP/2 internals that Chrome doesn't let any extension touch. To change the host a server sees, the request would have to use HTTP/1.1. For most modern sites that isn't possible.",
    headerNameRequired: "Every rule needs a header name. Type one to save.",
    headerNameInvalid:
      "This isn't a legal header name. Letters, digits, and hyphens are the safe set.",
    valueRequired:
      "Set and append need a value. Type one, or switch the operation to Remove.",
    valueInvalid:
      "Header values can't contain line breaks or NUL characters. Remove them to save.",
    domainInvalid:
      "This isn't a hostname Chrome can match. Enter one like example.com, with no scheme, port, path, or wildcard.",
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
    // The transport caveats, one sentence per measured behavior (set rules,
    // request side, driven through HTTP/1.1 and HTTP/2 echo servers). Each
    // names the transport and states only what the wire showed.
    h1Only:
      "Takes effect on HTTP/1.1 only; HTTP/2 has no such header and drops the change.",
    h2Breaking:
      "Takes effect on HTTP/1.1; on HTTP/2 this header makes requests fail.",
    te: "HTTP/2 allows te only as trailers; any other value makes requests fail there. HTTP/1.1 sends it as written.",
    contentLength:
      "Sent as written on HTTP/1.1, even when it contradicts the body. On HTTP/2, requests fail when it does.",
    // Measured on the wire: a Host rule rewrites what HTTP/1.1 requests carry.
    // On HTTP/2 Chrome keeps the real authority, so the change has nothing to
    // act on there. The popup reason and the editor advisory read this one
    // key, so the two surfaces cannot state different truths about the same
    // header.
    host: "Rewrites the Host header on HTTP/1.1. On HTTP/2 Chrome keeps the real authority, so the change has nothing to act on there.",
    // Fires on request and response rules alike, so it names where the value is
    // written rather than a send: a response rule sends the site nothing.
    credential:
      "This header carries a credential. This rule writes it on everything its scope reaches, so keep the scope as narrow as the job needs.",
    securityResponse:
      "Changes a response header that can affect page security.",
    removesSecurityResponse: (header: string) =>
      `Removes the protection ${header} gives this page.`,
    changesSecurityResponse: (header: string) =>
      `Changes ${header}, which can affect page security.`,
    // A response header on the request side: Chrome sends it and the server
    // ignores it, so the rule does nothing. The header is right and the side is
    // wrong, so the line names the side rather than the header.
    responseOnRequest:
      "Sites send this header on their responses, so a Request rule has no effect. Set Direction to Response to change it.",
    // Fires while the pattern scope holds a pattern with no pipe anchor, the
    // shape Chrome matches as a substring of the whole URL. Silent otherwise:
    // the rule runs as written and a credential can ride a host it never names.
    unanchoredPattern: [
      "This URL pattern has no ",
      data("||"),
      " host anchor, so Chrome matches it anywhere in the URL, query string included, and it can reach a host the pattern does not name. Anchor it as ",
      data("||host/"),
      " to bind it to one host and its subdomains.",
    ] satisfies Sentence,
  },
} as const;

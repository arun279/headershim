/** Rule-editor user-facing copy, loaded only by editor chunks. */

import type { ResourceGroup } from "../core/model";
import { andList, data, type Sentence, copy as sharedCopy } from "./copy";

export const copy = {
  actions: {
    createRule: "Create rule",
    createRuleAndAllow: (host: string) => `Create rule and allow ${host}`,
    saveChanges: "Save changes",
    saveChangesAndAllow: (host: string) => `Save changes and allow ${host}`,
    // The sites a commit will ask Chrome for, named in full. The permission
    // prompt closes the popup, so this is the last disclosure the user reads.
    andSites: andList,
    regenerate: "Regenerate",
  },

  scopeSummary: {
    allSites: "all sites",
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
      headerName: sharedCopy.headerFields.headerName,
      value: sharedCopy.headerFields.value,
      profile: "Profile",
      scope: "Scope",
      comment: "Comment",
      resourceTypes: "Resource types",
    },
    // A header name has one shape, but the example that teaches it belongs to a
    // direction: a request header on the request side, a response header on the
    // response side, so the hint is never a header the chosen side can't carry.
    // A value has no such example: the field takes whatever this header carries,
    // and an example of one header's value is wrong on every other header.
    placeholders: {
      headerName: sharedCopy.headerFields.headerNamePlaceholder,
    },
    // A pasted `name: value` line lands split across the two fields rather than
    // failing the name's token grammar on the colon.
    pastedLineSplit: sharedCopy.headerFields.pastedLineSplit,
    savedAs: (name: string): Sentence => ["saved as ", data(name)],
    suggestions: (n: number) => (n === 1 ? "1 suggestion" : `${n} suggestions`),
    scopeType: {
      domains: "Domains",
      pattern: "URL pattern",
      regex: "Regex",
    },
    allSites: "All sites",
    allSitesHelper: "matches every website",
    domainsHelper:
      "matches this domain and its subdomains, on any scheme and port",
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
    grantHostsBounded:
      "This rule matches only the hosts listed here, and needs access to just them.",
    // Two lines, not one glued by a separator: at the popup's width the second
    // wraps under the first, so a middle dot between them orphans on its own. The
    // first names the recommended anchored form; the second states what Chrome
    // compiles a pattern with no anchor into, which is the reach that leaks.
    patternHint: [
      [
        data("||example.com^"),
        " matches the site, its subdomains, and every path.",
      ],
      [
        "Without ",
        data("||"),
        ", a pattern matches anywhere in the URL, including the query string.",
      ],
    ] satisfies readonly Sentence[],
    // Regex is the one scope that can bind to subdomains without the domain, so
    // the hint carries that idiom; the leading ^ also shows the anchoring a bare
    // regex lacks, the same reach the pattern hint warns about.
    regexHint: [
      "Chrome matches this as an RE2 regex. ",
      data("^https?://[^/]+\\.example\\.com/"),
      " matches subdomains only, not the domain itself.",
    ] satisfies Sentence,
    allTypes: "All types",
    generate: "Generate",
    generateUuid: "UUID",
    generateTimestamp: "Timestamp (ISO 8601)",
    newlineRemoved: "Line breaks removed. A header value is a single line.",
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

  // The note under the value field, always present so the field is never silent
  // about how the value is treated: a hand-typed value is used verbatim, and a
  // generated one is frozen at a moment and never recomputed. Neither is a
  // template that fills in per request.
  valueNote: {
    literal: "This value is used exactly as typed. It is not a template.",
    frozen: (at: string) =>
      `Frozen at ${at.slice(0, 10)} ${at.slice(11, 16)} UTC. This exact value is used every time, not regenerated.`,
  },
} as const;

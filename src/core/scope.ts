import type { ResourceGroup, Rule, Scope } from "./model";

export const DNR_RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "other",
] as const;

export type DnrResourceType = (typeof DNR_RESOURCE_TYPES)[number];

export const RESOURCE_TYPES_BY_GROUP = {
  pages: ["main_frame"],
  subframes: ["sub_frame"],
  xhr: ["xmlhttprequest"],
  scripts: ["script"],
  stylesheets: ["stylesheet"],
  images: ["image"],
  fonts: ["font"],
  media: ["media"],
  websockets: ["websocket"],
  other: ["object", "ping", "csp_report", "other"],
} as const satisfies Readonly<
  Record<ResourceGroup, readonly DnrResourceType[]>
>;

export interface ScopeCondition {
  readonly requestDomains?: string[];
  readonly urlFilter?: string;
  readonly regexFilter?: string;
}

export function expandResourceTypes(
  resourceTypes: Rule["resourceTypes"],
): DnrResourceType[] {
  return resourceTypes === "all"
    ? [...DNR_RESOURCE_TYPES]
    : [
        ...new Set(
          resourceTypes.flatMap((group) => RESOURCE_TYPES_BY_GROUP[group]),
        ),
      ];
}

export function scopeCondition(scope: Scope): ScopeCondition {
  switch (scope.type) {
    case "domains":
      return { requestDomains: [...scope.domains] };
    case "pattern":
      return { urlFilter: scope.pattern };
    case "regex":
      return { regexFilter: scope.regex };
    case "all":
      return {};
  }
}

export function originPatternForDomain(domain: string): string {
  return `*://*.${domain}/*`;
}

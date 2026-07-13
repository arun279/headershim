// The e2e harness drives a handful of extension APIs from inside
// service-worker `evaluate` callbacks. Only the surface those callbacks touch is
// declared here so the harness type-checks without pulling in the full
// `@types/chrome` global (the src/ boundary is enforced separately by the
// check:platform grep, not by the absence of these types).

interface ChromePermissionsQuery {
  origins?: string[];
  permissions?: string[];
}

interface ChromeMatchedRule {
  rule: { ruleId: number };
}

declare const chrome: {
  storage: {
    local: {
      set(items: Record<string, unknown>): Promise<void>;
      get(keys?: string | string[]): Promise<Record<string, unknown>>;
    };
  };
  declarativeNetRequest: {
    getDynamicRules(): Promise<unknown[]>;
    getMatchedRules(filter: {
      tabId: number;
    }): Promise<{ rulesMatchedInfo: ChromeMatchedRule[] }>;
    setExtensionActionOptions(options: {
      displayActionCountAsBadgeText: boolean;
    }): Promise<void>;
  };
  action: {
    getBadgeText(details: { tabId?: number }): Promise<string>;
  };
  tabs: {
    query(query: {
      active?: boolean;
      lastFocusedWindow?: boolean;
    }): Promise<{ id?: number }[]>;
  };
  permissions: {
    getAll(): Promise<{ origins: string[]; permissions: string[] }>;
    contains(query: ChromePermissionsQuery): Promise<boolean>;
    remove(query: ChromePermissionsQuery): Promise<boolean>;
  };
};

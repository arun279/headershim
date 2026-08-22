import type { Projection } from "../../core/applied";
import type { Direction, HeaderOp, Scope } from "../../core/model";
import { originPatternForDomain } from "../../core/scope";
import type { StoredEntry } from "../../core/verdict";
import { isSecretHeader, ruleValueSummary } from "../secret";
import { projectFleet } from "./fleet-project";
import {
  type Caveat,
  type HeaderChange,
  type InstalledScope,
  type Line,
  type Outcome,
  projectTab,
} from "./project";

interface FleetProvenance {
  readonly profileId: string;
  readonly name: string;
  readonly badgeText: string;
  readonly color: StoredEntry["color"];
}

export interface FleetRule extends HeaderChange {
  readonly profileId: string;
  readonly ruleId: string;
  readonly provenance: FleetProvenance;
  readonly headerKey: string;
  readonly scope: Scope;
  readonly crossSite: boolean;
  readonly comment?: string;
}

export function fleetRules(projection: Projection): FleetRule[] {
  const projected = projectFleet(projection);
  return projection.batch.entries.flatMap((entry) => {
    if (entry.source !== "rule") {
      return [];
    }
    const line = projected.get(entry.key);
    return line === undefined
      ? []
      : [fleetRule(entry, line, projection.batch.paused)];
  });
}

function fleetRule(entry: StoredEntry, line: Line, paused: boolean): FleetRule {
  const display =
    entry.operation === "remove" ? undefined : ruleValueSummary(entry);
  const installed = outcomeScope(line.outcome);
  return {
    key: line.key,
    profileId: entry.profileId,
    ruleId: entry.ruleId,
    provenance: {
      profileId: entry.profileId,
      name: entry.profileName,
      badgeText: entry.badgeText,
      color: entry.color,
    },
    direction: entry.stage,
    operation: entry.operation,
    scope: entry.scope,
    header: entry.header,
    headerKey: entry.headerKey,
    ...(display === undefined ? {} : { display }),
    secret: isSecretHeader(entry.header),
    ...(entry.comment === undefined || entry.comment === ""
      ? {}
      : { comment: entry.comment }),
    enabled: entry.enabled,
    paused,
    outcome: line.outcome,
    caveats: line.caveats,
    crossSite:
      installed === undefined
        ? entry.scope.type !== "domains"
        : installed.kind === "broad",
  };
}

export interface SiteGroup {
  readonly kind: "domain" | "cross-site";
  readonly host: string;
  readonly rules: readonly FleetRule[];
}

export function groupBySite(fleet: readonly FleetRule[]): SiteGroup[] {
  const domains = new Map<string, FleetRule[]>();
  const crossSite: FleetRule[] = [];
  for (const rule of fleet) {
    if (rule.scope.type === "domains") {
      const installed = outcomeScope(rule.outcome);
      const installedDomains = new Set<string>();
      if (installed?.kind === "sites") {
        for (const domain of installed.domains) {
          installedDomains.add(domain);
          push(domains, domain, rule);
        }
      }
      if (rule.outcome.kind === "absent" || rule.outcome.kind === "partial") {
        for (const domain of rule.scope.domains) {
          if (!installedDomains.has(domain)) push(domains, domain, rule);
        }
      }
    } else {
      const installed = outcomeScope(rule.outcome);
      if (installed?.kind === "sites") {
        for (const domain of installed.domains) push(domains, domain, rule);
      } else {
        crossSite.push(rule);
      }
    }
  }
  const groups: SiteGroup[] = [...domains.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([host, rules]) => ({ kind: "domain" as const, host, rules }));
  if (crossSite.length > 0) {
    groups.push({ kind: "cross-site", host: "*", rules: crossSite });
  }
  return groups;
}

export interface HeaderGroup {
  readonly headerKey: string;
  readonly header: string;
  readonly rules: readonly FleetRule[];
  readonly siteCount: number;
  readonly broad: boolean;
  readonly allSites: boolean;
}

export function groupByHeader(fleet: readonly FleetRule[]): HeaderGroup[] {
  const groups = new Map<string, FleetRule[]>();
  for (const rule of fleet) push(groups, rule.headerKey, rule);
  return [...groups.entries()]
    .map(([headerKey, rules]) => {
      const sites = new Set<string>();
      let broad = false;
      let allSites = false;
      for (const rule of rules) {
        const installed = outcomeScope(rule.outcome);
        if (installed === undefined) continue;
        if (installed.kind === "broad") {
          broad = true;
          allSites ||= rule.scope.type === "all";
        } else {
          for (const domain of installed.domains) sites.add(domain);
        }
      }
      return {
        headerKey,
        header: rules[0]?.header ?? headerKey,
        rules,
        siteCount: sites.size,
        broad,
        allSites,
      };
    })
    .sort((left, right) => left.header.localeCompare(right.header));
}

export interface TapeRow {
  readonly key: string;
  readonly host: string;
  readonly kind: "domain" | "cross-site";
  readonly direction: Direction;
  readonly operation: HeaderOp;
  readonly header: string;
  readonly outcome: Outcome;
  readonly caveats: readonly Caveat[];
  readonly paused: boolean;
}

export function tapeRows(
  groups: readonly SiteGroup[],
  projection: Projection,
): TapeRow[] {
  const rows: TapeRow[] = [];
  for (const group of groups) {
    for (const rule of group.rules) {
      if (
        rule.outcome.kind === "absent" &&
        (rule.outcome.reason.kind === "off" ||
          rule.outcome.reason.kind === "other-profile")
      ) {
        continue;
      }
      rows.push({
        key: `${group.host}:${rule.key}`,
        host: group.host,
        kind: group.kind,
        direction: rule.direction,
        operation: rule.operation,
        header: rule.header,
        outcome: outcomeAtSite(rule, group, projection),
        caveats: rule.caveats,
        paused: rule.paused,
      });
    }
  }
  return rows.sort(
    (left, right) =>
      left.host.localeCompare(right.host) ||
      left.header.localeCompare(right.header) ||
      left.key.localeCompare(right.key),
  );
}

function outcomeScope(outcome: Outcome): InstalledScope | undefined {
  return "scope" in outcome ? outcome.scope : undefined;
}

function outcomeAtSite(
  rule: FleetRule,
  group: SiteGroup,
  projection: Projection,
): TapeRow["outcome"] {
  if (group.kind === "domain") {
    const projected = projectTab(projection, {
      tabId: undefined,
      host: group.host,
      origin: undefined,
    }).get(rule.key)?.outcome;
    if (projected?.kind === "shadowed") return projected;
  }
  if (
    group.kind !== "domain" ||
    (rule.outcome.kind !== "partial" && rule.outcome.kind !== "pending") ||
    rule.outcome.scope?.kind !== "sites" ||
    rule.outcome.scope.origins?.some(
      (origin) => new URL(origin).hostname === group.host,
    ) === true ||
    rule.outcome.scope.domains.some(
      (domain) => group.host === domain || group.host.endsWith(`.${domain}`),
    )
  ) {
    if (
      rule.outcome.kind === "partial" &&
      rule.outcome.scope.kind === "sites" &&
      rule.outcome.scope.origins?.some(
        (origin) => new URL(origin).hostname === group.host,
      ) === true
    ) {
      return rule.outcome;
    }
    return rule.outcome.kind === "partial"
      ? { kind: "placed", scope: rule.outcome.scope }
      : rule.outcome;
  }
  return {
    kind: "absent",
    reason: {
      kind: "ungranted",
      missing: [originPatternForDomain(group.host)],
    },
  };
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const current = map.get(key);
  if (current === undefined) {
    map.set(key, [value]);
  } else {
    current.push(value);
  }
}

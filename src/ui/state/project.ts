import { entryIsConfirmed, type Projection } from "../../core/applied";
import {
  classifyHeaderName,
  isSecurityResponseHeader,
} from "../../core/headers";
import { hostUnder, originPatternForDomain } from "../../core/scope";
import type {
  AbsentReason,
  Entry,
  PlacedRef,
  RuleKey,
} from "../../core/verdict";

export interface TabContext {
  readonly tabId: number | undefined;
  readonly host: string | undefined;
  readonly origin: string | undefined;
}

export type Undecidable = "url-filter" | "regex-filter" | "initiator-domains";

export type Caveat = "h1-only" | "h2-breaking" | "security-response";

export type TabOutcome =
  | { readonly kind: "runs" }
  | { readonly kind: "runs-if-matched"; readonly undecidable: Undecidable }
  | {
      readonly kind: "shadowed";
      readonly by: RuleKey;
      readonly label: string;
    }
  | { readonly kind: "pending" }
  | { readonly kind: "elsewhere" }
  | { readonly kind: "absent"; readonly reason: AbsentReason };

export type InstalledScope =
  | {
      readonly kind: "sites";
      readonly domains: readonly [string, ...string[]];
      readonly origins?: readonly [string, ...string[]];
    }
  | { readonly kind: "broad" };

export type FleetOutcome =
  | {
      readonly kind: "placed";
      readonly scope: InstalledScope;
    }
  | {
      readonly kind: "runs-if-matched";
      readonly scope: InstalledScope;
      readonly undecidable: Undecidable;
    }
  | {
      readonly kind: "partial";
      readonly scope: InstalledScope;
      readonly reason: AbsentReason;
    }
  | {
      readonly kind: "shadowed";
      readonly scope: InstalledScope;
      readonly by: RuleKey;
      readonly label: string;
    }
  | { readonly kind: "pending"; readonly scope: InstalledScope }
  | { readonly kind: "absent"; readonly reason: AbsentReason };

export interface Line<O> {
  readonly key: RuleKey;
  readonly outcome: O;
  readonly caveats: readonly Caveat[];
}

type TabCandidate = Exclude<TabOutcome, { readonly kind: "absent" }>;

export function projectTab(
  projection: Projection,
  tab: TabContext,
): ReadonlyMap<RuleKey, Line<TabOutcome>> {
  const entries = new Map(
    projection.batch.entries.map((entry) => [entry.key, entry]),
  );
  const candidates = new Map<RuleKey, TabCandidate>();
  for (const refs of projection.batch.slots.values()) {
    walkSlot(refs, entries, tab, candidates);
  }

  return new Map(
    projection.batch.entries.map((entry) => {
      const projected =
        entry.standing.kind === "absent"
          ? conditionReaches(entry.authored, tab)
            ? { kind: "absent" as const, reason: entry.standing.reason }
            : { kind: "elsewhere" as const }
          : resolvePlaced(entry, candidates.get(entry.key), tab);
      const outcome =
        !entryIsConfirmed(projection, entry) &&
        conditionReaches(entry.authored, tab)
          ? { kind: "pending" as const }
          : projected;
      return [
        entry.key,
        { key: entry.key, outcome, caveats: caveatsFor(entry) },
      ];
    }),
  );
}

function resolvePlaced(
  entry: Entry,
  candidate: TabCandidate | undefined,
  tab: TabContext,
): TabOutcome {
  if (
    entry.grantGap !== undefined &&
    (candidate === undefined || candidate.kind === "elsewhere") &&
    conditionReaches(entry.authored, tab)
  ) {
    return {
      kind: "absent",
      reason:
        tab.host !== undefined && entry.grantGap.kind === "ungranted"
          ? {
              kind: "ungranted",
              missing: [originPatternForDomain(tab.host)],
            }
          : entry.grantGap,
    };
  }
  return candidate ?? { kind: "elsewhere" };
}

function walkSlot(
  refs: readonly PlacedRef[],
  entries: ReadonlyMap<RuleKey, Entry>,
  tab: TabContext,
  candidates: Map<RuleKey, TabCandidate>,
): void {
  let barrier:
    | {
        readonly operation: PlacedRef["operation"];
        readonly entry: Entry;
        readonly placement: PlacedRef["placement"];
      }
    | undefined;
  const uncertain: {
    readonly operation: PlacedRef["operation"];
    readonly undecidable: Undecidable;
    readonly resourceTypes: readonly string[] | undefined;
  }[] = [];
  for (const ref of refs) {
    if (!conditionReaches(ref.placement.condition, tab)) {
      push(candidates, ref.key, { kind: "elsewhere" });
      continue;
    }
    if (
      barrier !== undefined &&
      resourceTypesContain(
        barrier.placement.condition.resourceTypes,
        ref.placement.condition.resourceTypes,
      ) &&
      !admits(barrier.operation, ref.operation)
    ) {
      push(candidates, ref.key, {
        kind: "shadowed",
        by: barrier.entry.key,
        label: barrier.entry.label,
      });
      continue;
    }
    const undecidable = undecidablePart(ref, tab);
    if (undecidable !== undefined) {
      uncertain.push({
        operation: ref.operation,
        undecidable,
        resourceTypes: ref.placement.condition.resourceTypes,
      });
      push(candidates, ref.key, {
        kind: "runs-if-matched",
        undecidable,
      });
      continue;
    }
    const uncertainBarrier = uncertain.find(
      (candidate) =>
        resourceTypesContain(
          candidate.resourceTypes,
          ref.placement.condition.resourceTypes,
        ) && !admits(candidate.operation, ref.operation),
    );
    push(
      candidates,
      ref.key,
      uncertainBarrier === undefined
        ? { kind: "runs" }
        : {
            kind: "runs-if-matched",
            undecidable: uncertainBarrier.undecidable,
          },
    );
    const entry = entries.get(ref.key);
    if (entry !== undefined && barrier === undefined) {
      barrier = { operation: ref.operation, entry, placement: ref.placement };
    }
  }
}

function conditionReaches(
  condition: Entry["authored"],
  tab: TabContext,
): boolean {
  const host = tab.host;
  if (
    host === undefined ||
    (condition.tabIds !== undefined &&
      (tab.tabId === undefined || !condition.tabIds.includes(tab.tabId)))
  ) {
    return false;
  }
  const target =
    condition.requestDomains === undefined ||
    condition.requestDomains.some((domain) => hostUnder(host, domain));
  const initiator =
    condition.initiatorDomains?.some((domain) => hostUnder(host, domain)) ??
    false;
  if (!target && !initiator) return false;
  if (!target || condition.urlFilter === undefined) return true;
  const filter = anchoredOrigin(condition.urlFilter);
  return filter === undefined || tab.origin === undefined
    ? true
    : tab.origin === filter;
}

function anchoredOrigin(filter: string): string | undefined {
  const match = /^\|(https?):\/\/([^/^]+)\^$/.exec(filter);
  return match === null ? undefined : `${match[1]}://${match[2]}`;
}

function undecidablePart(
  ref: PlacedRef,
  tab: TabContext,
): Undecidable | undefined {
  const condition = ref.placement.condition;
  if (
    condition.urlFilter !== undefined &&
    (tab.origin === undefined ||
      anchoredOrigin(condition.urlFilter) !== tab.origin)
  ) {
    return "url-filter";
  }
  if (condition.regexFilter !== undefined) return "regex-filter";
  if (condition.initiatorDomains !== undefined) return "initiator-domains";
  return undefined;
}

export function admits(
  barrier: PlacedRef["operation"],
  lower: PlacedRef["operation"],
): boolean {
  return barrier !== "remove" && lower === "append";
}

export function resourceTypesContain(
  earlier: readonly string[] | undefined,
  later: readonly string[] | undefined,
): boolean {
  return (
    earlier === undefined ||
    later?.every((resourceType) => earlier.includes(resourceType)) === true
  );
}

export function caveatsFor(entry: Entry): Caveat[] {
  const caveats: Caveat[] = [];
  // Host joins the h1-only category: rewritten on the HTTP/1.1 wire, a no-op
  // on HTTP/2, the same shape as connection and transfer-encoding. Its note
  // text stays its own, resolved from the header name where the caveat is read.
  const advisory = classifyHeaderName(entry.header, entry.stage).advisories[0];
  if (advisory?.kind === "h1-only" || advisory?.kind === "host-http2") {
    caveats.push("h1-only");
  } else if (advisory?.kind === "h2-breaking") {
    caveats.push("h2-breaking");
  }
  if (entry.stage === "response" && isSecurityResponseHeader(entry.header)) {
    caveats.push("security-response");
  }
  return caveats;
}

function push(
  map: Map<RuleKey, TabCandidate>,
  key: RuleKey,
  candidate: TabCandidate,
): void {
  const current = map.get(key);
  if (
    current === undefined ||
    candidate.kind === "runs" ||
    (current.kind === "elsewhere" && candidate.kind !== "elsewhere") ||
    (current.kind !== "runs" && candidate.kind === "runs-if-matched")
  ) {
    map.set(key, candidate);
  }
}

import { entryIsConfirmed, type Projection } from "../../core/applied";
import { hostUnder } from "../../core/scope";
import type { Entry, Placement, RuleKey } from "../../core/verdict";
import {
  admits,
  caveatsFor,
  type FleetOutcome,
  type InstalledScope,
  type Line,
  resourceTypesContain,
} from "./project";

export function projectFleet(
  projection: Projection,
): ReadonlyMap<RuleKey, Line<FleetOutcome>> {
  const shadowed = fullyShadowed(projection.batch);
  return new Map(
    projection.batch.entries.map((entry) => {
      const scope =
        entry.standing.kind === "placed"
          ? installedScope(entry.standing.placements)
          : authoredScope(entry);
      const blocker = shadowed.get(entry.key);
      const outcome: FleetOutcome = !entryIsConfirmed(projection, entry)
        ? { kind: "pending", scope }
        : entry.standing.kind === "absent"
          ? { kind: "absent", reason: entry.standing.reason }
          : blocker === undefined
            ? fleetPlacement(entry, entry.standing.placements)
            : {
                kind: "shadowed",
                scope,
                by: blocker.key,
                label: blocker.label,
              };
      return [
        entry.key,
        {
          key: entry.key,
          outcome,
          caveats: caveatsFor(entry),
        },
      ];
    }),
  );
}

function fullyShadowed(
  batch: Projection["batch"],
): ReadonlyMap<RuleKey, Entry> {
  const entries = new Map(batch.entries.map((entry) => [entry.key, entry]));
  const blockers = new Map<RuleKey, Entry>();
  for (const entry of batch.entries) {
    if (entry.standing.kind !== "placed") continue;
    let blocker: Entry | undefined;
    const refs = batch.slots.get(`${entry.stage}:${entry.headerKey}`) ?? [];
    for (const placement of entry.standing.placements) {
      const index = refs.findIndex(
        (ref) =>
          ref.key === entry.key &&
          ref.placement.band === placement.band &&
          ref.placement.dnrId === placement.dnrId,
      );
      const barrier = refs
        .slice(0, index)
        .find((candidate) =>
          conditionContains(candidate.placement.condition, placement.condition),
        );
      const current =
        barrier === undefined || admits(barrier.operation, entry.operation)
          ? undefined
          : entries.get(barrier.key);
      if (
        current === undefined ||
        (blocker !== undefined && blocker.key !== current.key)
      ) {
        blocker = undefined;
        break;
      }
      blocker = current;
    }
    if (blocker !== undefined) blockers.set(entry.key, blocker);
  }
  return blockers;
}

function conditionContains(
  earlier: Placement["condition"],
  later: Placement["condition"],
): boolean {
  return (
    resourceTypesContain(earlier.resourceTypes, later.resourceTypes) &&
    setContains(
      earlier.tabIds,
      later.tabIds,
      (laterId, earlierId) => laterId === earlierId,
    ) &&
    setContains(earlier.requestDomains, later.requestDomains, hostUnder) &&
    setContains(earlier.initiatorDomains, later.initiatorDomains, hostUnder) &&
    filterContains(earlier, later)
  );
}

function setContains<T>(
  earlier: readonly T[] | undefined,
  later: readonly T[] | undefined,
  contains: (later: T, earlier: T) => boolean,
): boolean {
  return (
    earlier === undefined ||
    later?.every((value) =>
      earlier.some((candidate) => contains(value, candidate)),
    ) === true
  );
}

function filterContains(
  earlier: Placement["condition"],
  later: Placement["condition"],
): boolean {
  if (earlier.regexFilter !== undefined) {
    return earlier.regexFilter === later.regexFilter;
  }
  return (
    earlier.urlFilter === undefined || earlier.urlFilter === later.urlFilter
  );
}

function authoredScope(entry: Entry): InstalledScope {
  const [first, ...rest] = entry.authored.requestDomains ?? [];
  if (first === undefined) return { kind: "broad" };
  const origin = exactOrigin(entry.authored.urlFilter ?? "");
  return {
    kind: "sites",
    domains: [first, ...rest],
    ...(origin === undefined ? {} : { origins: [origin] }),
  };
}

function fleetPlacement(
  entry: Entry,
  placements: readonly [Placement, ...Placement[]],
): Exclude<FleetOutcome, { readonly kind: "absent" }> {
  const scope = installedScope(placements);
  if (entry.grantGap !== undefined) {
    return { kind: "partial", scope, reason: entry.grantGap };
  }
  if (entry.authored.regexFilter !== undefined) {
    return { kind: "runs-if-matched", scope, undecidable: "regex-filter" };
  }
  if (entry.authored.urlFilter !== undefined) {
    return { kind: "runs-if-matched", scope, undecidable: "url-filter" };
  }
  if (entry.authored.initiatorDomains !== undefined) {
    return {
      kind: "runs-if-matched",
      scope,
      undecidable: "initiator-domains",
    };
  }
  return { kind: "placed", scope };
}

function installedScope(
  placements: readonly [Placement, ...Placement[]],
): InstalledScope {
  const domains = new Set<string>();
  const origins = new Set<string>();
  for (const placement of placements) {
    const origin = exactOrigin(placement.condition.urlFilter ?? "");
    if (origin !== undefined) {
      domains.add(new URL(origin).hostname);
      if (placement.narrowed) origins.add(origin);
      continue;
    }
    if (placement.condition.requestDomains === undefined) {
      return { kind: "broad" };
    }
    for (const domain of placement.condition.requestDomains) {
      domains.add(domain);
    }
  }
  const [first, ...rest] = domains;
  const [firstOrigin, ...otherOrigins] = origins;
  return first === undefined
    ? { kind: "broad" }
    : {
        kind: "sites",
        domains: [first, ...rest],
        ...(firstOrigin === undefined
          ? {}
          : { origins: [firstOrigin, ...otherOrigins] }),
      };
}

function exactOrigin(filter: string): string | undefined {
  const match = /^\|(https?):\/\/(\[[^\]]+\]|[^/^]+)(?:[/^])$/.exec(filter);
  return match === null ? undefined : `${match[1]}://${match[2]}`;
}

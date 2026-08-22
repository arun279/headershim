import { entryIsConfirmed, type Projection } from "../../core/applied";
import { anchoredOrigin, hostUnder } from "../../core/scope";
import type { Entry, Placement, RuleKey } from "../../core/verdict";
import {
  admits,
  caveatsFor,
  type InstalledScope,
  type Line,
  type Outcome,
  resourceTypesContain,
  type Undecidable,
} from "./project";

export function projectFleet(
  projection: Projection,
): ReadonlyMap<RuleKey, Line> {
  const shadowed = fullyShadowed(projection.batch);
  return new Map(
    projection.batch.entries.map((entry) => {
      const outcome: Outcome =
        entry.standing.kind === "absent"
          ? { kind: "absent", reason: entry.standing.reason }
          : installedOutcome(
              projection,
              entry,
              entry.standing.placements,
              shadowed.get(entry.key),
            );
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

// Every reachable site-wide outcome describes a placed entry, so the scope it
// carries is the one the placements installed.
function installedOutcome(
  projection: Projection,
  entry: Entry,
  placements: readonly [Placement, ...Placement[]],
  blocker: Entry | undefined,
): Outcome {
  const scope = installedScope(placements);
  if (!entryIsConfirmed(projection, entry)) {
    return { kind: "pending", scope };
  }
  if (blocker !== undefined) {
    return { kind: "shadowed", scope, by: blocker.key, label: blocker.label };
  }
  if (entry.grantGap !== undefined) {
    return { kind: "partial", scope, reason: entry.grantGap };
  }
  const undecidable = undecidableAuthored(entry.authored);
  return undecidable === undefined
    ? { kind: "placed", scope }
    : { kind: "runs-if-matched", scope, undecidable };
}

function undecidableAuthored(
  authored: Entry["authored"],
): Undecidable | undefined {
  if (authored.regexFilter !== undefined) return "regex-filter";
  if (authored.urlFilter !== undefined) return "url-filter";
  if (authored.initiatorDomains !== undefined) return "initiator-domains";
  return undefined;
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

function installedScope(
  placements: readonly [Placement, ...Placement[]],
): InstalledScope {
  const domains = new Set<string>();
  const origins = new Set<string>();
  for (const placement of placements) {
    const origin = anchoredOrigin(placement.condition.urlFilter ?? "");
    const requestDomains =
      origin === undefined
        ? placement.condition.requestDomains
        : [new URL(origin.origin).hostname];
    if (requestDomains === undefined) {
      return { kind: "broad" };
    }
    for (const domain of requestDomains) {
      domains.add(domain);
    }
    if (placement.narrowed && origin !== undefined) {
      origins.add(origin.origin);
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

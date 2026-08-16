import type { RulesRevision } from "./revision";
import type { Batch, Entry } from "./verdict";

class AppliedProjection {
  private declare readonly brand: undefined;
  readonly confirmation = "applied";

  constructor(readonly batch: Batch) {}
}

class PendingProjection {
  private declare readonly brand: undefined;
  readonly confirmation = "pending";

  constructor(
    readonly confirmed: {
      readonly dynamic: boolean;
      readonly session: boolean;
    },
    readonly batch: Batch,
  ) {}
}

class PreviewProjection {
  private declare readonly brand: undefined;
  readonly confirmation = "preview";

  constructor(readonly batch: Batch) {}
}

export type Applied = AppliedProjection;

type Pending = PendingProjection;

type Preview = PreviewProjection;

export type Projection = Applied | Pending | Preview;

export type Live = Applied | Pending;

export function confirm(
  batch: Batch,
  expected: RulesRevision | undefined,
  applied: RulesRevision | undefined,
): Live {
  const confirmed = {
    dynamic: expected?.dynamic != null && expected.dynamic === applied?.dynamic,
    session: expected?.session != null && expected.session === applied?.session,
  };
  return confirmed.dynamic && confirmed.session
    ? new AppliedProjection(batch)
    : new PendingProjection(confirmed, batch);
}

export function preview(batch: Batch): Projection {
  return new PreviewProjection(batch);
}

export function entryIsConfirmed(
  projection: Projection,
  entry: Entry,
): boolean {
  return (
    projection.confirmation !== "pending" ||
    entry.standing.kind === "absent" ||
    entry.standing.placements.every(
      (placement) => projection.confirmed[placement.band],
    )
  );
}

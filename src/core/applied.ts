import type { RulesRevision } from "./revision";
import type { Batch, Entry } from "./verdict";

export type Applied = {
  readonly confirmation: "applied";
  readonly batch: Batch;
};

type Pending = {
  readonly confirmation: "pending";
  readonly confirmed: {
    readonly dynamic: boolean;
    readonly session: boolean;
  };
  readonly batch: Batch;
};

type Preview = {
  readonly confirmation: "preview";
  readonly batch: Batch;
};

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
    ? { confirmation: "applied", batch }
    : { confirmation: "pending", confirmed, batch };
}

export function preview(batch: Batch): Projection {
  return { confirmation: "preview", batch };
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

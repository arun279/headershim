import type { DnrRule, ReadonlyDnrRule } from "./compile";

export interface ReconcilePlan {
  removeRuleIds: number[];
  addRules: DnrRule[];
}

type SerializedConditionKey =
  | "initiatorDomains"
  | "isUrlFilterCaseSensitive"
  | "regexFilter"
  | "requestDomains"
  | "resourceTypes"
  | "tabIds"
  | "urlFilter";

type SerializedConditionResult =
  Exclude<
    keyof ReadonlyDnrRule["condition"],
    SerializedConditionKey
  > extends never
    ? string
    : never;

function serializedHeaders(
  modifications: ReadonlyDnrRule["action"]["requestHeaders"],
) {
  return (modifications ?? []).map(({ header, operation, value }) => [
    header,
    operation,
    value,
  ]);
}

function normalize(rules: readonly ReadonlyDnrRule[]): string {
  return `${rules
    .map(
      ({ id, priority, action, condition }): SerializedConditionResult =>
        JSON.stringify([
          id,
          priority,
          serializedHeaders(action.requestHeaders),
          serializedHeaders(action.responseHeaders),
          condition.regexFilter,
          condition.urlFilter,
          !!condition.isUrlFilterCaseSensitive,
          condition.initiatorDomains?.toSorted(),
          condition.requestDomains?.toSorted(),
          condition.resourceTypes?.toSorted() ?? [],
          condition.tabIds?.toSorted(),
        ]),
    )
    .sort()
    .join()}|`;
}

export function planReconcile(
  desired: DnrRule[],
  actual: readonly ReadonlyDnrRule[],
): ReconcilePlan | null {
  if (normalize(desired) === normalize(actual)) {
    return null;
  }

  return {
    removeRuleIds: actual.map((rule) => rule.id),
    addRules: desired,
  };
}

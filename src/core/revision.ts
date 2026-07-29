import type { ReadonlyDnrRule } from "./compile";
import { normalize } from "./reconcile";

export interface RulesRevision {
  readonly dynamic?: string;
  readonly session?: string;
}

export function revisionOf(
  dynamic: readonly ReadonlyDnrRule[],
  session: readonly ReadonlyDnrRule[],
): Promise<Required<RulesRevision>> {
  return Promise.all([digest(dynamic), digest(session)]).then(
    ([dynamicRevision, sessionRevision]) => ({
      dynamic: dynamicRevision,
      session: sessionRevision,
    }),
  );
}

async function digest(rules: readonly ReadonlyDnrRule[]): Promise<string> {
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(normalize(rules)),
        ),
      ),
    ),
  );
}

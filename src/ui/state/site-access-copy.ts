import { siteAccessCopy } from "../copy.options";
import type { PermissionOutcome } from "./site-access";

/**
 * What a revoke click did, in the words of the outcome rather than of the
 * intent: a grant that was removed is reported as removed, and the "no direct
 * grant" reading is kept for the click that found nothing to remove. Both name
 * the grants that go on covering the host, so a host whose access continues is
 * never reported as one whose access ended.
 */
export function revokeMessage(
  outcome: PermissionOutcome,
  domain: string,
  covering: readonly string[],
): string {
  switch (outcome) {
    case "changed":
      return siteAccessCopy.revoked(domain, covering);
    case "unchanged":
      return siteAccessCopy.noDirectGrant(domain, covering);
    case "failed":
      return siteAccessCopy.revokeFailed(domain);
  }
}

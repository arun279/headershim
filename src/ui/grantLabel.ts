import { isAllSitesOrigin } from "../core/grants";
import { copy } from "./copy";

/**
 * The label a needs-access Grant button carries. A rule whose only ungranted
 * origin is broad access says "Grant all sites" so the click is honest before
 * Chrome's own dialog; every narrower grant reads as the plain "Grant".
 */
export function grantLabel(missing: readonly string[] | undefined): string {
  return missing?.some(isAllSitesOrigin)
    ? copy.readout.grantAllSites
    : copy.readout.grant;
}

import type { HeaderOp } from "../../../core/model";
import { copy } from "../../copy";
import type { LineStatus } from "../../state/readout";

/**
 * The operation sentence follows whether the change can run, not which surface
 * renders it. A paused or access-blocked row describes what it would do.
 */
export function changeVerb(status: LineStatus, operation: HeaderOp): string {
  return (
    status === "paused" || status === "needs-access"
      ? copy.readout.heldVerb
      : copy.readout.verb
  )[operation];
}

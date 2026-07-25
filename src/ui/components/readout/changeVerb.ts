import type { HeaderOp } from "../../../core/model";
import { copy } from "../../copy";
import type { LineStatus } from "../../state/readout";

export function changeVerb(status: LineStatus, operation: HeaderOp): string {
  if (status === "live" || status === "unconfirmed" || status === "managed") {
    return copy.readout.verb[operation];
  }
  // This assertion makes the classification exhaustive at compile time: a new
  // status cannot silently default to conditional wording.
  status satisfies
    | "needs-access"
    | "refused"
    | "overridden"
    | "out-of-sync"
    | "off"
    | "paused";
  return copy.readout.heldVerb[operation];
}

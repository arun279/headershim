import type { LineStatus } from "../state/readout";

/**
 * A checked switch says the rule is on, never that it is running. Where the line
 * is stopped for a reason the row already names, the track must not wear the
 * running hue: a refused rule is on and going nowhere, and painting it the same
 * green as a live one states the opposite of what the row says beside it.
 */
export function toneForStatus(
  status: LineStatus,
): "paused" | "blocked" | "inert" | undefined {
  switch (status) {
    case "paused":
      return "paused";
    case "refused":
      return "blocked";
    case "managed":
    case "needs-access":
    case "out-of-sync":
      return "inert";
    case "off":
    case "overridden":
      return "inert";
    default:
      return undefined;
  }
}

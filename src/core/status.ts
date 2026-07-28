import type { StateDoc } from "./model";

/**
 * The one system-status precedence ladder. The annunciator, the popup readout
 * and the Workbench fleet all read this selector, so the surfaces cannot
 * disagree about what state the product is in: when it reports out-of-sync, no
 * line anywhere may still read live.
 */
export type SystemStatus = "paused" | "out-of-sync" | "live";

export interface StatusInput {
  readonly doc: StateDoc;
  readonly reconcileError: boolean;
}

export function computeStatus({
  doc,
  reconcileError,
}: StatusInput): SystemStatus {
  if (doc.settings.paused) {
    return "paused";
  }
  // A reconcile failure or omitted over-limit rule means the stored document
  // is not fully represented by Chrome, so the system cannot report live.
  if (reconcileError) {
    return "out-of-sync";
  }
  return "live";
}

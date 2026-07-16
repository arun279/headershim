import { useState } from "preact/hooks";
import { useAnnounce } from "../../src/ui/a11y/LiveRegion";
import { blockedCommitCopy } from "../../src/ui/state/commit-copy";
import type { MutationError } from "../../src/ui/state/mutations";

/**
 * The Workbench's one toast channel. Every message also speaks through the
 * persistent polite region, since a freshly mounted role=status node with text
 * already present is not reliably announced. `flash` maps a blocking save-time
 * error to its shared copy, or stays silent when the error has no user surface.
 */
export function useToast() {
  const announce = useAnnounce();
  const [toast, setToast] = useState<string | undefined>(undefined);

  const show = (message: string) => {
    setToast(message);
    announce(message);
  };
  const flash = (error: MutationError) => {
    const message = blockedCommitCopy(error);
    if (message !== undefined) show(message);
  };
  const dismiss = () => setToast(undefined);

  return { toast, show, flash, dismiss };
}

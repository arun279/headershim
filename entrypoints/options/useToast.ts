import { useState } from "preact/hooks";
import type { Result } from "../../src/core/result";
import { useAnnounce } from "../../src/ui/a11y/LiveRegion";
import { copy } from "../../src/ui/copy";
import { blockedCommitCopy } from "../../src/ui/state/commit-copy";
import type { MutationError } from "../../src/ui/state/mutations";

type Restore = () => Promise<Result<unknown, MutationError>>;

interface ToastState {
  message: string;
  nonce: number;
}

/**
 * The options pages' one toast channel. Every message also speaks through the
 * persistent polite region, since a freshly mounted role=status node with text
 * already present is not reliably announced. `flash` maps a blocking save-time
 * error to its shared copy, or stays silent when the error has no user surface.
 *
 * A destructive gesture reports through `showUndoable` and hands over its own
 * restore. The toast then holds open for as long as the undo is offered, and a
 * restore that fails says why instead of vanishing. That is the whole
 * forgiveness contract, in one place, so no page can offer half of it.
 */
export function useToast() {
  const announce = useAnnounce();
  const [toast, setToast] = useState<ToastState | undefined>(undefined);
  const [restore, setRestore] = useState<Restore | undefined>(undefined);

  const raise = (message: string, undo: Restore | undefined) => {
    setRestore(() => undo);
    setToast({ message, nonce: announce(message) });
  };
  const show = (message: string) => raise(message, undefined);
  const showUndoable = (message: string, undo: Restore) => raise(message, undo);
  const flash = (error: MutationError) => {
    const message = blockedCommitCopy(error);
    if (message !== undefined) show(message);
  };
  const dismiss = () => {
    setRestore(undefined);
    setToast(undefined);
  };
  // A later mutation invalidates the restore this toast still offers; the
  // message it made stands and expires on its own.
  const retireUndo = () => setRestore(undefined);

  const action =
    restore === undefined
      ? undefined
      : {
          label: copy.actions.undo,
          run: () =>
            void restore().then((outcome) => {
              setRestore(undefined);
              if (outcome.ok) {
                setToast(undefined);
              } else {
                flash(outcome.error);
              }
            }),
        };

  return { toast, action, show, showUndoable, flash, dismiss, retireUndo };
}

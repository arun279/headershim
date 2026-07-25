import { useRef, useState } from "preact/hooks";
import type { Result } from "../../core/result";
import { useLiveRegion } from "../a11y/LiveRegion";
import { copy } from "../copy";
import { blockedCommitCopy } from "./commit-copy";
import type { MutationError } from "./mutations";

type Restore = () => Promise<Result<unknown, MutationError>>;

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastState {
  message: string;
  nonce: number;
  action?: ToastAction | undefined;
}

/**
 * The one toast channel, shared by the popup and the options pages. Every
 * message also speaks through the persistent polite region, since a freshly
 * mounted role=status node with text already present is not reliably announced;
 * `dismiss` retracts both, so a retired message does not linger in the
 * accessibility tree once its toast is gone.
 *
 * A destructive gesture reports through `showUndoable` and hands over its own
 * restore. The toast then holds open for as long as the undo is offered, and a
 * restore that fails says why instead of vanishing. `flash` maps a blocking
 * save-time error to its shared copy, or stays silent when the error has no
 * user surface. `raise` is the primitive the conveniences are built on, and the
 * way to offer any other single action, such as the popup's Reload tab.
 */
export function useToast() {
  const { announce, retract } = useLiveRegion();
  const [toast, setToast] = useState<ToastState | undefined>(undefined);
  // An Undo's own run() is bound when the toast is raised, so dismiss reads the
  // live toast through a ref rather than that stale render's value: retracting
  // the announcement then works even from the action the toast itself carries.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const raise = (message: string, action?: ToastAction) =>
    setToast({ message, nonce: announce(message), action });
  const dismiss = () => {
    const current = toastRef.current;
    if (current !== undefined) retract(current.nonce);
    setToast(undefined);
  };
  const show = (message: string) => raise(message);
  const flash = (error: MutationError) => {
    const message = blockedCommitCopy(error);
    if (message !== undefined) show(message);
  };
  const showUndoable = (message: string, undo: Restore) =>
    raise(message, {
      label: copy.actions.undo,
      run: () =>
        void undo().then((outcome) => {
          if (outcome.ok) dismiss();
          else flash(outcome.error);
        }),
    });

  return { toast, raise, show, showUndoable, flash, dismiss };
}

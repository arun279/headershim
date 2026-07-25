import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { ToastState } from "../state/useToast";
import "./Toast.css";

interface ToastProps {
  children: ComponentChildren;
  nonce: number;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  onDismiss: () => void;
  /** Auto-dismiss delay; the action itself is never timing-locked. */
  duration?: number;
  /**
   * Hold the toast open with no auto-dismiss while it carries an operable action
   * (e.g. Undo) that must stay reachable until the next mutation retires it —
   * a timing-locked control would violate WCAG 2.2.1.
   */
  persist?: boolean;
}

export function Toast({
  children,
  nonce,
  actionLabel,
  onAction,
  onDismiss,
  duration = 6000,
  persist = false,
}: ToastProps) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (persist) {
      return;
    }
    const id = setTimeout(() => dismissRef.current(), duration);
    return () => clearTimeout(id);
  }, [nonce, duration, persist]);

  return (
    <div class="toast">
      {/* The polite region already carries the message to assistive tech; the
          visible span is hidden from the tree so it exists there exactly once,
          while the toast root stays visible so its Undo button is operable. */}
      <span class="toast-msg" aria-hidden="true">
        {children}
      </span>
      {actionLabel !== undefined && (
        <button type="button" class="toast-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Renders the one live toast, or nothing, straight from a `useToast` channel.
 * One place decides how the state maps onto the Toast, so no surface can raise a
 * confirmation that silently drops the action it was raised to offer.
 */
export function ToastHost({
  toast,
  onDismiss,
}: {
  toast: ToastState | undefined;
  onDismiss: () => void;
}) {
  if (toast === undefined) {
    return null;
  }
  return (
    <Toast
      nonce={toast.nonce}
      onDismiss={onDismiss}
      persist={toast.action !== undefined}
      actionLabel={toast.action?.label}
      onAction={toast.action?.run}
    >
      {toast.message}
    </Toast>
  );
}

import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
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
      <span class="toast-msg">{children}</span>
      {actionLabel !== undefined && (
        <button type="button" class="toast-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

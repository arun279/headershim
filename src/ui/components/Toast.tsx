import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import "./Toast.css";

interface ToastProps {
  children: ComponentChildren;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  onDismiss: () => void;
  /** Auto-dismiss delay; the action itself is never timing-locked (SPEC §9). */
  duration?: number;
}

export function Toast({
  children,
  actionLabel,
  onAction,
  onDismiss,
  duration = 6000,
}: ToastProps) {
  useEffect(() => {
    const id = setTimeout(onDismiss, duration);
    return () => clearTimeout(id);
  }, [onDismiss, duration]);

  return (
    <div class="toast" role="status" aria-live="polite">
      <span class="toast-msg">{children}</span>
      {actionLabel !== undefined && (
        <button type="button" class="toast-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

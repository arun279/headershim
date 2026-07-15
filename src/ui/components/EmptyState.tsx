import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import "./EmptyState.css";

interface EmptyStateProps {
  message: ComponentChildren;
  detail?: ComponentChildren;
  actions?: ComponentChildren;
  autoFocusAction?: boolean;
}

export function EmptyState({
  message,
  detail,
  actions,
  autoFocusAction = false,
}: EmptyStateProps) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (autoFocusAction) {
      root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }, []);

  return (
    <div class="empty-state" ref={root}>
      <p class="empty-message">{message}</p>
      {actions !== undefined && <div class="empty-actions">{actions}</div>}
      {detail !== undefined && <p class="empty-detail">{detail}</p>}
    </div>
  );
}

import type { ComponentChildren } from "preact";
import "./EmptyState.css";

interface EmptyStateProps {
  message: ComponentChildren;
  detail?: ComponentChildren;
  actions?: ComponentChildren;
}

export function EmptyState({ message, detail, actions }: EmptyStateProps) {
  return (
    <div class="empty-state">
      <p class="empty-message">{message}</p>
      {actions !== undefined && <div class="empty-actions">{actions}</div>}
      {detail !== undefined && <p class="empty-detail">{detail}</p>}
    </div>
  );
}

import type { ComponentChildren, JSX, RefObject } from "preact";
import { useId, useRef } from "preact/hooks";
import { useFocusTrap } from "../a11y/focus";
import "./Modal.css";

interface ModalProps {
  title: string;
  children: ComponentChildren;
  onClose: () => void;
  /** Focus target on open (Cancel first for destructive dialogs). */
  initialFocus?: RefObject<HTMLElement | null>;
}

export function Modal({ title, children, onClose, initialFocus }: ModalProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  useFocusTrap(cardRef, true, { initialFocus });

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div class="modal-scrim">
      <div
        ref={cardRef}
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} class="modal-title">
          {title}
        </h2>
        <div class="modal-body">{children}</div>
      </div>
    </div>
  );
}

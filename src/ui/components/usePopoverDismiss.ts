import { useEffect, useRef } from "preact/hooks";

interface PopoverRef {
  readonly current: HTMLElement | null;
}

interface EscapeLayer {
  dismiss: () => void;
}

const escapeLayers: EscapeLayer[] = [];

const onEscape = (event: KeyboardEvent) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const layer = escapeLayers.at(-1);
  if (layer === undefined) return;
  event.preventDefault();
  layer.dismiss();
};

/** Lets the open layer consume Escape before popup-wide commands see it. */
export function useEscapeDismiss(open: boolean, onDismiss: () => void) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;

    const layer = { dismiss: () => dismissRef.current() };
    if (escapeLayers.length === 0) {
      document.addEventListener("keydown", onEscape, true);
    }
    escapeLayers.push(layer);
    return () => {
      const index = escapeLayers.lastIndexOf(layer);
      if (index !== -1) escapeLayers.splice(index, 1);
      if (escapeLayers.length === 0) {
        document.removeEventListener("keydown", onEscape, true);
      }
    };
  }, [open]);
}

/** Light-dismisses an open popover while preserving an explicit focus return. */
export function usePopoverDismiss(
  open: boolean,
  popover: PopoverRef,
  trigger: PopoverRef,
  onDismiss: (restoreFocus: boolean) => void,
) {
  useEscapeDismiss(open, () => onDismiss(true));

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        popover.current?.contains(target) === true ||
        trigger.current?.contains(target) === true
      ) {
        return;
      }
      onDismiss(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, popover, trigger, onDismiss]);
}

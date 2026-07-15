import { useEffect } from "preact/hooks";

interface PopoverRef {
  readonly current: HTMLElement | null;
}

/** Light-dismisses an open popover while preserving an explicit focus return. */
export function usePopoverDismiss(
  open: boolean,
  popover: PopoverRef,
  trigger: PopoverRef,
  onDismiss: (restoreFocus: boolean) => void,
) {
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onDismiss(true);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, popover, trigger, onDismiss]);
}

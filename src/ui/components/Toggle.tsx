import "./Toggle.css";

interface ToggleProps {
  checked: boolean;
  /** Names the thing switched, e.g. "Rule on: authorization" or "Global pause". */
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /**
   * Soft-disabled: stays focusable and announces disabled, but activation still
   * reaches onChange so the owner can redirect it (an invalid rule's switch
   * focuses its note instead of toggling).
   */
  ariaDisabled?: boolean | undefined;
}

export function Toggle({
  checked,
  label,
  onChange,
  disabled,
  ariaDisabled,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={ariaDisabled}
      class="sw"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

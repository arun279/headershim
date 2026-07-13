import "./Toggle.css";

interface ToggleProps {
  checked: boolean;
  /** Names the thing switched, e.g. "Rule on: authorization" or "Global pause". */
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ checked, label, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      class="sw"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

import type { ComponentChildren, JSX } from "preact";
import "./Button.css";

type Kind = "primary" | "quiet" | "caution" | "ghost" | "destructive";

interface BaseProps {
  children: ComponentChildren;
  onClick?: (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  type?: "button" | "submit";
}

// Icon-only ghost buttons carry no visible text, so a label is required.
type ButtonProps = BaseProps &
  (
    | { kind: "primary" | "quiet" | "caution" | "destructive"; label?: string }
    | { kind: "ghost"; label: string }
  );

const CLASS: Record<Kind, string> = {
  primary: "btn primary",
  quiet: "btn quiet",
  caution: "btn caution",
  ghost: "icon-btn",
  destructive: "menu-item destructive",
};

export function Button({
  kind,
  children,
  label,
  onClick,
  disabled,
  type = "button",
}: ButtonProps) {
  return (
    <button
      type={type}
      class={CLASS[kind]}
      aria-label={label}
      role={kind === "destructive" ? "menuitem" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

import { copy } from "../../src/ui/copy";

/**
 * The one place the wordmark is kept: the Workbench identity. The mark carries
 * the signature swap-arrows in the live accent; the name is sans, never mono, so
 * the brand reads as a name and not as a wire byte.
 */
export function Wordmark() {
  return (
    <span class="wordmark">
      <span class="wordmark-mark" aria-hidden="true">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path d="M3 6h8M9 3l2.5 3L9 9" stroke-width="1.6" />
          <path d="M13 10H5M7 13l-2.5-3L7 7" stroke-width="1.6" />
        </svg>
      </span>
      <span class="wordmark-name">{copy.app.name}</span>
    </span>
  );
}

import { copy } from "../../src/ui/copy";

/**
 * The one place the wordmark is kept: the Workbench identity. The mark is the
 * brand's split disc drawn inline at favicon size, in step with the toolbar
 * icon: ink half-discs offset across the channel, the teal shim carrying the
 * live accent. The name is sans, never mono, so the brand reads as a name and
 * not as a wire byte.
 */
export function Wordmark() {
  return (
    <span class="wordmark">
      <span class="wordmark-mark" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M1.5 7.2 A5.5 5.5 0 0 1 12.5 7.2 Z" fill="var(--ink)" />
          <path d="M3.5 8.8 A5.5 5.5 0 0 0 14.5 8.8 Z" fill="var(--ink)" />
          <rect
            x="5"
            y="7.5"
            width="6"
            height="1"
            rx="0.5"
            fill="currentColor"
          />
        </svg>
      </span>
      <span class="wordmark-name">{copy.app.name}</span>
    </span>
  );
}

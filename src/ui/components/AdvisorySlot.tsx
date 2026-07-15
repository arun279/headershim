import { classifyHeaderName } from "../../core/headers";
import { copy } from "../copy";
import "./AdvisorySlot.css";

/** A pinned caution band that occupies no space until an advisory applies. */
export function AdvisorySlot({ header }: { header: string }) {
  const advisories = classifyHeaderName(header).advisories;
  if (advisories.length === 0) {
    return null;
  }

  return (
    <aside class="advisory-slot" aria-label={copy.editor.caution}>
      <span class="advisory-icon" aria-hidden="true">
        ▲
      </span>
      <div>
        <strong>{copy.editor.caution}</strong>
        {advisories.map((advisory) => (
          <p key={advisory.kind}>
            {advisory.kind === "network-managed"
              ? copy.advisories.managedHeader
              : copy.advisories.host}
          </p>
        ))}
      </div>
    </aside>
  );
}

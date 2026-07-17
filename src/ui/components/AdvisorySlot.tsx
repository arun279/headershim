import {
  classifyHeaderName,
  type HeaderAdvisoryClass,
  headerSensitivity,
} from "../../core/headers";
import type { Direction, HeaderOp } from "../../core/model";
import { copy } from "../copy";
import "./AdvisorySlot.css";

/** A pinned caution band that occupies no space until an advisory applies. */
export function AdvisorySlot({
  header,
  direction,
  operation,
}: {
  header: string;
  direction: Direction;
  operation: HeaderOp;
}) {
  const advisories = [
    ...classifyHeaderName(header).advisories,
    ...headerSensitivity({ direction, operation, header }),
  ];
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
          <p key={advisory.kind}>{advisoryCopy(advisory.kind)}</p>
        ))}
      </div>
    </aside>
  );
}

function advisoryCopy(kind: HeaderAdvisoryClass): string {
  switch (kind) {
    case "network-managed":
      return copy.advisories.managedHeader;
    case "host-http2":
      return copy.advisories.host;
    case "credential":
      return copy.advisories.credential;
    case "security-response":
      return copy.advisories.securityResponse;
  }
}

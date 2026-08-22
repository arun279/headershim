import {
  classifyHeaderName,
  type HeaderAdvisoryClass,
  headerSensitivity,
  isSecurityResponseHeader,
} from "../../core/headers";
import type { Direction, HeaderOp } from "../../core/model";
import { isUnanchoredPattern } from "../../core/scope";
import { copy } from "../copy";
import { transportNote } from "../dispositionCopy";
import { sentence } from "./sentence";
import "./AdvisorySlot.css";

/** A pinned caution band that occupies no space until an advisory applies. */
export function AdvisorySlot({
  header,
  direction,
  operation,
  pattern,
}: {
  header: string;
  direction: Direction;
  operation: HeaderOp;
  /** The active URL pattern, when the scope is a URL pattern; absent otherwise. */
  pattern?: string | undefined;
}) {
  const advisories = [
    ...classifyHeaderName(header, direction).advisories,
    ...headerSensitivity({ direction, operation, header }),
  ];
  const unanchored = pattern !== undefined && isUnanchoredPattern(pattern);
  const responseOnRequest =
    direction === "request" && isSecurityResponseHeader(header);
  if (advisories.length === 0 && !unanchored && !responseOnRequest) {
    return null;
  }

  return (
    <aside class="advisory-slot" aria-label={copy.headerFields.caution}>
      <span class="advisory-icon" aria-hidden="true">
        ▲
      </span>
      <div>
        <strong>{copy.headerFields.caution}</strong>
        {advisories.map((advisory) => (
          <p key={advisory.kind}>{advisoryCopy(advisory.kind, header)}</p>
        ))}
        {responseOnRequest && <p>{copy.advisories.responseOnRequest}</p>}
        {unanchored && <p>{sentence(copy.advisories.unanchoredPattern)}</p>}
      </div>
    </aside>
  );
}

function advisoryCopy(kind: HeaderAdvisoryClass, header: string): string {
  switch (kind) {
    case "h1-only":
    case "h2-breaking":
      return transportNote(kind, header);
    case "host-http2":
      return copy.advisories.host;
    case "credential":
      return copy.advisories.credential;
    case "security-response":
      return copy.advisories.securityResponse;
  }
}
